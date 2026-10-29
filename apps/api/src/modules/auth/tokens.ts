import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../../config/env';
import { UnauthorizedError } from '../../lib/errors';

export interface AccessPayload {
  sub: string;
  role: Role;
  type: 'access';
  jti: string;
  iat?: number;
  exp?: number;
}

export interface RefreshPayload {
  sub: string;
  role: Role;
  type: 'refresh';
  jti: string;
  iat?: number;
  exp?: number;
}

const issuer = env.JWT_ISSUER;
const audience = env.JWT_AUDIENCE;
const accessSeconds = env.JWT_ACCESS_TTL_MINUTES * 60;
const refreshSeconds = env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60;

export function signAccessToken(user: { id: string; role: Role }): string {
  return jwt.sign({ sub: user.id, role: user.role, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: accessSeconds,
    issuer,
    audience,
    jwtid: randomUUID(),
  });
}

export function signRefreshToken(user: { id: string; role: Role }): string {
  return jwt.sign({ sub: user.id, role: user.role, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: refreshSeconds,
    issuer,
    audience,
    jwtid: randomUUID(),
  });
}

function verify(token: string, secret: string, expectedType: 'access' | 'refresh'): AccessPayload | RefreshPayload {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { issuer, audience });
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload.role !== 'string' ||
    payload.type !== expectedType
  ) {
    throw new UnauthorizedError('Invalid token payload');
  }

  return payload as unknown as AccessPayload | RefreshPayload;
}

export function verifyAccessToken(token: string): AccessPayload {
  return verify(token, env.JWT_ACCESS_SECRET, 'access') as AccessPayload;
}

export function verifyRefreshToken(token: string): RefreshPayload {
  return verify(token, env.JWT_REFRESH_SECRET, 'refresh') as RefreshPayload;
}

export function accessTokenExpiresInSeconds(): number {
  return accessSeconds;
}

export function refreshTokenExpiresInSeconds(): number {
  return refreshSeconds;
}
