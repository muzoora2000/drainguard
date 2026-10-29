import type { AlertSnapshot, DeviceSnapshot, ReadingSnapshot, RuleInput } from '../../src/rules/types';
import { DEFAULT_THRESHOLDS } from '../../src/rules/defaults';

export const NOW = new Date('2026-01-15T12:00:00.000Z');

export function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

export function device(
  id: string,
  type: DeviceSnapshot['type'],
  overrides: Partial<DeviceSnapshot> = {},
): DeviceSnapshot {
  return {
    id,
    name: `${type} ${id}`,
    type,
    healthStatus: 'HEALTHY',
    healthReason: null,
    lastSeenAt: minutesAgo(1),
    lastReadingAt: minutesAgo(0.5),
    ...overrides,
  };
}

export function reading(
  id: string,
  deviceId: string,
  type: ReadingSnapshot['type'],
  value: number,
  minutes: number,
): ReadingSnapshot {
  return {
    id,
    deviceId,
    type,
    value,
    quality: 'OK',
    recordedAt: minutesAgo(minutes),
  };
}

export function baseDevices(): DeviceSnapshot[] {
  return [
    device('litter-1', 'LITTER'),
    device('up-1', 'WATER_UPSTREAM'),
    device('down-1', 'WATER_DOWNSTREAM'),
  ];
}

export function baseInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    now: NOW,
    drain: {
      id: 'drain-1',
      name: 'Market Square Drain',
      zone: 'Zone A',
      status: 'ACTIVE',
      thresholds: { ...DEFAULT_THRESHOLDS },
    },
    devices: baseDevices(),
    waterReadings: [],
    litterReadings: [],
    rainfall: null,
    openAlerts: [],
    recentBlockageAlerts: [],
    lastResolvedEngineeringReviewAt: null,
    openTasks: [],
    ...overrides,
  };
}

export function openAlert(
  id: string,
  type: AlertSnapshot['type'],
  overrides: Partial<AlertSnapshot> = {},
): AlertSnapshot {
  return {
    id,
    type,
    severity: 'WARNING',
    status: 'ACTIVE',
    createdAt: minutesAgo(20),
    resolvedAt: null,
    triggerData: {},
    ...overrides,
  };
}

export function sustainedDifferenceReadings(
  differenceCm = 20,
  upstreamLevel = 40,
  downstreamLevel = 40 - differenceCm,
): ReadingSnapshot[] {
  const readings: ReadingSnapshot[] = [];
  for (let minute = 17; minute >= 0; minute -= 1) {
    readings.push(reading(`up-${minute}`, 'up-1', 'WATER_UPSTREAM', upstreamLevel, minute));
    readings.push(
      reading(`down-${minute}`, 'down-1', 'WATER_DOWNSTREAM', downstreamLevel, minute),
    );
  }
  return readings;
}

export function risingWaterReadings(
  fromCm = 10,
  toCm = 35,
  windowMinutes = 10,
): ReadingSnapshot[] {
  return [
    reading('up-old', 'up-1', 'WATER_UPSTREAM', fromCm, windowMinutes),
    reading('up-new', 'up-1', 'WATER_UPSTREAM', toCm, 0),
    reading('down-old', 'down-1', 'WATER_DOWNSTREAM', fromCm, windowMinutes),
    reading('down-new', 'down-1', 'WATER_DOWNSTREAM', toCm, 0),
  ];
}
