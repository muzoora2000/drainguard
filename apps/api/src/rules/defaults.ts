import type { RuleThresholds } from './types';

/**
 * These mirror the database column defaults in prisma/schema.prisma.
 * A missing DRAIN_THRESHOLDS row is treated as this configuration.
 */
export const DEFAULT_THRESHOLDS: RuleThresholds = {
  basketFillPercent: 85,
  waterRiseRateCmPerMin: 2,
  levelDifferenceCm: 15,
  differencePersistMinutes: 15,
  intenseRainfallMmPerHour: 20,
  rainfallLookbackMinutes: 30,
  heartbeatTimeoutMinutes: 10,
  repeatBlockageCount: 3,
  repeatBlockageWindowDays: 30,
  alertCooldownMinutes: 30,
  escalationMinutes: 15,
  riseRateWindowMinutes: 10,
  levelMatchWindowMinutes: 5,
};
