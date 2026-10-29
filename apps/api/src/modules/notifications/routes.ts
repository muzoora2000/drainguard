import { Router } from 'express';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { getPagination, paginated, paginationSchema } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

const listSchema = paginationSchema.extend({
  channel: z.nativeEnum(NotificationChannel).optional(),
  status: z.nativeEnum(NotificationStatus).optional(),
  alertId: z.string().min(1).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listSchema.parse(req.query);
    const { page, pageSize, skip, take } = getPagination(query);
    const where = {
      userId: req.user!.id,
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.alertId ? { alertId: query.alertId } : {}),
    };

    const [notifications, total, recent] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: {
          alert: {
            select: {
              id: true,
              type: true,
              severity: true,
              status: true,
              message: true,
              createdAt: true,
              drain: { select: { id: true, name: true, zone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { userId: req.user!.id, channel: 'IN_APP', createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      }),
    ]);

    res.json({ ...paginated(notifications, total, page, pageSize), recent });
  }),
);

export default router;
