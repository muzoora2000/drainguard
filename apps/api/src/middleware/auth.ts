import type { Request, RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { UnauthorizedError } from '../lib/errors';
import { sha256 } from '../lib/crypto';
import { verifyAccessToken } from '../modules/auth/tokens';

function extractBearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') return null;
  return token;
}

function extractDeviceKey(req: Request): string | null {
  const direct = req.get('x-device-key');
  if (direct) return direct.trim();

  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'device') return null;
  return token;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedError();

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        smsOptIn: true,
        inAppOptIn: true,
        isFallbackContact: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!user || !user.active) throw new UnauthorizedError('Account is inactive or no longer exists');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireDevice: RequestHandler = async (req, _res, next) => {
  try {
    const apiKey = extractDeviceKey(req);
    if (!apiKey) throw new UnauthorizedError('Device API key is required');

    const device = await prisma.device.findUnique({
      where: { apiKeyHash: sha256(apiKey) },
      select: {
        id: true,
        drainId: true,
        name: true,
        type: true,
        drain: { select: { id: true, name: true, zone: true, status: true } },
      },
    });

    if (!device) throw new UnauthorizedError('Invalid device API key');
    req.device = device;
    next();
  } catch (error) {
    next(error);
  }
};

export { extractDeviceKey, extractBearer };
