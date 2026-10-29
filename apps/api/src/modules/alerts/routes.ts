import { Router } from 'express';
import { AlertSeverity, AlertStatus, AlertType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ConflictError, NotFoundError } from '../../lib/errors';
import { idParamSchema, isoDateSchema, notesSchema } from '../../lib/validation';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';
import { writeAudit } from '../../lib/audit';
import { sseHub } from '../../realtime/sse';
import { publicDeviceSelect } from '../../lib/selects';

const router = Router();
router.use(requireAuth, requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'));

const listSchema = paginationSchema.extend({
  status: z.nativeEnum(AlertStatus).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  type: z.nativeEnum(AlertType).optional(),
  drainId: z.string().min(1).optional(),
  zone: z.string().trim().max(120).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.drainId ? { drainId: query.drainId } : {}),
      ...(query.zone ? { drain: { zone: query.zone } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: {
          drain: { select: { id: true, name: true, zone: true, latitude: true, longitude: true } },
          device: { select: { id: true, name: true, type: true } },
          acknowledgedBy: { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
          _count: { select: { notifications: true, tasks: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      prisma.alert.count({ where }),
    ]);

    res.json(paginated(alerts, total, page, pageSize));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        drain: {
          select: {
            id: true,
            name: true,
            zone: true,
            address: true,
            latitude: true,
            longitude: true,
          },
        },
        device: { select: publicDeviceSelect },
        acknowledgedBy: { select: { id: true, name: true, email: true } },
        resolvedBy: { select: { id: true, name: true, email: true } },
        notifications: { orderBy: { createdAt: 'asc' } },
        tasks: {
          include: { assignedTo: { select: { id: true, name: true } } },
        },
      },
    });
    if (!alert) throw new NotFoundError('Alert');
    res.json({ data: alert });
  }),
);

router.post(
  '/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await prisma.alert.findUnique({
      where: { id },
      select: { id: true, status: true, drainId: true, type: true },
    });
    if (!existing) throw new NotFoundError('Alert');
    if (existing.status !== 'ACTIVE') {
      throw new ConflictError(`Only ACTIVE alerts can be acknowledged (current: ${existing.status})`);
    }

    const alert = await prisma.alert.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedById: req.user!.id,
      },
      include: {
        drain: { select: { id: true, name: true, zone: true } },
        acknowledgedBy: { select: { id: true, name: true } },
      },
    });

    await writeAudit({
      action: 'ALERT_ACKNOWLEDGED',
      entityType: 'ALERT',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { drainId: alert.drainId, type: alert.type },
      req,
    });

    sseHub.publish('alert.updated', {
      alertId: alert.id,
      drainId: alert.drainId,
      status: alert.status,
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    });

    res.json({ data: alert });
  }),
);

const resolveSchema = z.object({
  resolutionNote: notesSchema,
});

router.post(
  '/:id/resolve',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = resolveSchema.parse(req.body);
    const existing = await prisma.alert.findUnique({
      where: { id },
      select: { id: true, status: true, drainId: true, type: true },
    });
    if (!existing) throw new NotFoundError('Alert');
    if (existing.status === 'RESOLVED') {
      throw new ConflictError('Alert is already resolved');
    }

    const alert = await prisma.alert.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: req.user!.id,
        resolutionNote: body.resolutionNote,
        activeKey: null,
      },
      include: {
        drain: { select: { id: true, name: true, zone: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    await writeAudit({
      action: 'ALERT_RESOLVED_MANUALLY',
      entityType: 'ALERT',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: {
        drainId: alert.drainId,
        type: alert.type,
        resolutionNote: body.resolutionNote,
      },
      req,
    });

    sseHub.publish('alert.resolved', {
      alertId: alert.id,
      drainId: alert.drainId,
      type: alert.type,
      status: 'RESOLVED',
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    });

    res.json({ data: alert });
  }),
);

export default router;
