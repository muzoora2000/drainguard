import { Prisma, type AlertType, type SensorReading } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/audit';
import { sseHub } from '../realtime/sse';
import { DEFAULT_THRESHOLDS } from '../rules/defaults';
import { evaluateRules } from '../rules/engine';
import type {
  OpenAlertDecision,
  ReadingSnapshot,
  RuleInput,
  RuleThresholds,
  SuppressedDecision,
} from '../rules/types';
import { notifyAlert } from './notifications';

export interface EvaluationSummary {
  drainId: string;
  decisions: number;
  createdAlertIds: string[];
  resolvedAlertIds: string[];
}

function thresholdValues(row: {
  basketFillPercent: number;
  waterRiseRateCmPerMin: Prisma.Decimal | number;
  levelDifferenceCm: Prisma.Decimal | number;
  differencePersistMinutes: number;
  intenseRainfallMmPerHour: Prisma.Decimal | number;
  rainfallLookbackMinutes: number;
  heartbeatTimeoutMinutes: number;
  repeatBlockageCount: number;
  repeatBlockageWindowDays: number;
  alertCooldownMinutes: number;
  escalationMinutes: number;
  riseRateWindowMinutes: number;
  levelMatchWindowMinutes: number;
} | null): RuleThresholds {
  if (!row) return DEFAULT_THRESHOLDS;
  return {
    basketFillPercent: row.basketFillPercent,
    waterRiseRateCmPerMin: Number(row.waterRiseRateCmPerMin),
    levelDifferenceCm: Number(row.levelDifferenceCm),
    differencePersistMinutes: row.differencePersistMinutes,
    intenseRainfallMmPerHour: Number(row.intenseRainfallMmPerHour),
    rainfallLookbackMinutes: row.rainfallLookbackMinutes,
    heartbeatTimeoutMinutes: row.heartbeatTimeoutMinutes,
    repeatBlockageCount: row.repeatBlockageCount,
    repeatBlockageWindowDays: row.repeatBlockageWindowDays,
    alertCooldownMinutes: row.alertCooldownMinutes,
    escalationMinutes: row.escalationMinutes,
    riseRateWindowMinutes: row.riseRateWindowMinutes,
    levelMatchWindowMinutes: row.levelMatchWindowMinutes,
  };
}

function toReadingSnapshot(reading: SensorReading): ReadingSnapshot {
  return {
    id: reading.id.toString(),
    deviceId: reading.deviceId,
    type: reading.type,
    value: reading.type === 'LITTER' ? reading.litterFillPercent ?? 0 : reading.waterLevelCm ?? 0,
    quality: reading.quality,
    recordedAt: reading.recordedAt,
  };
}

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function skipDuringCooldown(
  drainId: string,
  decision: OpenAlertDecision,
  thresholds: RuleThresholds,
  now: Date,
): Promise<boolean> {
  const latest = await prisma.alert.findFirst({
    where: {
      drainId,
      type: decision.type,
      status: 'RESOLVED',
      resolvedAt: { not: null },
    },
    orderBy: { resolvedAt: 'desc' },
    select: { resolvedAt: true },
  });

  if (!latest?.resolvedAt) return false;
  const cooldownEnds = latest.resolvedAt.getTime() + thresholds.alertCooldownMinutes * 60_000;
  return now.getTime() < cooldownEnds;
}

async function recordSuppressed(
  drainId: string,
  decision: SuppressedDecision,
  now: Date,
): Promise<void> {
  const recent = await prisma.auditLog.findFirst({
    where: {
      action: 'ALERT_SUPPRESSED',
      entityType: 'DRAIN',
      entityId: drainId,
      createdAt: { gte: new Date(now.getTime() - 10 * 60_000) },
    },
    select: { id: true },
  });
  if (recent) return;

  await writeAudit({
    action: 'ALERT_SUPPRESSED',
    entityType: 'DRAIN',
    entityId: drainId,
    metadata: {
      type: decision.type,
      rule: decision.rule,
      reason: decision.reason,
      triggerData: decision.triggerData,
    },
  });
}

async function openAlert(
  drainId: string,
  decision: OpenAlertDecision,
  thresholds: RuleThresholds,
  now: Date,
): Promise<string | null> {
  if (await skipDuringCooldown(drainId, decision, thresholds, now)) {
    await writeAudit({
      action: 'ALERT_COOLDOWN',
      entityType: 'DRAIN',
      entityId: drainId,
      metadata: { type: decision.type, rule: decision.rule },
    });
    return null;
  }

  try {
    const alert = await prisma.$transaction(async (tx) => {
      const created = await tx.alert.create({
        data: {
          drainId,
          deviceId: decision.deviceId ?? null,
          type: decision.type,
          severity: decision.severity,
          status: 'ACTIVE',
          rule: decision.rule,
          message: decision.message,
          triggerData: decision.triggerData as Prisma.InputJsonValue,
          activeKey: `${drainId}:${decision.type}`,
          escalationDueAt: new Date(now.getTime() + thresholds.escalationMinutes * 60_000),
        },
      });

      if (decision.createTask) {
        const existingTask = await tx.maintenanceTask.findFirst({
          where: {
            drainId,
            type: decision.createTask.type,
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
          select: { id: true },
        });

        if (!existingTask) {
          await tx.maintenanceTask.create({
            data: {
              drainId,
              alertId: created.id,
              type: decision.createTask.type,
              priority: decision.createTask.priority,
              status: 'SCHEDULED',
              title: decision.createTask.title,
              notes: decision.message,
            },
          });
        }
      }

      return created;
    });

    await writeAudit({
      action: 'ALERT_OPENED',
      entityType: 'ALERT',
      entityId: alert.id,
      metadata: {
        drainId,
        type: alert.type,
        severity: alert.severity,
        rule: alert.rule,
        deviceId: alert.deviceId,
      },
    });

    sseHub.publish('alert.created', {
      alert: {
        id: alert.id,
        drainId: alert.drainId,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        rule: alert.rule,
        message: alert.message,
        createdAt: alert.createdAt.toISOString(),
      },
    });

    await notifyAlert(alert.id).catch((error) => {
      logger.error({ err: error, alertId: alert.id }, 'Alert notification failed');
    });

    return alert.id;
  } catch (error) {
    if (isUniqueError(error)) return null;
    throw error;
  }
}

async function resolveAlert(
  drainId: string,
  decision: { alertId: string; reason: string; alertType: AlertType },
  now: Date,
): Promise<boolean> {
  const result = await prisma.alert.updateMany({
    where: {
      id: decision.alertId,
      drainId,
      status: { in: ['ACTIVE', 'ACKNOWLEDGED'] },
    },
    data: {
      status: 'RESOLVED',
      resolvedAt: now,
      resolutionNote: decision.reason,
      activeKey: null,
    },
  });

  if (result.count === 0) return false;

  await writeAudit({
    action: 'ALERT_RESOLVED',
    entityType: 'ALERT',
    entityId: decision.alertId,
    metadata: { drainId, type: decision.alertType, reason: decision.reason },
  });

  sseHub.publish('alert.resolved', {
    alertId: decision.alertId,
    drainId,
    type: decision.alertType,
    status: 'RESOLVED',
    resolvedAt: now.toISOString(),
  });

  return true;
}

export async function evaluateDrain(drainId: string, now: Date = new Date()): Promise<EvaluationSummary> {
  const drain = await prisma.drain.findUnique({
    where: { id: drainId },
    include: { thresholds: true, devices: true },
  });

  if (!drain || drain.status === 'INACTIVE') {
    return { drainId, decisions: 0, createdAlertIds: [], resolvedAlertIds: [] };
  }

  const thresholds = thresholdValues(drain.thresholds);
  const maxWindowMinutes = Math.max(
    thresholds.riseRateWindowMinutes,
    thresholds.differencePersistMinutes + thresholds.levelMatchWindowMinutes * 2,
    thresholds.heartbeatTimeoutMinutes,
  );
  const readingCutoff = new Date(now.getTime() - maxWindowMinutes * 60_000);

  const [waterReadings, litterReadings, latestRainfall, openAlerts, recentBlockages, lastReview, openTasks] =
    await Promise.all([
      prisma.sensorReading.findMany({
        where: {
          drainId,
          type: { in: ['WATER_UPSTREAM', 'WATER_DOWNSTREAM'] },
          recordedAt: { gte: readingCutoff, lte: now },
        },
        orderBy: { recordedAt: 'asc' },
        take: 5_000,
      }),
      prisma.sensorReading.findMany({
        where: {
          drainId,
          type: 'LITTER',
          recordedAt: { lte: now },
        },
        orderBy: { recordedAt: 'desc' },
        take: 20,
      }),
      prisma.rainfallReading.findFirst({
        where: {
          zone: drain.zone,
          recordedAt: {
            gte: new Date(now.getTime() - thresholds.rainfallLookbackMinutes * 60_000),
            lte: now,
          },
        },
        orderBy: { recordedAt: 'desc' },
        select: { mmPerHour: true, recordedAt: true },
      }),
      prisma.alert.findMany({
        where: { drainId, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
        select: {
          id: true,
          type: true,
          severity: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
          triggerData: true,
        },
      }),
      prisma.alert.findMany({
        where: {
          drainId,
          type: 'POSSIBLE_BLOCKAGE',
          createdAt: {
            gte: new Date(now.getTime() - thresholds.repeatBlockageWindowDays * 86_400_000),
          },
        },
        select: { id: true, createdAt: true },
      }),
      prisma.alert.findFirst({
        where: {
          drainId,
          type: 'ENGINEERING_REVIEW',
          status: 'RESOLVED',
          resolvedAt: { not: null },
        },
        orderBy: { resolvedAt: 'desc' },
        select: { resolvedAt: true },
      }),
      prisma.maintenanceTask.findMany({
        where: { drainId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        select: { id: true, type: true, status: true },
      }),
    ]);

  const input: RuleInput = {
    now,
    drain: {
      id: drain.id,
      name: drain.name,
      zone: drain.zone,
      status: drain.status,
      thresholds,
    },
    devices: drain.devices.map((device) => ({
      id: device.id,
      name: device.name,
      type: device.type,
      healthStatus: device.healthStatus,
      healthReason: device.healthReason,
      lastSeenAt: device.lastSeenAt,
      lastReadingAt: device.lastReadingAt,
    })),
    waterReadings: waterReadings.map(toReadingSnapshot),
    litterReadings: litterReadings.map(toReadingSnapshot),
    rainfall: latestRainfall
      ? { mmPerHour: Number(latestRainfall.mmPerHour), recordedAt: latestRainfall.recordedAt }
      : null,
    openAlerts,
    recentBlockageAlerts: recentBlockages,
    lastResolvedEngineeringReviewAt: lastReview?.resolvedAt ?? null,
    openTasks,
  };

  const decisions = evaluateRules(input);
  const createdAlertIds: string[] = [];
  const resolvedAlertIds: string[] = [];

  for (const decision of decisions) {
    if (decision.kind === 'SUPPRESSED') {
      await recordSuppressed(drainId, decision, now);
      continue;
    }

    if (decision.kind === 'RESOLVE_ALERT') {
      const resolved = await resolveAlert(drainId, decision, now);
      if (resolved) resolvedAlertIds.push(decision.alertId);
      continue;
    }

    const alertId = await openAlert(drainId, decision, thresholds, now);
    if (alertId) createdAlertIds.push(alertId);
  }

  return {
    drainId,
    decisions: decisions.length,
    createdAlertIds,
    resolvedAlertIds,
  };
}

export async function evaluateAllDrains(now: Date = new Date()): Promise<EvaluationSummary[]> {
  const drains = await prisma.drain.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const results: EvaluationSummary[] = [];
  for (const drain of drains) {
    try {
      results.push(await evaluateDrain(drain.id, now));
    } catch (error) {
      logger.error({ err: error, drainId: drain.id }, 'Rule evaluation failed for drain');
    }
  }

  return results;
}
