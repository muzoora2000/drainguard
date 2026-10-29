import type {
  AlertSeverity,
  AlertStatus,
  AlertType,
  DeviceHealth,
  DeviceType,
  DrainStatus,
  ReadingQuality,
  TaskPriority,
  TaskType,
} from '@prisma/client';

export interface RuleThresholds {
  basketFillPercent: number;
  waterRiseRateCmPerMin: number;
  levelDifferenceCm: number;
  differencePersistMinutes: number;
  intenseRainfallMmPerHour: number;
  rainfallLookbackMinutes: number;
  heartbeatTimeoutMinutes: number;
  repeatBlockageCount: number;
  repeatBlockageWindowDays: number;
  alertCooldownMinutes: number;
  escalationMinutes: number;
  riseRateWindowMinutes: number;
  levelMatchWindowMinutes: number;
}

export interface DrainSnapshot {
  id: string;
  name: string;
  zone: string;
  status: DrainStatus;
  thresholds: RuleThresholds;
}

export interface DeviceSnapshot {
  id: string;
  name: string;
  type: DeviceType;
  healthStatus: DeviceHealth;
  healthReason: string | null;
  lastSeenAt: Date | null;
  lastReadingAt: Date | null;
}

export interface ReadingSnapshot {
  id: string;
  deviceId: string;
  type: DeviceType;
  value: number;
  quality: ReadingQuality;
  recordedAt: Date;
}

export interface RainfallSnapshot {
  mmPerHour: number;
  recordedAt: Date;
}

export interface AlertSnapshot {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  triggerData: unknown;
}

export interface TaskSnapshot {
  id: string;
  type: TaskType;
  status: string;
}

export interface BlockageAlertSnapshot {
  id: string;
  createdAt: Date;
}

export interface RuleInput {
  now: Date;
  drain: DrainSnapshot;
  devices: DeviceSnapshot[];
  waterReadings: ReadingSnapshot[];
  litterReadings: ReadingSnapshot[];
  rainfall: RainfallSnapshot | null;
  openAlerts: AlertSnapshot[];
  recentBlockageAlerts: BlockageAlertSnapshot[];
  lastResolvedEngineeringReviewAt: Date | null;
  openTasks: TaskSnapshot[];
}

export interface TaskIntent {
  type: TaskType;
  priority: TaskPriority;
  title: string;
}

export interface OpenAlertDecision {
  kind: 'OPEN_ALERT';
  type: AlertType;
  severity: AlertSeverity;
  rule: string;
  deviceId?: string;
  triggerData: Record<string, unknown>;
  message: string;
  createTask?: TaskIntent;
}

export interface ResolveAlertDecision {
  kind: 'RESOLVE_ALERT';
  alertId: string;
  alertType: AlertType;
  rule: string;
  reason: string;
}

export interface SuppressedDecision {
  kind: 'SUPPRESSED';
  type: AlertType;
  rule: string;
  reason: string;
  triggerData: Record<string, unknown>;
}

export type RuleDecision = OpenAlertDecision | ResolveAlertDecision | SuppressedDecision;

export interface EffectiveDeviceHealth {
  device: DeviceSnapshot;
  health: DeviceHealth;
  healthReason: string | null;
}

export interface RiseRate {
  deviceId: string;
  type: DeviceType;
  oldest: ReadingSnapshot;
  latest: ReadingSnapshot;
  spanMinutes: number;
  rateCmPerMin: number;
}

export interface WaterPair {
  upstream: ReadingSnapshot;
  downstream: ReadingSnapshot;
  differenceCm: number;
  gapMinutes: number;
}

export interface BlockageAnalysis {
  pairs: WaterPair[];
  sustained: boolean;
  latestPair: WaterPair | null;
  oldestPairAgeMinutes: number | null;
  maxGapMinutes: number | null;
  everyPairAboveThreshold: boolean;
}

export interface RainfallContext {
  intense: boolean;
  latestMmPerHour: number | null;
  recordedAt: Date | null;
  lookbackMinutes: number;
  thresholdMmPerHour: number;
}
