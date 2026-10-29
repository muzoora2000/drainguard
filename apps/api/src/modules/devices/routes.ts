import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { DeviceHealth, DeviceType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, NotFoundError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { generateDeviceApiKey } from '../../lib/crypto';
import { idParamSchema } from '../../lib/validation';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';

const router = Router();
router.use(requireAuth);

const publicSelect = {
  id: true,
  drainId: true,
  name: true,
  serialNumber: true,
  type: true,
  apiKeyPrefix: true,
  healthStatus: true,
  healthReason: true,
  healthUpdatedAt: true,
  lastSeenAt: true,
  lastReadingAt: true,
  batteryPercent: true,
  firmwareVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

const listSchema = paginationSchema.extend({
  drainId: z.string().min(1).optional(),
  zone: z.string().trim().max(120).optional(),
  type: z.nativeEnum(DeviceType).optional(),
  healthStatus: z.nativeEnum(DeviceHealth).optional(),
});

const createSchema = z.object({
  drainId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  serialNumber: z.string().trim().min(1).max(120).optional(),
  type: z.nativeEnum(DeviceType),
  firmwareVersion: z.string().trim().max(120).optional(),
  batteryPercent: z.number().min(0).max(100).optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    healthStatus: z.nativeEnum(DeviceHealth).optional(),
    healthReason: z.string().trim().max(1000).optional().nullable(),
    batteryPercent: z.number().min(0).max(100).optional().nullable(),
    firmwareVersion: z.string().trim().max(120).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);
    const where = {
      ...(query.drainId ? { drainId: query.drainId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.healthStatus ? { healthStatus: query.healthStatus } : {}),
      ...(query.zone ? { drain: { zone: query.zone } } : {}),
    };

    const [devices, total] = await Promise.all([
      prisma.device.findMany({
        where,
        select: {
          ...publicSelect,
          drain: { select: { id: true, name: true, zone: true, status: true } },
        },
        orderBy: [{ drain: { name: 'asc' } }, { type: 'asc' }],
        skip,
        take,
      }),
      prisma.device.count({ where }),
    ]);

    res.json(paginated(devices, total, page, pageSize));
  }),
);

router.post(
  '/',
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const drain = await prisma.drain.findUnique({
      where: { id: body.drainId },
      select: { id: true, name: true, zone: true },
    });
    if (!drain) throw new NotFoundError('Drain');

    const serialNumber =
      body.serialNumber ??
      `DG-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
        .toString('hex')
        .toUpperCase()}`;
    const apiKey = generateDeviceApiKey();

    const device = await prisma.device.create({
      data: {
        drainId: body.drainId,
        name: body.name,
        serialNumber,
        type: body.type,
        apiKeyHash: apiKey.hash,
        apiKeyPrefix: apiKey.prefix,
        firmwareVersion: body.firmwareVersion,
        batteryPercent: body.batteryPercent,
      },
      select: {
        ...publicSelect,
        drain: { select: { id: true, name: true, zone: true } },
      },
    });

    await writeAudit({
      action: 'DEVICE_CREATED',
      entityType: 'DEVICE',
      entityId: device.id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { drainId: body.drainId, type: body.type, serialNumber },
      req,
    });

    res.status(201).json({
      data: device,
      apiKey: apiKey.plaintext,
      notice: 'Store this API key securely. It will not be shown again.',
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const device = await prisma.device.findUnique({
      where: { id },
      select: {
        ...publicSelect,
        drain: { select: { id: true, name: true, zone: true, status: true, address: true } },
        _count: { select: { readings: true, alerts: true } },
      },
    });
    if (!device) throw new NotFoundError('Device');
    res.json({ data: device });
  }),
);

router.patch(
  '/:id',
  requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateSchema.parse(req.body);

    const existing = await prisma.device.findUnique({
      where: { id },
      select: { id: true, healthStatus: true },
    });
    if (!existing) throw new NotFoundError('Device');

    const device = await prisma.device.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.healthStatus !== undefined
          ? {
              healthStatus: body.healthStatus,
              healthUpdatedAt: new Date(),
              healthReason:
                body.healthReason !== undefined
                  ? body.healthReason
                  : body.healthStatus === 'HEALTHY'
                    ? null
                    : existing.healthStatus,
            }
          : {}),
        ...(body.healthReason !== undefined && body.healthStatus === undefined
          ? { healthReason: body.healthReason, healthUpdatedAt: new Date() }
          : {}),
        ...(body.batteryPercent !== undefined ? { batteryPercent: body.batteryPercent } : {}),
        ...(body.firmwareVersion !== undefined ? { firmwareVersion: body.firmwareVersion } : {}),
      },
      select: { ...publicSelect, drain: { select: { id: true, name: true, zone: true } } },
    });

    await writeAudit({
      action: 'DEVICE_UPDATED',
      entityType: 'DEVICE',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { fields: Object.keys(body) },
      req,
    });

    res.json({ data: device });
  }),
);

router.post(
  '/:id/rotate-key',
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.device.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundError('Device');

    const apiKey = generateDeviceApiKey();
    const device = await prisma.device.update({
      where: { id },
      data: { apiKeyHash: apiKey.hash, apiKeyPrefix: apiKey.prefix },
      select: publicSelect,
    });

    await writeAudit({
      action: 'DEVICE_KEY_ROTATED',
      entityType: 'DEVICE',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      req,
    });

    res.json({
      data: device,
      apiKey: apiKey.plaintext,
      notice: 'Store this API key securely. It will not be shown again.',
    });
  }),
);

export default router;
