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
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  drainAssignment: {
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
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  maintenanceRecord: {
    findMany: vi.fn(),
    create: vi.fn(),
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
let engineer: TestUser;

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
  engineer = {
    ...admin,
    id: 'engineer-1',
    email: 'engineer@example.com',
    name: 'Engineer',
    role: 'ENGINEER',
    phone: null,
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
      if (where.email === 'engineer@example.com') return engineer;
      if (where.id === 'admin-1') return admin;
      if (where.id === 'tech-1') return technician;
      if (where.id === 'engineer-1') return engineer;
      return null;
    },
  );
  db.user.update.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === 'tech-1' ? { ...technician, lastLoginAt: now } : { ...admin, lastLoginAt: now },
  );
  db.user.findMany.mockResolvedValue([]);
  db.user.count.mockResolvedValue(0);
  db.drainAssignment.findMany.mockResolvedValue([{ drainId: 'drain-1', zone: null }]);
  db.drain.findFirst.mockResolvedValue({ id: 'drain-1' });
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

describe('engineer task access', () => {
  const engineeringTask = {
    id: 'task-eng-1',
    drainId: 'drain-1',
    type: 'ENGINEERING_INVESTIGATION',
    status: 'SCHEDULED',
    title: 'Investigate repeated blockage',
    priority: 'MEDIUM',
    notes: null,
    assignedToId: null,
    createdById: 'admin-1',
    scheduledFor: null,
    dueAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    alertId: null,
    drain: { id: 'drain-1', name: 'Test Drain', zone: 'Zone A', latitude: 0, longitude: 0 },
    assignedTo: null,
    createdBy: { id: 'admin-1', name: 'Admin' },
    alert: null,
    _count: { records: 0 },
  };

  const maintenanceTask = {
    ...engineeringTask,
    id: 'task-maint-1',
    type: 'BLOCKAGE_INSPECTION',
    title: 'Clear blockage',
  };

  beforeEach(() => {
    db.maintenanceRecord.findMany.mockResolvedValue([]);
    db.maintenanceTask.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...engineeringTask,
      ...data,
    }));
    db.maintenanceRecord.create.mockResolvedValue({
      id: 'record-1',
      taskId: engineeringTask.id,
      drainId: engineeringTask.drainId,
      notes: 'Root cause is a collapsed pipe joint.',
      actionsTaken: null,
      photos: null,
      completedAt: now,
      performedBy: { id: engineer.id, name: engineer.name },
    });
    db.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
  });

  it('limits an engineer task list to engineering investigations', async () => {
    db.maintenanceTask.findMany.mockResolvedValue([]);
    db.maintenanceTask.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/tasks?type=BLOCKAGE_INSPECTION')
      .set('Authorization', `Bearer ${tokenFor(engineer)}`);

    expect(response.status).toBe(200);
    expect(db.maintenanceTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: 'ENGINEERING_INVESTIGATION' }),
      }),
    );
  });

  it('blocks engineers from opening non-engineering tasks', async () => {
    db.maintenanceTask.findUnique.mockResolvedValue(maintenanceTask);

    const response = await request(app)
      .get(`/api/tasks/${maintenanceTask.id}`)
      .set('Authorization', `Bearer ${tokenFor(engineer)}`);

    expect(response.status).toBe(403);
    expect(db.maintenanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('blocks engineers from updating tasks directly', async () => {
    const response = await request(app)
      .patch(`/api/tasks/${engineeringTask.id}`)
      .set('Authorization', `Bearer ${tokenFor(engineer)}`)
      .send({ status: 'DONE' });

    expect(response.status).toBe(403);
    expect(db.maintenanceTask.update).not.toHaveBeenCalled();
  });

  it('blocks engineers from recording findings on non-engineering tasks', async () => {
    db.maintenanceTask.findUnique.mockResolvedValue(maintenanceTask);

    const response = await request(app)
      .post(`/api/tasks/${maintenanceTask.id}/records`)
      .set('Authorization', `Bearer ${tokenFor(engineer)}`)
      .send({ notes: 'This should not be accepted.' });

    expect(response.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('lets engineers record findings and complete an engineering investigation', async () => {
    db.maintenanceTask.findUnique.mockResolvedValue(engineeringTask);

    const response = await request(app)
      .post(`/api/tasks/${engineeringTask.id}/records`)
      .set('Authorization', `Bearer ${tokenFor(engineer)}`)
      .send({ notes: 'Root cause is a collapsed pipe joint.' });

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe('record-1');
    expect(db.maintenanceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: engineeringTask.id,
          performedById: engineer.id,
        }),
      }),
    );
    expect(db.maintenanceTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DONE',
          assignedToId: engineer.id,
        }),
      }),
    );
  });
});

describe('role data scoping', () => {
  it('scopes technician alert lists to assigned drains', async () => {
    db.alert.findMany.mockResolvedValue([]);
    db.alert.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/alerts')
      .set('Authorization', `Bearer ${tokenFor(technician)}`);

    expect(response.status).toBe(200);
    expect(db.drainAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: technician.id } }),
    );
    expect(db.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              drain: {
                is: {
                  OR: [
                    { tasks: { some: { assignedToId: technician.id } } },
                    { id: { in: ['drain-1'] } },
                  ],
                },
              },
            },
          ]),
        }),
      }),
    );
  });

  it('hides an alert on a drain outside the technician assignment', async () => {
    db.alert.findUnique.mockResolvedValue({
      id: 'alert-2',
      drainId: 'drain-2',
      status: 'ACTIVE',
      type: 'HIGH_WATER',
    });
    db.drain.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/alerts/alert-2')
      .set('Authorization', `Bearer ${tokenFor(technician)}`);

    expect(response.status).toBe(404);
  });

  it('scopes technician task lists to self and unclaimed assigned-drain work', async () => {
    db.maintenanceTask.findMany.mockResolvedValue([]);
    db.maintenanceTask.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/tasks')
      .set('Authorization', `Bearer ${tokenFor(technician)}`);

    expect(response.status).toBe(200);
    expect(db.maintenanceTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { assignedToId: technician.id },
            {
              assignedToId: null,
              drain: {
                is: {
                  OR: [
                    { tasks: { some: { assignedToId: technician.id } } },
                    { id: { in: ['drain-1'] } },
                  ],
                },
              },
            },
          ],
        }),
      }),
    );
  });

  it('does not let technicians filter the task list to another user', async () => {
    db.maintenanceTask.findMany.mockResolvedValue([]);
    db.maintenanceTask.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/tasks?assignedToId=tech-2')
      .set('Authorization', `Bearer ${tokenFor(technician)}`);

    expect(response.status).toBe(200);
    expect(db.maintenanceTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignedToId: 'tech-2',
          OR: [{ assignedToId: technician.id }],
        }),
      }),
    );
  });

  it('hides an unclaimed task on a drain outside the technician assignment', async () => {
    db.maintenanceTask.findUnique.mockResolvedValue({
      id: 'task-2',
      drainId: 'drain-2',
      type: 'BLOCKAGE_INSPECTION',
      status: 'SCHEDULED',
      assignedToId: null,
    });
    db.drain.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/tasks/task-2')
      .set('Authorization', `Bearer ${tokenFor(technician)}`);

    expect(response.status).toBe(403);
    expect(db.maintenanceRecord.findMany).not.toHaveBeenCalled();
  });

  it('limits engineer drain lists to engineering investigations', async () => {
    db.drain.findMany.mockResolvedValue([]);
    db.drain.count.mockResolvedValue(0);

    const response = await request(app)
      .get('/api/drains')
      .set('Authorization', `Bearer ${tokenFor(engineer)}`);

    expect(response.status).toBe(200);
    expect(db.drain.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { tasks: { some: { type: 'ENGINEERING_INVESTIGATION' } } },
          ]),
        }),
      }),
    );
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
