import { Router } from 'express';
import { DrainStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, NotFoundError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idParamSchema } from '../../lib/validation';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';
import { serializeReading } from '../../lib/serializers';
import { publicDeviceSelect } from '../../lib/selects';

const router = Router();
router.use(requireAuth);

const thresholdsSchema = z.object({
  basketFillPercent: z.number().min(1).max(100).optional(),
  waterRiseRateCmPerMin: z.number().min(0.1).max(100).optional(),
  levelDifferenceCm: z.number().min(0.1).max(500).optional(),
  differencePersistMinutes: z.number().int().min(1).max(1440).optional(),
  intenseRainfallMmPerHour: z.number().min(0.1).max(500).optional(),
  rainfallLookbackMinutes: z.number().int().min(1).max(1440).optional(),
  heartbeatTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
  repeatBlockageCount: z.number().int().min(1).max(100).optional(),
  repeatBlockageWindowDays: z.number().int().min(1).max(365).optional(),
  alertCooldownMinutes: z.number().int().min(0).max(1440).optional(),
  escalationMinutes: z.number().int().min(1).max(1440).optional(),
  riseRateWindowMinutes: z.number().int().min(1).max(240).optional(),
  levelMatchWindowMinutes: z.number().int().min(1).max(120).optional(),
});

const listSchema = paginationSchema.extend({
  zone: z.string().trim().max(120).optional(),
  status: z.nativeEnum(DrainStatus).optional(),
  q: z.string().trim().max(200).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zone: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500).optional().nullable(),
  status: z.nativeEnum(DrainStatus).optional(),
  fallbackContactId: z.string().min(1).optional().nullable(),
  thresholds: thresholdsSchema.optional(),
});

const updateSchema = createSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'No fields to update' },
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);
    const where = {
      ...(query.zone ? { zone: query.zone } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { address: { contains: query.q, mode: 'insensitive' as const } },
              { zone: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [drains, total] = await Promise.all([
      prisma.drain.findMany({
        where,
        include: {
          thresholds: true,
          fallbackContact: { select: { id: true, name: true, phone: true } },
          devices: {
            select: {
              id: true,
              name: true,
              type: true,
              healthStatus: true,
              lastSeenAt: true,
              batteryPercent: true,
            },
          },
          alerts: {
            where: { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
            select: { id: true, type: true, severity: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
          _count: { select: { alerts: true, tasks: true } },
        },
        orderBy: [{ zone: 'asc' }, { name: 'asc' }],
        skip,
        take,
      }),
      prisma.drain.count({ where }),
    ]);

    res.json(paginated(drains, total, page, pageSize));
  }),
);

router.post(
  '/',
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const drain = await prisma.drain.create({
      data: {
        name: body.name,
        latitude: body.latitude,
        longitude: body.longitude,
        zone: body.zone,
        address: body.address ?? null,
        status: body.status ?? 'ACTIVE',
        fallbackContactId: body.fallbackContactId ?? null,
        thresholds: body.thresholds ? { create: body.thresholds } : undefined,
      },
      include: { thresholds: true, devices: { select: publicDeviceSelect } },
    });

    await writeAudit({
      action: 'DRAIN_CREATED',
      entityType: 'DRAIN',
      entityId: drain.id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { name: drain.name, zone: drain.zone },
      req,
    });

    res.status(201).json({ data: drain });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const drain = await prisma.drain.findUnique({
      where: { id },
      include: {
        thresholds: true,
        fallbackContact: {
          select: { id: true, name: true, email: true, phone: true, active: true },
        },
        devices: {
          select: publicDeviceSelect,
          orderBy: { type: 'asc' },
        },
        alerts: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            acknowledgedBy: { select: { id: true, name: true } },
            resolvedBy: { select: { id: true, name: true } },
          },
        },
        tasks: {
          where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
          include: { assignedTo: { select: { id: true, name: true } } },
        },
        assignments: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
      },
    });
    if (!drain) throw new NotFoundError('Drain');
    res.json({ data: drain });
  }),
);

router.patch(
  '/:id',
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateSchema.parse(req.body);

    const existing = await prisma.drain.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundError('Drain');

    const { thresholds, ...fields } = body;

    const drain = await prisma.$transaction(async (tx) => {
      if (thresholds && Object.keys(thresholds).length > 0) {
        await tx.drainThreshold.upsert({
          where: { drainId: id },
          create: { drainId: id, ...thresholds },
          update: thresholds,
        });
      }

      return tx.drain.update({
        where: { id },
        data: {
          ...(fields.name !== undefined ? { name: fields.name } : {}),
          ...(fields.latitude !== undefined ? { latitude: fields.latitude } : {}),
          ...(fields.longitude !== undefined ? { longitude: fields.longitude } : {}),
          ...(fields.zone !== undefined ? { zone: fields.zone } : {}),
          ...(fields.address !== undefined ? { address: fields.address } : {}),
          ...(fields.status !== undefined ? { status: fields.status } : {}),
          ...(fields.fallbackContactId !== undefined
            ? { fallbackContactId: fields.fallbackContactId }
            : {}),
        },
        include: { thresholds: true, devices: { select: publicDeviceSelect } },
      });
    });

    await writeAudit({
      action: 'DRAIN_UPDATED',
      entityType: 'DRAIN',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { fields: Object.keys(body) },
      req,
    });

    res.json({ data: drain });
  }),
);

router.delete(
  '/:id',
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.drain.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundError('Drain');

    const drain = await prisma.drain.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    await writeAudit({
      action: 'DRAIN_DEACTIVATED',
      entityType: 'DRAIN',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      req,
    });

    res.json({ data: drain });
  }),
);

router.get(
  '/:id/live',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const drain = await prisma.drain.findUnique({
      where: { id },
      include: {
        devices: { select: publicDeviceSelect, orderBy: { type: 'asc' } },
        thresholds: true,
      },
    });
    if (!drain) throw new NotFoundError('Drain');

    const [latestReadings, rainfall, openAlerts, openTasks] = await Promise.all([
      Promise.all(
        drain.devices.map(async (device) => {
          const reading = await prisma.sensorReading.findFirst({
            where: { deviceId: device.id },
            orderBy: { recordedAt: 'desc' },
          });
          return {
            device,
            reading: reading ? serializeReading(reading) : null,
          };
        }),
      ),
      prisma.rainfallReading.findFirst({
        where: { zone: drain.zone },
        orderBy: { recordedAt: 'desc' },
      }),
      prisma.alert.findMany({
        where: { drainId: id, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.maintenanceTask.findMany({
        where: { drainId: id, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' },
        include: { assignedTo: { select: { id: true, name: true } } },
      }),
    ]);

    res.json({
      data: {
        drain: {
          id: drain.id,
          name: drain.name,
          zone: drain.zone,
          status: drain.status,
          latitude: drain.latitude,
          longitude: drain.longitude,
        },
        thresholds: drain.thresholds,
        devices: latestReadings,
        rainfall: rainfall
          ? {
              mmPerHour: rainfall.mmPerHour,
              recordedAt: rainfall.recordedAt.toISOString(),
              source: rainfall.source,
            }
          : null,
        openAlerts,
        openTasks,
        generatedAt: new Date().toISOString(),
      },
    });
  }),
);

export default router;
