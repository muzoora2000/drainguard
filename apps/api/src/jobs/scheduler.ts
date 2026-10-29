import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/audit';
import { sseHub } from '../realtime/sse';
import { evaluateAllDrains } from '../services/rule-application';
import { scheduleDrainEvaluation } from '../services/rule-queue';
import {
  escalateUnacknowledgedAlerts,
  retryFailedNotifications,
} from '../services/notifications';

const tasks: ScheduledTask[] = [];
let running: Record<string, boolean> = {};

async function once(name: string, work: () => Promise<unknown>): Promise<void> {
  if (running[name]) {
    logger.warn({ job: name }, 'Scheduled job skipped because the previous run is still active');
    return;
  }

  running[name] = true;
  const started = Date.now();
  try {
    const result = await work();
    logger.debug({ job: name, ms: Date.now() - started, result }, 'Scheduled job completed');
  } catch (error) {
    logger.error({ err: error, job: name }, 'Scheduled job failed');
  } finally {
    running[name] = false;
  }
}

export async function markOfflineDevices(now: Date = new Date()): Promise<number> {
  const devices = await prisma.device.findMany({
    where: { healthStatus: 'HEALTHY' },
    include: {
      drain: {
        select: {
          id: true,
          thresholds: { select: { heartbeatTimeoutMinutes: true } },
        },
      },
    },
  });

  const affectedDrains = new Set<string>();
  let marked = 0;

  for (const device of devices) {
    const timeout = device.drain.thresholds?.heartbeatTimeoutMinutes ?? 10;
    const cutoff = now.getTime() - timeout * 60_000;
    const silent = !device.lastSeenAt || device.lastSeenAt.getTime() < cutoff;
    if (!silent) continue;

    const minutes = device.lastSeenAt
      ? Math.round((now.getTime() - device.lastSeenAt.getTime()) / 60_000)
      : null;
    const reason =
      minutes === null
        ? 'No heartbeat has been received'
        : `No heartbeat for ${minutes} minutes (timeout ${timeout} minutes)`;

    await prisma.device.update({
      where: { id: device.id },
      data: {
        healthStatus: 'OFFLINE',
        healthReason: reason,
        healthUpdatedAt: now,
      },
    });

    await writeAudit({
      action: 'DEVICE_OFFLINE',
      entityType: 'DEVICE',
      entityId: device.id,
      metadata: { drainId: device.drainId, reason },
    });

    sseHub.publish('device.updated', {
      deviceId: device.id,
      drainId: device.drainId,
      healthStatus: 'OFFLINE',
      healthReason: reason,
    });

    affectedDrains.add(device.drainId);
    marked += 1;
  }

  for (const drainId of affectedDrains) {
    scheduleDrainEvaluation(drainId);
  }

  return marked;
}

export function startScheduler(): void {
  if (!env.JOBS_ENABLED) {
    logger.info('Scheduler disabled (JOBS_ENABLED=false)');
    return;
  }

  tasks.push(
    cron.schedule(
      env.OFFLINE_JOB_CRON,
      () => {
        void once('offline-devices', () => markOfflineDevices());
      },
      { timezone: 'UTC' },
    ),
    cron.schedule(
      env.RULE_SWEEP_CRON,
      () => {
        void once('rule-sweep', () => evaluateAllDrains());
      },
      { timezone: 'UTC' },
    ),
    cron.schedule(
      env.NOTIFICATION_RETRY_CRON,
      () => {
        void once('notification-retry', () => retryFailedNotifications());
      },
      { timezone: 'UTC' },
    ),
    cron.schedule(
      env.ESCALATION_CRON,
      () => {
        void once('alert-escalation', () => escalateUnacknowledgedAlerts());
      },
      { timezone: 'UTC' },
    ),
  );

  logger.info({ jobs: tasks.length }, 'Scheduler started');
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
  running = {};
}
