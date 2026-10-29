import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';

const router = Router();

export async function healthPayload() {
  const started = Date.now();
  let database = 'ok';
  let databaseLatencyMs: number | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseLatencyMs = Date.now() - started;
  } catch {
    database = 'unavailable';
  }

  return {
    status: database === 'ok' ? 'ok' : 'degraded',
    service: 'drainguard-api',
    version: process.env.npm_package_version ?? '1.0.0',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: {
      database: { status: database, latencyMs: databaseLatencyMs },
    },
  };
}

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const payload = await healthPayload();
    res.status(payload.status === 'ok' ? 200 : 503).json({ data: payload });
  }),
);

router.get(
  '/system/health',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const payload = await healthPayload();
    const [users, drains, devices, readings, rainfall, alerts, tasks, notifications] =
      await Promise.all([
        prisma.user.count(),
        prisma.drain.count(),
        prisma.device.count(),
        prisma.sensorReading.count(),
        prisma.rainfallReading.count(),
        prisma.alert.count(),
        prisma.maintenanceTask.count(),
        prisma.notification.count(),
      ]);

    res.status(payload.status === 'ok' ? 200 : 503).json({
      data: {
        ...payload,
        counts: { users, drains, devices, readings, rainfall, alerts, tasks, notifications },
        jobs: {
          enabled: env.JOBS_ENABLED,
          offlineCron: env.OFFLINE_JOB_CRON,
          rulesCron: env.RULE_SWEEP_CRON,
          notificationRetryCron: env.NOTIFICATION_RETRY_CRON,
          escalationCron: env.ESCALATION_CRON,
        },
        smsProvider: env.SMS_PROVIDER,
      },
    });
  }),
);

const auditSchema = paginationSchema.extend({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  entityId: z.string().trim().max(120).optional(),
  actorId: z.string().trim().max(120).optional(),
});

router.get(
  '/system/audit-logs',
  requireAuth,
  requireRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const query = auditSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);
    const where = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json(
      paginated(
        logs.map((log) => ({ ...log, id: log.id.toString() })),
        total,
        page,
        pageSize,
      ),
    );
  }),
);

export default router;
