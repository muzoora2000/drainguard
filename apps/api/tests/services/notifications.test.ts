import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, sendMock } = vi.hoisted(() => ({
  db: {
    alert: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    notification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
  sendMock: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({ prisma: db }));

vi.mock('../../src/services/sms', () => {
  class SmsProviderError extends Error {
    providerResponse: unknown;

    constructor(message: string, providerResponse: unknown) {
      super(message);
      this.providerResponse = providerResponse;
    }
  }

  return {
    SmsProviderError,
    getSmsProvider: () => ({ name: 'mock', send: sendMock }),
  };
});

import { notifyAlert } from '../../src/services/notifications';

const fallbackContact = {
  id: 'supervisor-1',
  name: 'Supervisor',
  email: 'supervisor@example.com',
  phone: '+254700000009',
  active: true,
  smsOptIn: true,
  inAppOptIn: true,
};

const alert = {
  id: 'alert-1',
  type: 'HIGH_WATER',
  message: 'Water is rising quickly at Market Square Drain.',
  drainId: 'drain-1',
  drain: {
    id: 'drain-1',
    name: 'Market Square Drain',
    zone: 'Zone A',
    fallbackContact,
  },
};

let created: Array<Record<string, unknown>>;
let createdById: Map<string, Record<string, unknown>>;

beforeEach(() => {
  created = [];
  createdById = new Map();
  db.alert.findUnique.mockResolvedValue(alert);
  db.auditLog.create.mockResolvedValue({ id: 1n });
  db.notification.findMany.mockResolvedValue([]);
  db.notification.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const record = { id: `notification-${created.length + 1}`, ...data };
    created.push(record);
    createdById.set(String(record.id), record);
    return record;
  });
  db.notification.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const record = createdById.get(where.id);
    return record ? { ...record, alert } : null;
  });
  db.notification.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      ...createdById.get(where.id),
      ...data,
    }),
  );
  sendMock.mockResolvedValue({
    providerMessageId: 'provider-message-1',
    providerResponse: { status: 'accepted' },
  });
});

describe('alert notifications', () => {
  it('creates an in-app notification and sends SMS to an assigned contact', async () => {
    db.user.findMany.mockResolvedValueOnce([
      {
        id: 'tech-1',
        name: 'Tech',
        email: 'tech@example.com',
        phone: '+254700000001',
        smsOptIn: true,
        inAppOptIn: true,
      },
    ]);

    await notifyAlert(alert.id);

    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alertId: alert.id,
          userId: 'tech-1',
          channel: 'IN_APP',
          status: 'SENT',
        }),
        expect.objectContaining({
          alertId: alert.id,
          userId: 'tech-1',
          channel: 'SMS',
          kind: 'PRIMARY',
          recipient: '+254700000001',
          status: 'PENDING',
        }),
      ]),
    );
    expect(sendMock).toHaveBeenCalledWith({
      to: '+254700000001',
      message: expect.stringContaining(alert.message),
    });
    expect(db.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT', providerMessageId: 'provider-message-1' }),
      }),
    );
  });

  it('uses the fallback contact when assigned users have no phone number', async () => {
    db.user.findMany
      .mockResolvedValueOnce([
        {
          id: 'tech-1',
          name: 'Tech',
          email: 'tech@example.com',
          phone: null,
          smsOptIn: true,
          inAppOptIn: false,
        },
      ])
      .mockResolvedValueOnce([]);

    await notifyAlert(alert.id);

    expect(sendMock).toHaveBeenCalledWith({
      to: fallbackContact.phone,
      message: expect.stringContaining(alert.message),
    });
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: fallbackContact.id,
          channel: 'SMS',
          kind: 'PRIMARY',
          recipient: fallbackContact.phone,
          error: expect.stringContaining('FALLBACK'),
        }),
      ]),
    );
  });

  it('records a no-recipient audit event when no phone or fallback is available', async () => {
    db.alert.findUnique.mockResolvedValue({
      ...alert,
      drain: { ...alert.drain, fallbackContact: null },
    });
    db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await notifyAlert(alert.id);

    expect(sendMock).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'NOTIFICATION_NO_RECIPIENT' }),
      }),
    );
  });
});
