export type DeviceType = 'LITTER' | 'WATER_UPSTREAM' | 'WATER_DOWNSTREAM';
export type DeviceHealth = 'UNKNOWN' | 'HEALTHY' | 'FAULTY' | 'OFFLINE';
export type AlertType =
  | 'BASKET_NEARLY_FULL'
  | 'HIGH_WATER'
  | 'POSSIBLE_BLOCKAGE'
  | 'SYSTEM_HEALTH'
  | 'ENGINEERING_REVIEW';
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
export type ReadingQuality = 'OK' | 'SUSPECT' | 'BAD';

export interface DrainThresholds {
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

export interface Drain {
  id: string;
  name: string;
  zone: string;
  status: string;
  latitude: number;
  longitude: number;
  thresholds: DrainThresholds | null;
  devices?: Device[];
}

export interface Device {
  id: string;
  drainId: string;
  name: string;
  serialNumber: string;
  type: DeviceType;
  healthStatus: DeviceHealth;
  healthReason: string | null;
  lastSeenAt: string | null;
  lastReadingAt: string | null;
}

export interface Alert {
  id: string;
  drainId: string;
  deviceId: string | null;
  type: AlertType;
  severity: string;
  status: AlertStatus;
  rule: string;
  message: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ReadingSample {
  value: number;
  recordedAt?: string;
  quality?: ReadingQuality;
  externalId?: string;
  batteryPercent?: number;
  firmwareVersion?: string;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  deviceId: string;
  drainId: string;
  type: DeviceType;
  lastReadingAt: string | null;
  rulesQueued: boolean;
}

export interface LoginSession {
  user: { id: string; email: string; name: string; role: string };
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  deviceKey?: string;
}

export class DrainGuardApi {
  private accessToken: string | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  async login(email: string, password: string): Promise<LoginSession> {
    const response = await this.request<{ data: LoginSession }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    this.accessToken = response.data.accessToken;
    return response.data;
  }

  async listDrains(): Promise<Drain[]> {
    const response = await this.request<Paginated<Drain>>(
      '/api/drains?page=1&pageSize=100',
    );
    return response.data;
  }

  async listDevices(drainId: string): Promise<Device[]> {
    const response = await this.request<Paginated<Device>>(
      `/api/devices?drainId=${encodeURIComponent(drainId)}&page=1&pageSize=100`,
    );
    return response.data;
  }

  async listAlerts(filters: {
    drainId?: string;
    type?: AlertType;
    status?: AlertStatus;
  } = {}): Promise<Alert[]> {
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (filters.drainId) params.set('drainId', filters.drainId);
    if (filters.type) params.set('type', filters.type);
    if (filters.status) params.set('status', filters.status);
    const response = await this.request<Paginated<Alert>>(`/api/alerts?${params}`);
    return response.data;
  }

  async listAuditLogs(action?: string): Promise<AuditLog[]> {
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    if (action) params.set('action', action);
    const response = await this.request<Paginated<AuditLog>>(
      `/api/system/audit-logs?${params}`,
    );
    return response.data;
  }

  async rotateDeviceKey(deviceId: string): Promise<string> {
    const response = await this.request<{ apiKey: string }>(
      `/api/devices/${encodeURIComponent(deviceId)}/rotate-key`,
      { method: 'POST' },
    );
    return response.apiKey;
  }

  async updateDevice(
    deviceId: string,
    data: { healthStatus?: DeviceHealth; healthReason?: string | null },
  ): Promise<Device> {
    const response = await this.request<{ data: Device }>(
      `/api/devices/${encodeURIComponent(deviceId)}`,
      { method: 'PATCH', body: data },
    );
    return response.data;
  }

  async updateDrainThresholds(
    drainId: string,
    thresholds: Partial<DrainThresholds>,
  ): Promise<Drain> {
    const response = await this.request<{ data: Drain }>(
      `/api/drains/${encodeURIComponent(drainId)}`,
      { method: 'PATCH', body: { thresholds } },
    );
    return response.data;
  }

  async resolveAlert(alertId: string, resolutionNote: string): Promise<Alert> {
    const response = await this.request<{ data: Alert }>(
      `/api/alerts/${encodeURIComponent(alertId)}/resolve`,
      { method: 'POST', body: { resolutionNote } },
    );
    return response.data;
  }

  async ingestReadings(
    deviceKey: string,
    samples: ReadingSample[],
  ): Promise<IngestResult> {
    const response = await this.request<{ data: IngestResult }>(
      '/api/ingest/readings',
      { method: 'POST', body: { readings: samples }, deviceKey },
    );
    return response.data;
  }

  async ingestRainfall(
    deviceKey: string,
    mmPerHour: number,
    externalId: string,
    notes?: string,
  ): Promise<void> {
    await this.request('/api/ingest/rainfall', {
      method: 'POST',
      body: { mmPerHour, externalId, notes },
      deviceKey,
    });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.token !== null && (options.token ?? this.accessToken)) {
      headers.set('Authorization', `Bearer ${options.token ?? this.accessToken}`);
    }
    if (options.deviceKey) headers.set('X-Device-Key', options.deviceKey);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const error = payload as
        | { error?: { code?: string; message?: string }; message?: string }
        | null;
      throw new ApiError(
        error?.error?.message ?? error?.message ?? `Request failed with ${response.status}`,
        response.status,
        error?.error?.code,
      );
    }

    return payload as T;
  }
}
