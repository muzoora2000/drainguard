import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const disabled = () => env.NODE_ENV === 'test';

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: disabled,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' } },
});

export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: disabled,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many authentication attempts' } },
});

export const ingestionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: disabled,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Device ingestion rate limit exceeded' } },
});
