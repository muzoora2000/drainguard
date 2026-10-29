import { Router } from 'express';
import {
  AlertSeverity,
  AlertStatus,
  AlertType,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, BadRequestError } from '../../lib/errors';
import { isoDateSchema } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';

const router = Router();
router.use(requireAuth);

const rangeSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  zone: z.string().trim().max(120).optional(),
});

function resolveRange(query: z.infer<typeof rangeSchema>) {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
  if (from.getTime() > to.getTime()) throw new BadRequestError('from must be before to');
  return { from, to, zone: query.zone };
}

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const { from, to, zone } = resolveRange(rangeSchema.parse(req.query));
    const drainFilter = zone ? { drain: { zone } } : {};
    const alertWhere = { createdAt: { gte: from, lte: to }, ...drainFilter };

    const [
      drainsByStatus,
      devicesByHealth,
      alertsByStatus,
      alertsByType,
      alertsBySeverity,
      tasksByStatus,
      tasksByType,
      openTasks,
      overdueTasks,
      resolvedAlerts,
      acknowledgedAlerts,
      topDrains,
      alertTimestamps,
      rainfall,
    ] = await Promise.all([
      prisma.drain.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.device.groupBy({ by: ['healthStatus'], _count: { _all: true } }),
      prisma.alert.groupBy({ by: ['status'], where: alertWhere, _count: { _all: true } }),
      prisma.alert.groupBy({ by: ['type'], where: alertWhere, _count: { _all: true } }),
      prisma.alert.groupBy({ by: ['severity'], where: alertWhere, _count: { _all: true } }),
      prisma.maintenanceTask.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.maintenanceTask.groupBy({
        by: ['type'],
        where: { createdAt: { gte: from, lte: to }, ...drainFilter },
        _count: { _all: true },
      }),
      prisma.maintenanceTask.count({
        where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, ...drainFilter },
      }),
      prisma.maintenanceTask.count({
        where: {
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          dueAt: { lt: new Date() },
          ...drainFilter,
        },
      }),
      prisma.alert.findMany({
        where: { ...alertWhere, status: 'RESOLVED', resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        take: 5_000,
        orderBy: { resolvedAt: 'desc' },
      }),
      prisma.alert.findMany({
        where: { ...alertWhere, acknowledgedAt: { not: null } },
        select: { createdAt: true, acknowledgedAt: true },
        take: 5_000,
        orderBy: { acknowledgedAt: 'desc' },
      }),
      prisma.alert.groupBy({
        by: ['drainId'],
        where: alertWhere,
        _count: { drainId: true },
        orderBy: { _count: { drainId: 'desc' } },
        take: 5,
      }),
      prisma.alert.findMany({
        where: alertWhere,
        select: { createdAt: true },
        take: 50_000,
      }),
      prisma.rainfallReading.aggregate({
        where: {
          ...(zone ? { zone } : {}),
          recordedAt: { gte: from, lte: to },
        },
        _avg: { mmPerHour: true },
        _max: { mmPerHour: true },
        _count: { _all: true },
      }),
    ]);

    const topDrainDetails = await prisma.drain.findMany({
      where: { id: { in: topDrains.map((item) => item.drainId) } },
      select: { id: true, name: true, zone: true, latitude: true, longitude: true },
    });

    const average = (values: number[]): number | null => {
      if (values.length === 0) return null;
      return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
    };

    const resolutionMinutes = resolvedAlerts
      .filter((alert) => alert.resolvedAt)
      .map((alert) => (alert.resolvedAt!.getTime() - alert.createdAt.getTime()) / 60_000);
    const acknowledgementMinutes = acknowledgedAlerts
      .filter((alert) => alert.acknowledgedAt)
      .map((alert) => (alert.acknowledgedAt!.getTime() - alert.createdAt.getTime()) / 60_000);

    const dailyMap = new Map<string, number>();
    for (const alert of alertTimestamps) {
      const key = alert.createdAt.toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
    }

    const taskTotal = tasksByStatus.reduce((sum, item) => sum + item._count._all, 0);
    const done = tasksByStatus.find((item) => item.status === 'DONE')?._count._all ?? 0;

    res.json({
      data: {
        range: { from: from.toISOString(), to: to.toISOString(), zone: zone ?? null },
        generatedAt: new Date().toISOString(),
        drains: {
          total: drainsByStatus.reduce((sum, item) => sum + item._count._all, 0),
          byStatus: Object.fromEntries(drainsByStatus.map((item) => [item.status, item._count._all])),
        },
        devices: {
          total: devicesByHealth.reduce((sum, item) => sum + item._count._all, 0),
          byHealth: Object.fromEntries(
            devicesByHealth.map((item) => [item.healthStatus, item._count._all]),
          ),
        },
        alerts: {
          total: alertsByStatus.reduce((sum, item) => sum + item._count._all, 0),
          byStatus: Object.fromEntries(alertsByStatus.map((item) => [item.status, item._count._all])),
          byType: Object.fromEntries(alertsByType.map((item) => [item.type, item._count._all])),
          bySeverity: Object.fromEntries(
            alertsBySeverity.map((item) => [item.severity, item._count._all]),
          ),
          averageResolutionMinutes: average(resolutionMinutes),
          averageAcknowledgementMinutes: average(acknowledgementMinutes),
        },
        tasks: {
          total: taskTotal,
          open: openTasks,
          overdue: overdueTasks,
          completionRate: taskTotal === 0 ? null : Math.round((done / taskTotal) * 1000) / 10,
          byStatus: Object.fromEntries(tasksByStatus.map((item) => [item.status, item._count._all])),
          byType: Object.fromEntries(tasksByType.map((item) => [item.type, item._count._all])),
        },
        rainfall: {
          readings: rainfall._count._all,
          averageMmPerHour: rainfall._avg.mmPerHour,
          maxMmPerHour: rainfall._max.mmPerHour,
        },
        topProblemDrains: topDrains.map((item) => ({
          drain: topDrainDetails.find((drain) => drain.id === item.drainId) ?? null,
          alertCount: item._count.drainId,
        })),
        dailyAlerts: [...dailyMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count })),
      },
    });
  }),
);

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const csvSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  zone: z.string().trim().max(120).optional(),
  status: z.nativeEnum(AlertStatus).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  type: z.nativeEnum(AlertType).optional(),
});

router.get(
  '/alerts.csv',
  requireRoles('ADMIN', 'SUPERVISOR'),
  asyncHandler(async (req, res) => {
    const query = csvSchema.parse(req.query);
    const { from, to } = resolveRange(query);
    const alerts = await prisma.alert.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(query.zone ? { drain: { zone: query.zone } } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      include: {
        drain: { select: { name: true, zone: true } },
        device: { select: { name: true, type: true } },
        acknowledgedBy: { select: { name: true } },
        resolvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });

    const header = [
      'Alert ID',
      'Created At',
      'Drain',
      'Zone',
      'Device',
      'Type',
      'Severity',
      'Status',
      'Rule',
      'Message',
      'Acknowledged At',
      'Acknowledged By',
      'Resolved At',
      'Resolved By',
      'Resolution Note',
    ];

    const lines = [
      header.map(csvCell).join(','),
      ...alerts.map((alert) =>
        [
          alert.id,
          alert.createdAt.toISOString(),
          alert.drain.name,
          alert.drain.zone,
          alert.device?.name ?? '',
          alert.type,
          alert.severity,
          alert.status,
          alert.rule,
          alert.message ?? '',
          alert.acknowledgedAt?.toISOString() ?? '',
          alert.acknowledgedBy?.name ?? '',
          alert.resolvedAt?.toISOString() ?? '',
          alert.resolvedBy?.name ?? '',
          alert.resolutionNote ?? '',
        ]
          .map(csvCell)
          .join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="drainguard-alerts-${from.toISOString().slice(0, 10)}-to-${to
        .toISOString()
        .slice(0, 10)}.csv"`,
    );
    res.send(`\uFEFF${lines.join('\r\n')}`);
  }),
);

const taskCsvSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  zone: z.string().trim().max(120).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  type: z.nativeEnum(TaskType).optional(),
});

router.get(
  '/tasks.csv',
  requireRoles('ADMIN', 'SUPERVISOR'),
  asyncHandler(async (req, res) => {
    const query = taskCsvSchema.parse(req.query);
    const { from, to } = resolveRange(query);
    const tasks = await prisma.maintenanceTask.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(query.zone ? { drain: { zone: query.zone } } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      include: {
        drain: { select: { name: true, zone: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });

    const header = [
      'Task ID',
      'Created At',
      'Drain',
      'Zone',
      'Type',
      'Title',
      'Priority',
      'Status',
      'Assigned To',
      'Scheduled For',
      'Due At',
      'Started At',
      'Completed At',
    ];

    const lines = [
      header.map(csvCell).join(','),
      ...tasks.map((task) =>
        [
          task.id,
          task.createdAt.toISOString(),
          task.drain.name,
          task.drain.zone,
          task.type,
          task.title,
          task.priority,
          task.status,
          task.assignedTo?.name ?? '',
          task.scheduledFor?.toISOString() ?? '',
          task.dueAt?.toISOString() ?? '',
          task.startedAt?.toISOString() ?? '',
          task.completedAt?.toISOString() ?? '',
        ]
          .map(csvCell)
          .join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="drainguard-tasks-${from.toISOString().slice(0, 10)}-to-${to
        .toISOString()
        .slice(0, 10)}.csv"`,
    );
    res.send(`\uFEFF${lines.join('\r\n')}`);
  }),
);

export default router;
