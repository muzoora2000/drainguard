import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { isoDateSchema } from '../../lib/validation';
import { requireDevice } from '../../middleware/auth';
import { ingestionLimiter } from '../../middleware/rateLimit';
import { serializeRainfall } from '../../lib/serializers';
import { scheduleDrainEvaluation } from '../../services/rule-queue';

const router = Router();

const bodySchema = z.object({
  mmPerHour: z.number().min(0).max(1000),
  recordedAt: isoDateSchema.optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

router.post(
  '/',
  ingestionLimiter,
  requireDevice,
  asyncHandler(async (req, res) => {
    const device = req.device!;
    const body = bodySchema.parse(req.body);
    const zone = device.drain.zone;

    try {
      const reading = await prisma.rainfallReading.create({
        data: {
          zone,
          mmPerHour: body.mmPerHour,
          recordedAt: body.recordedAt ?? new Date(),
          source: 'SENSOR',
          externalId: body.externalId ?? null,
          notes: body.notes ?? null,
        },
      });

      const drains = await prisma.drain.findMany({
        where: { zone, status: 'ACTIVE' },
        select: { id: true },
      });
      for (const drain of drains) scheduleDrainEvaluation(drain.id);

      res.status(201).json({ data: serializeRainfall(reading) });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        res.status(200).json({
          data: null,
          duplicate: true,
          message: 'This rainfall reading has already been received',
        });
        return;
      }
      throw error;
    }
  }),
);

export default router;
