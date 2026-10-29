import { Router } from 'express';
import { RainfallSource } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { isoDateSchema } from '../../lib/validation';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';
import { writeAudit } from '../../lib/audit';
import { serializeRainfall } from '../../lib/serializers';
import { scheduleDrainEvaluation } from '../../services/rule-queue';

const router = Router();
router.use(requireAuth);

const listSchema = paginationSchema.extend({
  zone: z.string().trim().max(120).optional(),
  source: z.nativeEnum(RainfallSource).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);
    const where = {
      ...(query.zone ? { zone: query.zone } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.from || query.to
        ? {
            recordedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    const [readings, total] = await Promise.all([
      prisma.rainfallReading.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        skip,
        take,
      }),
      prisma.rainfallReading.count({ where }),
    ]);

    res.json(paginated(readings.map(serializeRainfall), total, page, pageSize));
  }),
);

router.get(
  '/latest',
  asyncHandler(async (req, res) => {
    const query = z.object({ zone: z.string().trim().min(1).max(120) }).parse(req.query);
    const reading = await prisma.rainfallReading.findFirst({
      where: { zone: query.zone },
      orderBy: { recordedAt: 'desc' },
    });
    res.json({ data: reading ? serializeRainfall(reading) : null });
  }),
);

const createSchema = z.object({
  zone: z.string().trim().min(1).max(120),
  mmPerHour: z.number().min(0).max(1000),
  recordedAt: isoDateSchema.optional(),
  source: z.nativeEnum(RainfallSource).optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

router.post(
  '/',
  requireRoles('ADMIN', 'SUPERVISOR'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const reading = await prisma.rainfallReading.create({
      data: {
        zone: body.zone,
        mmPerHour: body.mmPerHour,
        recordedAt: body.recordedAt ?? new Date(),
        source: body.source ?? 'MANUAL',
        externalId: body.externalId ?? null,
        notes: body.notes ?? null,
      },
    });

    await writeAudit({
      action: 'RAINFALL_RECORDED',
      entityType: 'RAINFALL',
      entityId: reading.id.toString(),
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { zone: reading.zone, mmPerHour: reading.mmPerHour, source: reading.source },
      req,
    });

    const drains = await prisma.drain.findMany({
      where: { zone: reading.zone, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const drain of drains) scheduleDrainEvaluation(drain.id);

    res.status(201).json({ data: serializeRainfall(reading) });
  }),
);

export default router;
