export type Role = 'ADMIN' | 'SUPERVISOR' | 'TECHNICIAN' | 'ENGINEER';
export type DrainStatus = 'ACTIVE' | 'INACTIVE';
export type DeviceType = 'LITTER' | 'WATER_UPSTREAM' | 'WATER_DOWNSTREAM';
export type DeviceHealth = 'UNKNOWN' | 'HEALTHY' | 'FAULTY' | 'OFFLINE';
export type ReadingQuality = 'OK' | 'SUSPECT' | 'FAULTY';
export type RainfallSource = 'SENSOR' | 'MANUAL' | 'WEATHER_API';
export type AlertType =
  | 'BASKET_NEARLY_FULL'
  | 'HIGH_WATER'
  | 'POSSIBLE_BLOCKAGE'
  | 'SYSTEM_HEALTH'
  | 'ENGINEERING_REVIEW';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
export type NotificationChannel = 'SMS' | 'IN_APP';
export type NotificationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
export type TaskType =
  | 'LITTER_REMOVAL'
  | 'BLOCKAGE_INSPECTION'
  | 'ENGINEERING_INVESTIGATION'
  | 'DEVICE_REPAIR';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  smsOptIn: boolean;
  inAppOptIn: boolean;
  isFallbackContact: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserWithAssignments extends User {
  assignments: Array<{
    id: string;
    drainId: string | null;
    zone: string | null;
    drain?: { id: string; name: string; zone: string; status?: DrainStatus } | null;
  }>;
}

export interface AuthSession {
  user: User;
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface DrainThreshold {
  id: string;
  drainId: string;
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
  updatedAt: string;
}

export interface DeviceSummary {
  id: string;
  drainId: string;
  name: string;
  serialNumber: string;
  type: DeviceType;
  apiKeyPrefix: string;
  healthStatus: DeviceHealth;
  healthReason: string | null;
  healthUpdatedAt: string | null;
  lastSeenAt: string | null;
  lastReadingAt: string | null;
  batteryPercent: number | null;
  firmwareVersion: string | null;
  createdAt: string;
  updatedAt: string;
  drain?: { id: string; name: string; zone: string; status?: DrainStatus; address?: string | null };
  _count?: { readings: number; alerts: number };
}

export interface AlertSummary {
  id: string;
  drainId: string;
  deviceId: string | null;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  rule: string;
  triggerData: Record<string, unknown>;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolutionNote: string | null;
  lastNotifiedAt: string | null;
  escalationDueAt: string | null;
  escalatedAt: string | null;
  drain?: { id: string; name: string; zone: string; latitude?: number; longitude?: number };
  device?: { id: string; name: string; type: DeviceType } | null;
  acknowledgedBy?: { id: string; name: string } | null;
  resolvedBy?: { id: string; name: string } | null;
  _count?: { notifications: number; tasks: number };
}

export interface AlertDetail extends AlertSummary {
  drain: { id: string; name: string; zone: string; address: string | null; latitude: number; longitude: number };
  notifications: NotificationItem[];
  tasks: MaintenanceTask[];
}

export interface DrainListItem {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  zone: string;
  address: string | null;
  status: DrainStatus;
  fallbackContactId: string | null;
  fallbackContact?: { id: string; name: string; phone: string | null } | null;
  thresholds: DrainThreshold | null;
  devices: Array<
    Pick<DeviceSummary, 'id' | 'name' | 'type' | 'healthStatus' | 'lastSeenAt' | 'batteryPercent'>
  >;
  alerts: Array<Pick<AlertSummary, 'id' | 'type' | 'severity' | 'status' | 'createdAt'>>;
  _count: { alerts: number; tasks: number };
  createdAt: string;
  updatedAt: string;
}

export interface DrainDetail extends Omit<DrainListItem, 'devices' | 'alerts' | '_count'> {
  fallbackContact: { id: string; name: string; email: string; phone: string | null; active: boolean } | null;
  devices: DeviceSummary[];
  alerts: AlertSummary[];
  tasks: MaintenanceTask[];
  assignments: Array<{
    id: string;
    user: { id: string; name: string; email: string; role: Role };
  }>;
}

export interface SensorReading {
  id: string;
  deviceId: string;
  drainId: string;
  type: DeviceType;
  value: number | null;
  litterFillPercent: number | null;
  waterLevelCm: number | null;
  quality: ReadingQuality;
  recordedAt: string;
  receivedAt: string;
  externalId: string | null;
}

export interface LiveDrain {
  drain: {
    id: string;
    name: string;
    zone: string;
    status: DrainStatus;
    latitude: number;
    longitude: number;
  };
  thresholds: DrainThreshold | null;
  devices: Array<{ device: DeviceSummary; reading: SensorReading | null }>;
  rainfall: { mmPerHour: number; recordedAt: string; source: RainfallSource } | null;
  openAlerts: AlertSummary[];
  openTasks: MaintenanceTask[];
  generatedAt: string;
}

export interface MaintenanceRecord {
  id: string;
  taskId: string;
  drainId: string;
  performedById: string;
  notes: string;
  actionsTaken: string | null;
  photos: string[] | null;
  completedAt: string;
  createdAt: string;
  performedBy: { id: string; name: string };
}

export interface MaintenanceTask {
  id: string;
  drainId: string;
  alertId: string | null;
  type: TaskType;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  notes: string | null;
  assignedToId: string | null;
  createdById: string | null;
  scheduledFor: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  drain: { id: string; name: string; zone: string; latitude?: number; longitude?: number };
  assignedTo: { id: string; name: string; email?: string; phone?: string | null } | null;
  createdBy?: { id: string; name: string } | null;
  alert?: { id: string; type: AlertType; severity: AlertSeverity; status: AlertStatus } | null;
  records?: MaintenanceRecord[];
  _count?: { records: number };
}

export interface RainfallReading {
  id: string;
  zone: string;
  mmPerHour: number;
  source: RainfallSource;
  recordedAt: string;
  receivedAt: string;
  externalId: string | null;
  notes: string | null;
}

export interface NotificationItem {
  id: string;
  alertId: string;
  userId: string | null;
  channel: NotificationChannel;
  kind: 'PRIMARY' | 'ESCALATION';
  status: NotificationStatus;
  recipient: string;
  provider: string | null;
  attempt: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  alert?: AlertSummary;
}

export interface ReportOverview {
  range: { from: string; to: string; zone: string | null };
  generatedAt: string;
  drains: { total: number; byStatus: Partial<Record<DrainStatus, number>> };
  devices: { total: number; byHealth: Partial<Record<DeviceHealth, number>> };
  alerts: {
    total: number;
    byStatus: Partial<Record<AlertStatus, number>>;
    byType: Partial<Record<AlertType, number>>;
    bySeverity: Partial<Record<AlertSeverity, number>>;
    averageResolutionMinutes: number | null;
    averageAcknowledgementMinutes: number | null;
  };
  tasks: {
    total: number;
    open: number;
    overdue: number;
    completionRate: number | null;
    byStatus: Partial<Record<TaskStatus, number>>;
    byType: Partial<Record<TaskType, number>>;
  };
  rainfall: { readings: number; averageMmPerHour: number | null; maxMmPerHour: number | null };
  topProblemDrains: Array<{
    drain: { id: string; name: string; zone: string; latitude: number; longitude: number } | null;
    alertCount: number;
  }>;
  dailyAlerts: Array<{ date: string; count: number }>;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  actorRole: Role | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

export interface SystemHealth {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: { database: { status: string; latencyMs: number | null } };
  counts: {
    users: number;
    drains: number;
    devices: number;
    readings: number;
    rainfall: number;
    alerts: number;
    tasks: number;
    notifications: number;
  };
  jobs: {
    enabled: boolean;
    offlineCron: string;
    rulesCron: string;
    notificationRetryCron: string;
    escalationCron: string;
  };
  smsProvider: string;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

export type Dict = Record<string, string | number | boolean | undefined | null>;
