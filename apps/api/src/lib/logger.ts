import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'drainguard-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-device-key"]',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.apiKey',
      '*.password',
      '*.passwordHash',
      '*.apiKey',
      '*.apiKeyHash',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
});
