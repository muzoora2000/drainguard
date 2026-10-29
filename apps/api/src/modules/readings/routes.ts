import { Router } from 'express';
import { DeviceType, ReadingQuality } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, BadRequestError, NotFoundError } from '../../lib/errors';
import { isoDateSchema } from '../../lib/validation';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';
import { serializeReading } from '../../lib/serializers';

const router = Router();
router.use(requireAuth, requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'));

const listSchema = paginationSchema.extend({
  drainId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  type: z.nativeEnum(DeviceType).optional(),
  quality: z.nativeEnum(ReadingQuality).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 24 * 60 * 60_000);

    if (from.getTime() > to.getTime()) {
      throw new BadRequestError('from must be before to');
    }

    const where = {
      ...(query.drainId ? { drainId: query.drainId } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.quality ? { quality: query.quality } : {}),
      recordedAt: { gte: from, lte: to },
    };

    const [readings, total] = await Promise.all([
      prisma.sensorReading.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        skip,
        take,
      }),
      prisma.sensorReading.count({ where }),
    ]);

    res.json(paginated(readings.map(serializeReading), total, page, pageSize));
  }),
);

router.get(
  '/latest',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        drainId: z.string().min(1).optional(),
        deviceId: z.string().min(1).optional(),
      })
      .parse(req.query);

    if (!query.drainId && !query.deviceId) {
      throw new BadRequestError('drainId or deviceId is required');
    }

    const devices = await prisma.device.findMany({
      where: {
        ...(query.deviceId ? { id: query.deviceId } : {}),
        ...(query.drainId ? { drainId: query.drainId } : {}),
      },
      select: { id: true, drainId: true, name: true, type: true, healthStatus: true },
      orderBy: { type: 'asc' },
    });

    if (query.deviceId && devices.length === 0) throw new NotFoundError('Device');

    const latest = await Promise.all(
      devices.map(async (device) => {
        const reading = await prisma.sensorReading.findFirst({
          where: { deviceId: device.id },
          orderBy: { recordedAt: 'desc' },
        });
        return {
          device,
          reading: reading ? serializeReading(reading) : null,
        };
      }),
    );

    res.json({ data: latest });
  }),
);

export default router;
