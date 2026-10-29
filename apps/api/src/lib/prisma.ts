import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [
            { level: 'warn', emit: 'event' },
            { level: 'error', emit: 'event' },
          ]
        : [{ level: 'error', emit: 'event' }],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

const onPrismaEvent = prisma.$on as unknown as (
  event: 'warn' | 'error',
  callback: (payload: unknown) => void,
) => void;

onPrismaEvent('warn', (event) => logger.warn({ prisma: event }, 'Prisma warning'));
onPrismaEvent('error', (event) => logger.error({ prisma: event }, 'Prisma error'));
