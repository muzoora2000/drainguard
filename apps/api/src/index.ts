import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { sseHub } from './realtime/sse';
import { startScheduler, stopScheduler } from './jobs/scheduler';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'DrainGuard API listening');
});

if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'mock') {
  logger.warn('SMS_PROVIDER=mock in production: alerts will not send real SMS');
}
if (
  env.NODE_ENV === 'production' &&
  env.SMS_PROVIDER === 'africastalking' &&
  !env.AFRICASTALKING_SENDER_ID
) {
  logger.warn('AFRICASTALKING_SENDER_ID is not set: Uganda alerts require an approved sender ID');
}
if (env.NODE_ENV === 'production' && env.AFRICASTALKING_SANDBOX) {
  logger.warn('AFRICASTALKING_SANDBOX is enabled in production: messages use the sandbox endpoint');
}

startScheduler();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  stopScheduler();
  sseHub.closeAll();

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    await prisma.$disconnect();
    clearTimeout(forceExit);
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException');
});
