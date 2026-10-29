import { Router } from 'express';
import { Prisma, ReadingQuality } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { asyncHandler, BadRequestError } from '../../lib/errors';
import { isoDateSchema } from '../../lib/validation';
import { requireDevice } from '../../middleware/auth';
import { ingestionLimiter } from '../../middleware/rateLimit';
import { scheduleDrainEvaluation } from '../../services/rule-queue';

const router = Router();

const sampleSchema = z.object({
  recordedAt: isoDateSchema.optional(),
  value: z.number().finite(),
  quality: z.nativeEnum(ReadingQuality).optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  batteryPercent: z.number().min(0).max(100).optional(),
  firmwareVersion: z.string().trim().max(120).optional(),
});

const bodySchema = z.union([
  sampleSchema,
  z.object({ readings: z.array(sampleSchema).min(1).max(500) }),
]);

function isDuplicate(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

router.post(
  '/',
  ingestionLimiter,
  requireDevice,
  asyncHandler(async (req, res) => {
    const device = req.device!;
    const body = bodySchema.parse(req.body);
    const samples = 'readings' in body ? body.readings : [body];
    const now = new Date();
    const earliest = new Date(now.getTime() - env.INGEST_MAX_PAST_DAYS * 86_400_000);
    const latestAllowed = new Date(now.getTime() + env.INGEST_MAX_FUTURE_MINUTES * 60_000);

    let accepted = 0;
    let duplicates = 0;
    let latestRecordedAt: Date | null = null;

    for (const sample of samples) {
      const recordedAt = sample.recordedAt ?? now;
      if (recordedAt.getTime() < earliest.getTime()) {
        throw new BadRequestError(
          `recordedAt is older than the ${env.INGEST_MAX_PAST_DAYS}-day ingestion window`,
        );
      }
      if (recordedAt.getTime() > latestAllowed.getTime()) {
        throw new BadRequestError(
          `recordedAt is more than ${env.INGEST_MAX_FUTURE_MINUTES} minutes in the future`,
        );
      }

      if (device.type === 'LITTER' && (sample.value < 0 || sample.value > 100)) {
        throw new BadRequestError('Litter fill value must be between 0 and 100');
      }
      if (device.type !== 'LITTER' && (sample.value < 0 || sample.value > 5000)) {
        throw new BadRequestError('Water level value must be between 0 and 5000 cm');
      }

      if (!latestRecordedAt || recordedAt.getTime() > latestRecordedAt.getTime()) {
        latestRecordedAt = recordedAt;
      }

      try {
        await prisma.sensorReading.create({
          data: {
            deviceId: device.id,
            drainId: device.drainId,
            type: device.type,
            litterFillPercent: device.type === 'LITTER' ? sample.value : null,
            waterLevelCm: device.type === 'LITTER' ? null : sample.value,
            quality: sample.quality ?? 'OK',
            recordedAt,
            externalId: sample.externalId ?? null,
          },
        });
        accepted += 1;
      } catch (error) {
        if (isDuplicate(error)) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    const current = await prisma.device.findUnique({
      where: { id: device.id },
      select: { healthStatus: true },
    });

    await prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: now,
        ...(latestRecordedAt ? { lastReadingAt: latestRecordedAt } : {}),
        ...(current?.healthStatus !== 'FAULTY'
          ? {
              healthStatus: 'HEALTHY',
              healthReason: null,
              healthUpdatedAt: now,
            }
          : {}),
        ...(samples[samples.length - 1]?.batteryPercent !== undefined
          ? { batteryPercent: samples[samples.length - 1]!.batteryPercent }
          : {}),
        ...(samples[samples.length - 1]?.firmwareVersion !== undefined
          ? { firmwareVersion: samples[samples.length - 1]!.firmwareVersion }
          : {}),
      },
    });

    if (accepted > 0) {
      scheduleDrainEvaluation(device.drainId);
    }

    logger.info(
      { deviceId: device.id, drainId: device.drainId, accepted, duplicates },
      'Sensor readings ingested',
    );

    res.status(201).json({
      data: {
        accepted,
        duplicates,
        deviceId: device.id,
        drainId: device.drainId,
        type: device.type,
        lastReadingAt: latestRecordedAt?.toISOString() ?? null,
        rulesQueued: accepted > 0,
      },
    });
  }),
);

export default router;
