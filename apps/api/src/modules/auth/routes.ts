import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { changePassword, login, logout, refreshSession, serializeUser } from './service';

const router = Router();

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const session = await login(body.email, body.password, req);
    res.json({ data: session });
  }),
);

router.post(
  '/refresh',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    const session = await refreshSession(body.refreshToken, req);
    res.json({ data: session });
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    await logout(body.refreshToken, req);
    res.status(204).send();
  }),
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ data: serializeUser(req.user!) });
});

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    await changePassword(req.user!.id, body.currentPassword, body.newPassword, req);
    res.status(204).send();
  }),
);

export default router;
