import type { Role } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from './prisma';
import { logger } from './logger';

export interface AuditInput {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  req?: Request;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
        ip: input.req?.ip ?? null,
        userAgent: input.req?.get('user-agent')?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action, entityType: input.entityType }, 'Failed to write audit log');
  }
}
