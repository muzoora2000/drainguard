import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@prisma/client';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/lib/password';
import { signAccessToken } from '../../src/modules/auth/tokens';

const db = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  refreshToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  drain: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  device: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  sensorReading: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  alert: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  maintenanceTask: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({ prisma: db }));
vi.mock('../../src/services/rule-queue', () => ({
  scheduleDrainEvaluation: vi.fn(),
  flushRuleQueue: vi.fn(),
  resetRuleQueueForTests: vi.fn(),
}));

const app = createApp();
const now = new Date('2026-01-15T12:00:00.000Z');

interface TestUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  smsOptIn: boolean;
  inAppOptIn: boolean;
  isFallbackContact: boolean;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  passwordHash: string;
}

let admin: TestUser;
let technician: TestUser;

beforeAll(async () => {
  const passwordHash = await hashPassword('Password1');
  admin = {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'ADMIN',
    phone: null,
    smsOptIn: true,
    inAppOptIn: true,
    isFallbackContact: false,
    active: true,
    lastLoginAt: null,
    createdAt: now,
    passwordHash,
  };
  technician = {
    ...admin,
    id: 'tech-1',
    email: 'tech@example.com',
    name: 'Tech',
    role: 'TECHNICIAN',
    phone: '+254712345678',
    passwordHash,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  db.auditLog.create.mockResolvedValue({ id: 1n });
  db.auditLog.findFirst.mockResolvedValue(null);
  db.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

  db.user.findUnique.mockImplementation(
    async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.email === 'admin@example.com') return admin;
      if (where.email === 'tech@example.com') return technician;
      if (where.id === 'admin-1') return admin;
      if (where.id === 'tech-1') return technician;
      return null;
    },
  );
  db.user.update.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'tech-1' ? { ...technician, lastLoginAt: now } : { ...admin, lastLoginAt: now },
  );
  db.user.findMany.mockResolvedValue([]);
  db.user.count.mockResolvedValue(0);
});

afterAll(() => {
  vi.restoreAllMocks();
});

function tokenFor(user: TestUser): string {
  return signAccessToken({ id: user.id, role: user.role });
}

describe('auth and RBAC', () => {
  it('logs in with valid credentials and returns tokens', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ADMIN@example.com', password: 'Password1' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('admin@example.com');
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).toBeTruthy();
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects an invalid password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'WrongPassword1' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('requires authentication for protected routes', async () => {
    const response = await request(app).get('/api/users');
    expect(response.status).toBe(401);
  });

  it('blocks technicians from admin-only user management', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${tokenFor(technician)}`);

    expect(response.status).toBe(403);
  });

  it('allows admins to list users', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });
});

describe('device ingestion', () => {
  const device = {
    id: 'device-1',
    drainId: 'drain-1',
    name: 'Litter sensor',
    type: 'LITTER',
    drain: { id: 'drain-1', name: 'Test Drain', zone: 'Zone A', status: 'ACTIVE' },
  };

  beforeEach(() => {
    db.device.findUnique.mockImplementation(
      async ({ select }: { select?: Record<string, unknown> }) => {
        if (select?.apiKeyHash) return device;
        if (select?.healthStatus) return { healthStatus: 'HEALTHY' };
        return device;
      },
    );
    db.device.update.mockResolvedValue({ ...device });
    db.sensorReading.create.mockResolvedValue({ id: 1n });
  });

  it('requires a device API key', async () => {
    const response = await request(app)
      .post('/api/ingest/readings')
      .send({ value: 50 });

    expect(response.status).toBe(401);
    expect(db.sensorReading.create).not.toHaveBeenCalled();
  });

  it('accepts a valid litter reading', async () => {
    const response = await request(app)
      .post('/api/ingest/readings')
      .set('X-Device-Key', 'device-key')
      .send({ value: 64.5, recordedAt: new Date().toISOString() });

    expect(response.status).toBe(201);
    expect(response.body.data.accepted).toBe(1);
    expect(response.body.data.duplicates).toBe(0);
    expect(db.sensorReading.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'device-1',
        drainId: 'drain-1',
        type: 'LITTER',
        litterFillPercent: 64.5,
      }),
    });
  });

  it('rejects an out-of-range litter reading', async () => {
    const response = await request(app)
      .post('/api/ingest/readings')
      .set('X-Device-Key', 'device-key')
      .send({ value: 101 });

    expect(response.status).toBe(400);
    expect(db.sensorReading.create).not.toHaveBeenCalled();
  });
});

describe('alert workflow', () => {
  const openAlert = {
    id: 'alert-1',
    drainId: 'drain-1',
    type: 'HIGH_WATER',
    status: 'ACTIVE',
    severity: 'WARNING',
    rule: 'HIGH_WATER_RISE',
    message: 'Water is rising',
    triggerData: {},
    createdAt: now,
    updatedAt: now,
    acknowledgedAt: null,
    acknowledgedById: null,
    resolvedAt: null,
    resolvedById: null,
    resolutionNote: null,
    lastNotifiedAt: null,
    escalationDueAt: null,
    escalatedAt: null,
    activeKey: 'drain-1:HIGH_WATER',
    deviceId: null,
  };

  beforeEach(() => {
    db.alert.findUnique.mockResolvedValue(openAlert);
    db.alert.update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...openAlert,
        ...data,
        drain: { id: 'drain-1', name: 'Test Drain', zone: 'Zone A' },
        acknowledgedBy: { id: 'tech-1', name: 'Tech' },
        resolvedBy: { id: 'tech-1', name: 'Tech' },
      }),
    );
  });

  it('lets a technician acknowledge an active alert', async () => {
    const response = await request(app)
      .post('/api/alerts/alert-1/acknowledge')
      .set('Authorization', `Bearer ${tokenFor(technician)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ACKNOWLEDGED');
    expect(db.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACKNOWLEDGED',
          acknowledgedById: 'tech-1',
        }),
      }),
    );
  });

  it('resolves an alert with a note', async () => {
    const response = await request(app)
      .post('/api/alerts/alert-1/resolve')
      .set('Authorization', `Bearer ${tokenFor(technician)}`)
      .send({ resolutionNote: 'Cleared the blockage and verified flow.' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('RESOLVED');
    expect(db.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activeKey: null,
          resolvedById: 'tech-1',
        }),
      }),
    );
  });
});
