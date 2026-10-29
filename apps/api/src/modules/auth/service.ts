import type { Request } from 'express';
import type { Prisma, Role, User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { UnauthorizedError, ForbiddenError } from '../../lib/errors';
import { verifyPassword, hashPassword } from '../../lib/password';
import { sha256 } from '../../lib/crypto';
import { writeAudit } from '../../lib/audit';
import {
  accessTokenExpiresInSeconds,
  refreshTokenExpiresInSeconds,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './tokens';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  smsOptIn: boolean;
  inAppOptIn: boolean;
  isFallbackContact: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthSession {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

export function serializeUser(
  user: Pick<
    User,
    | 'id'
    | 'email'
    | 'name'
    | 'role'
    | 'phone'
    | 'active'
    | 'smsOptIn'
    | 'inAppOptIn'
    | 'isFallbackContact'
    | 'lastLoginAt'
    | 'createdAt'
  >,
): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    active: user.active,
    smsOptIn: user.smsOptIn,
    inAppOptIn: user.inAppOptIn,
    isFallbackContact: user.isFallbackContact,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
  };
}

async function persistRefreshToken(user: { id: string; role: Role }, req: Request): Promise<string> {
  const refreshToken = signRefreshToken(user);
  const meta = requestMeta(req);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + refreshTokenExpiresInSeconds() * 1000),
      createdByIp: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  return refreshToken;
}

export async function login(
  email: string,
  password: string,
  req: Request,
): Promise<AuthSession> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    await writeAudit({
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'USER',
      entityId: user?.id ?? null,
      metadata: { email: email.trim().toLowerCase() },
      req,
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const refreshToken = await persistRefreshToken(user, req);

  await writeAudit({
    action: 'AUTH_LOGIN',
    entityType: 'USER',
    entityId: user.id,
    actorId: user.id,
    actorRole: user.role,
    req,
  });

  return {
    user: serializeUser(updated),
    accessToken: signAccessToken(user),
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: accessTokenExpiresInSeconds(),
    refreshExpiresIn: refreshTokenExpiresInSeconds(),
  };
}

export async function refreshSession(refreshToken: string, req: Request): Promise<AuthSession> {
  const payload = verifyRefreshToken(refreshToken);
  const tokenHash = sha256(refreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored || stored.userId !== payload.sub) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit({
      action: 'AUTH_REFRESH_REUSE',
      entityType: 'USER',
      entityId: stored.userId,
      req,
    });
    throw new UnauthorizedError('Refresh token reuse detected; all sessions have been revoked');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  if (!stored.user.active) {
    throw new ForbiddenError('Account is inactive');
  }

  const nextRefreshToken = signRefreshToken(stored.user);
  const nextHash = sha256(nextRefreshToken);
  const meta = requestMeta(req);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        replacedByTokenHash: nextHash,
      },
    });

    if (claimed.count !== 1) {
      throw new UnauthorizedError('Refresh token has already been used');
    }

    await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: nextHash,
        expiresAt: new Date(Date.now() + refreshTokenExpiresInSeconds() * 1000),
        createdByIp: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  });

  return {
    user: serializeUser(stored.user),
    accessToken: signAccessToken(stored.user),
    refreshToken: nextRefreshToken,
    tokenType: 'Bearer',
    expiresIn: accessTokenExpiresInSeconds(),
    refreshExpiresIn: refreshTokenExpiresInSeconds(),
  };
}

export async function logout(refreshToken: string, req: Request): Promise<void> {
  const tokenHash = sha256(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAudit({
    action: 'AUTH_LOGOUT',
    entityType: 'USER',
    entityId: null,
    metadata: { tokenHashPrefix: tokenHash.slice(0, 12) },
    req,
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  req: Request,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new UnauthorizedError('Account no longer exists');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await writeAudit({
    action: 'AUTH_PASSWORD_CHANGED',
    entityType: 'USER',
    entityId: userId,
    actorId: userId,
    actorRole: user.role,
    req,
  });
}

export const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  active: true,
  smsOptIn: true,
  inAppOptIn: true,
  isFallbackContact: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
