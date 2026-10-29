import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { corsOrigins, env } from './config/env';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './lib/errors';
import { requestId } from './middleware/requestId';
import { apiLimiter } from './middleware/rateLimit';
import { requireAuth } from './middleware/auth';
import { sseHub } from './realtime/sse';
import authRoutes from './modules/auth/routes';
import userRoutes from './modules/users/routes';
import drainRoutes from './modules/drains/routes';
import deviceRoutes from './modules/devices/routes';
import readingRoutes from './modules/readings/routes';
import readingIngestRoutes from './modules/readings/ingest';
import rainfallRoutes from './modules/rainfall/routes';
import rainfallIngestRoutes from './modules/rainfall/ingest';
import alertRoutes from './modules/alerts/routes';
import taskRoutes from './modules/tasks/routes';
import reportRoutes from './modules/reports/routes';
import notificationRoutes from './modules/notifications/routes';
import systemRoutes, { healthPayload } from './modules/system-health/routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      customProps: (req) => ({ requestId: (req as express.Request).id }),
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/api/health',
      },
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: corsOrigins.includes('*') ? true : corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: env.MAX_READING_BODY_BYTES }));

  app.get('/', (_req, res) => {
    res.json({
      data: {
        name: 'DrainGuard API',
        version: '1.0.0',
        documentation: '/api',
        health: '/health',
      },
    });
  });

  app.get('/health', async (_req, res) => {
    const payload = await healthPayload();
    res.status(payload.status === 'ok' ? 200 : 503).json({ data: payload });
  });

  app.get('/api', (_req, res) => {
    res.json({
      data: {
        name: 'DrainGuard API',
        version: '1.0.0',
        endpoints: {
          auth: '/api/auth',
          users: '/api/users',
          drains: '/api/drains',
          devices: '/api/devices',
          readings: '/api/readings',
          rainfall: '/api/rainfall',
          alerts: '/api/alerts',
          tasks: '/api/tasks',
          reports: '/api/reports',
          notifications: '/api/notifications',
          system: '/api/system/health',
          events: '/api/events',
          deviceIngestion: '/api/ingest/readings',
          rainfallIngestion: '/api/ingest/rainfall',
        },
      },
    });
  });

  app.use('/api', apiLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/drains', drainRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/readings', readingRoutes);
  app.use('/api/rainfall', rainfallRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api', systemRoutes);
  app.use('/api/ingest/readings', readingIngestRoutes);
  app.use('/api/ingest/rainfall', rainfallIngestRoutes);

  app.get('/api/events', requireAuth, sseHub.handler);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
