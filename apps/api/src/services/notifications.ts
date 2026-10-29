import { Prisma, type NotificationKind } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/audit';
import { getSmsProvider, SmsProviderError } from './sms';

interface Person {
  userId: string | null;
  name: string;
  phone: string;
  smsOptIn: boolean;
  inAppOptIn: boolean;
  email: string | null;
}

interface DrainContactInfo {
  id: string;
  name: string;
  zone: string;
  fallbackContact: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    active: boolean;
    smsOptIn: boolean;
    inAppOptIn: boolean;
  } | null;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function assignedUsers(drainId: string, zone: string): Promise<Person[]> {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { assignments: { some: { drainId } } },
        { assignments: { some: { zone } } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      smsOptIn: true,
      inAppOptIn: true,
    },
  });

  return users.map((user) => ({
    userId: user.id,
    name: user.name,
    phone: user.phone ?? '',
    smsOptIn: user.smsOptIn,
    inAppOptIn: user.inAppOptIn,
    email: user.email,
  }));
}

async function fallbackRecipients(drain: DrainContactInfo): Promise<Person[]> {
  const recipients: Person[] = [];

  const contact = drain.fallbackContact;
  if (contact && contact.active && contact.smsOptIn && contact.phone) {
    recipients.push({
      userId: contact.id,
      name: contact.name,
      phone: contact.phone,
      smsOptIn: contact.smsOptIn,
      inAppOptIn: contact.inAppOptIn,
      email: contact.email,
    });
  }

  const globalFallbacks = await prisma.user.findMany({
    where: {
      active: true,
      isFallbackContact: true,
      smsOptIn: true,
      phone: { not: null },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      smsOptIn: true,
      inAppOptIn: true,
    },
  });

  for (const user of globalFallbacks) {
    if (!user.phone) continue;
    recipients.push({
      userId: user.id,
      name: user.name,
      phone: user.phone,
      smsOptIn: user.smsOptIn,
      inAppOptIn: user.inAppOptIn,
      email: user.email,
    });
  }

  if (env.SMS_FALLBACK_PHONE) {
    recipients.push({
      userId: null,
      name: 'Environment fallback',
      phone: env.SMS_FALLBACK_PHONE,
      smsOptIn: true,
      inAppOptIn: false,
      email: null,
    });
  }

  const seen = new Set<string>();
  return recipients.filter((person) => {
    if (seen.has(person.phone)) return false;
    seen.add(person.phone);
    return true;
  });
}

function dedupeByPhone(people: Person[]): Person[] {
  const seen = new Set<string>();
  return people.filter((person) => {
    if (!person.phone || seen.has(person.phone)) return false;
    seen.add(person.phone);
    return true;
  });
}

function buildMessage(
  alert: { id: string; message: string | null; type: string },
  kind: NotificationKind,
  error: string | null,
): string {
  const base =
    alert.message ??
    `DrainGuard [${alert.type.replaceAll('_', ' ')}] A drainage alert needs attention.`;
  const escalation = kind === 'ESCALATION' || error?.startsWith('UNACKNOWLEDGED');
  const prefix = escalation && !base.startsWith('DrainGuard ESCALATION:')
    ? 'DrainGuard ESCALATION: '
    : '';
  return `${prefix}${base} Ref: ${alert.id}`;
}

export async function deliverNotification(
  notificationId: string,
  options: { isRetry?: boolean; allowFallback?: boolean } = {},
): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      alert: {
        select: {
          id: true,
          type: true,
          message: true,
          drainId: true,
          drain: {
            select: {
              id: true,
              name: true,
              zone: true,
              fallbackContact: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  active: true,
                  smsOptIn: true,
                  inAppOptIn: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!notification || notification.channel !== 'SMS') return;
  if (notification.status === 'SENT' || notification.status === 'DELIVERED') return;

  const provider = getSmsProvider();
  const attempt = options.isRetry ? notification.attempt + 1 : notification.attempt;
  const allowFallback = options.allowFallback ?? notification.kind === 'PRIMARY';

  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      attempt,
      provider: provider.name,
      status: 'PENDING',
      nextRetryAt: null,
    },
  });

  try {
    const result = await provider.send({
      to: notification.recipient,
      message: buildMessage(notification.alert, notification.kind, notification.error),
    });

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        providerResponse: jsonValue(result.providerResponse),
        error: null,
        nextRetryAt: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMS delivery failed';
    const providerResponse =
      error instanceof SmsProviderError ? jsonValue(error.providerResponse) : undefined;

    if (attempt < env.SMS_MAX_ATTEMPTS) {
      const delayMinutes = env.SMS_RETRY_BASE_MINUTES * 2 ** (attempt - 1);
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'FAILED',
          error: message,
          ...(providerResponse !== undefined ? { providerResponse } : {}),
          nextRetryAt: new Date(Date.now() + delayMinutes * 60_000),
        },
      });
    } else {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'FAILED',
          error: message,
          ...(providerResponse !== undefined ? { providerResponse } : {}),
          nextRetryAt: null,
        },
      });

      if (allowFallback && notification.kind === 'PRIMARY') {
        await sendFallbackForDeliveryFailure(notification.alertId, message);
      }
    }

    logger.warn(
      {
        notificationId: notification.id,
        alertId: notification.alertId,
        attempt,
        error: message,
      },
      'SMS delivery failed',
    );
  }
}

async function createAndDeliverSms(
  alertId: string,
  recipient: Person,
  kind: NotificationKind,
  error: string | null,
  allowFallback: boolean,
): Promise<void> {
  const provider = getSmsProvider();
  const notification = await prisma.notification.create({
    data: {
      alertId,
      userId: recipient.userId,
      channel: 'SMS',
      kind,
      status: 'PENDING',
      recipient: recipient.phone,
      provider: provider.name,
      attempt: 1,
      error,
    },
  });

  await deliverNotification(notification.id, { allowFallback });
}

export async function notifyAlert(alertId: string): Promise<void> {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      drain: {
        select: {
          id: true,
          name: true,
          zone: true,
          fallbackContact: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              active: true,
              smsOptIn: true,
              inAppOptIn: true,
            },
          },
        },
      },
    },
  });

  if (!alert) return;

  const assigned = await assignedUsers(alert.drainId, alert.drain.zone);

  for (const user of assigned.filter((item) => item.inAppOptIn)) {
    await prisma.notification.create({
      data: {
        alertId: alert.id,
        userId: user.userId,
        channel: 'IN_APP',
        kind: 'PRIMARY',
        status: 'SENT',
        recipient: user.email ?? user.userId ?? 'in-app',
        provider: 'in-app',
        sentAt: new Date(),
      },
    });
  }

  const primary = dedupeByPhone(assigned.filter((user) => user.smsOptIn));
  const recipients = primary.length > 0 ? primary : await fallbackRecipients(alert.drain);

  if (recipients.length === 0) {
    await writeAudit({
      action: 'NOTIFICATION_NO_RECIPIENT',
      entityType: 'ALERT',
      entityId: alert.id,
      metadata: { drainId: alert.drainId, type: alert.type },
    });
    logger.warn({ alertId: alert.id, drainId: alert.drainId }, 'No SMS recipients configured for alert');
    return;
  }

  for (const recipient of recipients) {
    await createAndDeliverSms(
      alert.id,
      recipient,
      'PRIMARY',
      primary.length === 0 ? 'FALLBACK: no assigned contact, used fallback contact' : null,
      true,
    );
  }
}

export async function sendFallbackForDeliveryFailure(
  alertId: string,
  reason: string,
): Promise<number> {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      drain: {
        select: {
          id: true,
          name: true,
          zone: true,
          fallbackContact: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              active: true,
              smsOptIn: true,
              inAppOptIn: true,
            },
          },
        },
      },
    },
  });

  if (!alert) return 0;

  const recipients = await fallbackRecipients(alert.drain);
  if (recipients.length === 0) {
    await writeAudit({
      action: 'NOTIFICATION_FALLBACK_UNAVAILABLE',
      entityType: 'ALERT',
      entityId: alert.id,
      metadata: { reason },
    });
    return 0;
  }

  const existing = await prisma.notification.findMany({
    where: { alertId },
    select: { recipient: true },
  });
  const alreadyNotified = new Set(existing.map((item) => item.recipient));
  const fresh = recipients.filter((recipient) => !alreadyNotified.has(recipient.phone));

  for (const recipient of fresh) {
    await createAndDeliverSms(
      alert.id,
      recipient,
      'ESCALATION',
      `FALLBACK: ${reason}`,
      false,
    );
  }

  await writeAudit({
    action: 'NOTIFICATION_FALLBACK_SENT',
    entityType: 'ALERT',
    entityId: alert.id,
    metadata: { reason, recipients: fresh.map((item) => item.phone) },
  });

  return fresh.length;
}

export async function retryFailedNotifications(): Promise<number> {
  const now = new Date();
  const failed = await prisma.notification.findMany({
    where: {
      channel: 'SMS',
      status: 'FAILED',
      nextRetryAt: { lte: now },
    },
    select: { id: true, kind: true },
    orderBy: { nextRetryAt: 'asc' },
    take: 50,
  });

  for (const notification of failed) {
    await deliverNotification(notification.id, {
      isRetry: true,
      allowFallback: notification.kind === 'PRIMARY',
    });
  }

  return failed.length;
}

export async function escalateUnacknowledgedAlerts(): Promise<number> {
  const now = new Date();
  const alerts = await prisma.alert.findMany({
    where: {
      status: 'ACTIVE',
      escalatedAt: null,
      escalationDueAt: { lte: now },
    },
    include: {
      drain: {
        select: {
          id: true,
          name: true,
          zone: true,
          fallbackContact: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              active: true,
              smsOptIn: true,
              inAppOptIn: true,
            },
          },
        },
      },
    },
    take: 50,
  });

  for (const alert of alerts) {
    const recipients = await fallbackRecipients(alert.drain);
    for (const recipient of recipients) {
      await createAndDeliverSms(
        alert.id,
        recipient,
        'ESCALATION',
        'UNACKNOWLEDGED_ESCALATION',
        false,
      );
    }

    await prisma.alert.update({
      where: { id: alert.id },
      data: { escalatedAt: new Date() },
    });

    await writeAudit({
      action: 'ALERT_ESCALATED',
      entityType: 'ALERT',
      entityId: alert.id,
      metadata: {
        drainId: alert.drainId,
        recipients: recipients.map((recipient) => recipient.phone),
      },
    });
  }

  return alerts.length;
}
