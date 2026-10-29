import { Router } from 'express';
import { Prisma, TaskPriority, TaskStatus, TaskType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import {
  asyncHandler,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors';
import { idParamSchema, isoDateSchema, notesSchema } from '../../lib/validation';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';
import { writeAudit } from '../../lib/audit';

const router = Router();
router.use(requireAuth);

const taskInclude = {
  drain: { select: { id: true, name: true, zone: true, latitude: true, longitude: true } },
  assignedTo: { select: { id: true, name: true, email: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  alert: { select: { id: true, type: true, severity: true, status: true } },
  _count: { select: { records: true } },
} as const;

const listSchema = paginationSchema.extend({
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  type: z.nativeEnum(TaskType).optional(),
  drainId: z.string().min(1).optional(),
  assignedToId: z.string().min(1).optional(),
  overdue: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  mine: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);

    const isTechnician = req.user!.role === 'TECHNICIAN';
    const where: Prisma.MaintenanceTaskWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.drainId ? { drainId: query.drainId } : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.overdue
        ? {
            dueAt: { lt: new Date() },
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          }
        : {}),
      ...(isTechnician && !query.assignedToId
        ? {
            OR: [{ assignedToId: req.user!.id }, { assignedToId: null }],
          }
        : {}),
      ...(query.mine ? { assignedToId: req.user!.id } : {}),
    };

    const [tasks, total] = await Promise.all([
      prisma.maintenanceTask.findMany({
        where,
        include: taskInclude,
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      prisma.maintenanceTask.count({ where }),
    ]);

    res.json(paginated(tasks, total, page, pageSize));
  }),
);

const createSchema = z.object({
  drainId: z.string().min(1),
  alertId: z.string().min(1).optional().nullable(),
  type: z.nativeEnum(TaskType),
  title: z.string().trim().min(1).max(300),
  priority: z.nativeEnum(TaskPriority).optional(),
  notes: z.string().trim().max(5000).optional(),
  assignedToId: z.string().min(1).optional().nullable(),
  scheduledFor: isoDateSchema.optional().nullable(),
  dueAt: isoDateSchema.optional().nullable(),
});

router.post(
  '/',
  requireRoles('ADMIN', 'SUPERVISOR'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const drain = await prisma.drain.findUnique({ where: { id: body.drainId }, select: { id: true } });
    if (!drain) throw new NotFoundError('Drain');

    if (body.assignedToId) {
      const user = await prisma.user.findUnique({
        where: { id: body.assignedToId },
        select: { id: true, active: true },
      });
      if (!user || !user.active) throw new NotFoundError('Assignee');
    }

    const task = await prisma.maintenanceTask.create({
      data: {
        drainId: body.drainId,
        alertId: body.alertId ?? null,
        type: body.type,
        title: body.title,
        priority: body.priority ?? 'MEDIUM',
        notes: body.notes ?? null,
        assignedToId: body.assignedToId ?? null,
        createdById: req.user!.id,
        scheduledFor: body.scheduledFor ?? null,
        dueAt: body.dueAt ?? null,
      },
      include: taskInclude,
    });

    await writeAudit({
      action: 'TASK_CREATED',
      entityType: 'TASK',
      entityId: task.id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { drainId: task.drainId, type: task.type, priority: task.priority },
      req,
    });

    res.status(201).json({ data: task });
  }),
);

async function findTaskOrThrow(id: string) {
  const task = await prisma.maintenanceTask.findUnique({
    where: { id },
    include: taskInclude,
  });
  if (!task) throw new NotFoundError('Task');
  return task;
}

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const task = await findTaskOrThrow(id);
    if (
      req.user!.role === 'TECHNICIAN' &&
      task.assignedToId &&
      task.assignedToId !== req.user!.id
    ) {
      throw new ForbiddenError('This task is assigned to another technician');
    }

    const records = await prisma.maintenanceRecord.findMany({
      where: { taskId: id },
      include: { performedBy: { select: { id: true, name: true } } },
      orderBy: { completedAt: 'desc' },
    });

    res.json({ data: { ...task, records } });
  }),
);

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    priority: z.nativeEnum(TaskPriority).optional(),
    status: z.nativeEnum(TaskStatus).optional(),
    notes: z.string().trim().max(5000).optional(),
    assignedToId: z.string().min(1).optional().nullable(),
    scheduledFor: isoDateSchema.optional().nullable(),
    dueAt: isoDateSchema.optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateSchema.parse(req.body);
    const existing = await findTaskOrThrow(id);
    const role = req.user!.role;

    if (role === 'TECHNICIAN') {
      if (existing.assignedToId && existing.assignedToId !== req.user!.id) {
        throw new ForbiddenError('This task is assigned to another technician');
      }
      if (body.assignedToId && body.assignedToId !== req.user!.id) {
        throw new ForbiddenError('Technicians can only assign tasks to themselves');
      }
      const restricted = ['title', 'priority', 'scheduledFor', 'dueAt'] as const;
      if (restricted.some((key) => body[key] !== undefined)) {
        throw new ForbiddenError('Technicians may only update status, notes and assignment');
      }
    }

    if (body.assignedToId) {
      const user = await prisma.user.findUnique({
        where: { id: body.assignedToId },
        select: { id: true, active: true },
      });
      if (!user || !user.active) throw new NotFoundError('Assignee');
    }

    if (existing.status === 'DONE' && body.status && body.status !== 'DONE' && role === 'TECHNICIAN') {
      throw new ConflictError('Completed tasks can only be reopened by a supervisor');
    }

    const now = new Date();
    const status = body.status;
    const data: Prisma.MaintenanceTaskUpdateInput = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.scheduledFor !== undefined ? { scheduledFor: body.scheduledFor } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
      ...(body.assignedToId !== undefined
        ? body.assignedToId
          ? { assignedTo: { connect: { id: body.assignedToId } } }
          : { assignedTo: { disconnect: true } }
        : {}),
      ...(status !== undefined ? { status } : {}),
      ...(status === 'IN_PROGRESS' && !existing.startedAt ? { startedAt: now } : {}),
      ...(status === 'DONE'
        ? { completedAt: now }
        : status !== undefined && existing.status === 'DONE'
          ? { completedAt: null }
          : {}),
    };

    if (role === 'TECHNICIAN' && !existing.assignedToId && status === 'IN_PROGRESS') {
      data.assignedTo = { connect: { id: req.user!.id } };
    }

    const task = await prisma.maintenanceTask.update({
      where: { id },
      data,
      include: taskInclude,
    });

    await writeAudit({
      action: 'TASK_UPDATED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { fields: Object.keys(body), status: task.status },
      req,
    });

    res.json({ data: task });
  }),
);

router.delete(
  '/:id',
  requireRoles('ADMIN', 'SUPERVISOR'),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const existing = await findTaskOrThrow(id);
    if (existing.status === 'DONE') {
      throw new ConflictError('Completed tasks cannot be cancelled');
    }

    const task = await prisma.maintenanceTask.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: taskInclude,
    });

    await writeAudit({
      action: 'TASK_CANCELLED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      req,
    });

    res.json({ data: task });
  }),
);

const recordSchema = z.object({
  notes: notesSchema,
  actionsTaken: z.string().trim().max(5000).optional(),
  photos: z.array(z.string().trim().url()).max(20).optional(),
  completedAt: isoDateSchema.optional(),
});

router.post(
  '/:id/records',
  requireRoles('ADMIN', 'SUPERVISOR', 'TECHNICIAN'),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = recordSchema.parse(req.body);
    const existing = await findTaskOrThrow(id);

    if (
      req.user!.role === 'TECHNICIAN' &&
      existing.assignedToId &&
      existing.assignedToId !== req.user!.id
    ) {
      throw new ForbiddenError('This task is assigned to another technician');
    }

    const completedAt = body.completedAt ?? new Date();

    const [record] = await prisma.$transaction([
      prisma.maintenanceRecord.create({
        data: {
          taskId: id,
          drainId: existing.drainId,
          performedById: req.user!.id,
          notes: body.notes,
          actionsTaken: body.actionsTaken ?? null,
          photos: body.photos ? (body.photos as Prisma.InputJsonValue) : undefined,
          completedAt,
        },
        include: { performedBy: { select: { id: true, name: true } } },
      }),
      prisma.maintenanceTask.update({
        where: { id },
        data: {
          status: 'DONE',
          completedAt,
          ...(existing.assignedToId ? {} : { assignedToId: req.user!.id }),
        },
      }),
    ]);

    await writeAudit({
      action: 'TASK_RECORD_ADDED',
      entityType: 'TASK',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { recordId: record.id, drainId: existing.drainId },
      req,
    });

    res.status(201).json({ data: record });
  }),
);

export default router;
