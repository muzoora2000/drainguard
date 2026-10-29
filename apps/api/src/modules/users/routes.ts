import { Router } from 'express';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, BadRequestError, NotFoundError } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { writeAudit } from '../../lib/audit';
import { idParamSchema, optionalPhoneSchema } from '../../lib/validation';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import { requireRoles } from '../../middleware/rbac';
import { serializeUser, userSelect } from '../auth/service';

const router = Router();
router.use(requireAuth, requireRoles('ADMIN'));

const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'password must contain a letter')
  .regex(/\d/, 'password must contain a number');

const listSchema = paginationSchema.extend({
  role: z.nativeEnum(Role).optional(),
  active: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  q: z.string().trim().max(200).optional(),
});

const createSchema = z.object({
  email: z.string().trim().email(),
  password: passwordSchema,
  name: z.string().trim().min(1).max(200),
  role: z.nativeEnum(Role),
  phone: optionalPhoneSchema,
  smsOptIn: z.boolean().optional(),
  inAppOptIn: z.boolean().optional(),
  isFallbackContact: z.boolean().optional(),
  active: z.boolean().optional(),
});

const updateSchema = z
  .object({
    email: z.string().trim().email().optional(),
    password: passwordSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    role: z.nativeEnum(Role).optional(),
    phone: optionalPhoneSchema,
    smsOptIn: z.boolean().optional(),
    inAppOptIn: z.boolean().optional(),
    isFallbackContact: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });

const assignmentsSchema = z.object({
  drainIds: z.array(z.string().min(1)).default([]),
  zones: z.array(z.string().trim().min(1).max(120)).default([]),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);
    const where = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { phone: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          ...userSelect,
          assignments: {
            select: { id: true, drainId: true, zone: true },
          },
        },
        orderBy: [{ role: 'asc' }, { name: 'asc' }],
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    res.json(paginated(users, total, page, pageSize));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        name: body.name,
        role: body.role,
        phone: body.phone || null,
        smsOptIn: body.smsOptIn ?? true,
        inAppOptIn: body.inAppOptIn ?? true,
        isFallbackContact: body.isFallbackContact ?? false,
        active: body.active ?? true,
      },
      select: userSelect,
    });

    await writeAudit({
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: user.id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { role: user.role, email: user.email },
      req,
    });

    res.status(201).json({ data: serializeUser(user) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...userSelect,
        assignments: {
          select: {
            id: true,
            drainId: true,
            zone: true,
            drain: { select: { id: true, name: true, zone: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundError('User');
    res.json({ data: user });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateSchema.parse(req.body);

    if (id === req.user!.id && body.active === false) {
      throw new BadRequestError('You cannot deactivate your own account');
    }
    if (id === req.user!.id && body.role && body.role !== 'ADMIN') {
      throw new BadRequestError('You cannot remove your own admin role');
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundError('User');

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(body.email !== undefined ? { email: body.email.toLowerCase() } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.smsOptIn !== undefined ? { smsOptIn: body.smsOptIn } : {}),
        ...(body.inAppOptIn !== undefined ? { inAppOptIn: body.inAppOptIn } : {}),
        ...(body.isFallbackContact !== undefined
          ? { isFallbackContact: body.isFallbackContact }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      },
      select: userSelect,
    });

    if (body.password || body.active === false) {
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await writeAudit({
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: {
        fields: Object.keys(body).filter((key) => key !== 'password'),
        passwordChanged: Boolean(body.password),
      },
      req,
    });

    res.json({ data: serializeUser(user) });
  }),
);

router.get(
  '/:id/assignments',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError('User');

    const assignments = await prisma.drainAssignment.findMany({
      where: { userId: id },
      include: { drain: { select: { id: true, name: true, zone: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ data: assignments });
  }),
);

router.put(
  '/:id/assignments',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = assignmentsSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundError('User');

    const drainIds = [...new Set(body.drainIds)];
    const zones = [...new Set(body.zones)];

    if (drainIds.length > 0) {
      const count = await prisma.drain.count({ where: { id: { in: drainIds } } });
      if (count !== drainIds.length) throw new BadRequestError('One or more drains do not exist');
    }

    await prisma.$transaction([
      prisma.drainAssignment.deleteMany({ where: { userId: id } }),
      ...(drainIds.length + zones.length > 0
        ? [
            prisma.drainAssignment.createMany({
              data: [
                ...drainIds.map((drainId) => ({ userId: id, drainId })),
                ...zones.map((zone) => ({ userId: id, zone })),
              ],
            }),
          ]
        : []),
    ]);

    const assignments = await prisma.drainAssignment.findMany({
      where: { userId: id },
      include: { drain: { select: { id: true, name: true, zone: true, status: true } } },
    });

    await writeAudit({
      action: 'USER_ASSIGNMENTS_UPDATED',
      entityType: 'USER',
      entityId: id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      metadata: { drainIds, zones },
      req,
    });

    res.json({ data: assignments });
  }),
);

export default router;
