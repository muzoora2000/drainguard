import type { RainfallReading, SensorReading } from '@prisma/client';

export function serializeReading(reading: SensorReading) {
  return {
    id: reading.id.toString(),
    deviceId: reading.deviceId,
    drainId: reading.drainId,
    type: reading.type,
    value: reading.litterFillPercent ?? reading.waterLevelCm ?? null,
    litterFillPercent: reading.litterFillPercent,
    waterLevelCm: reading.waterLevelCm,
    quality: reading.quality,
    recordedAt: reading.recordedAt.toISOString(),
    receivedAt: reading.receivedAt.toISOString(),
    externalId: reading.externalId,
  };
}

export function serializeRainfall(reading: RainfallReading) {
  return {
    id: reading.id.toString(),
    zone: reading.zone,
    mmPerHour: reading.mmPerHour,
    source: reading.source,
    recordedAt: reading.recordedAt.toISOString(),
    receivedAt: reading.receivedAt.toISOString(),
    externalId: reading.externalId,
    notes: reading.notes,
  };
}
