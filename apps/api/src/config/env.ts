import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const intFromEnv = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: intFromEnv(4000, 1, 65535),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().min(1),
    DIRECT_URL: z.string().min(1),

    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_MINUTES: intFromEnv(15, 1, 1440),
    JWT_REFRESH_TTL_DAYS: intFromEnv(7, 1, 90),
    BCRYPT_ROUNDS: intFromEnv(12, 8, 15),
    JWT_ISSUER: z.string().default('drainguard'),
    JWT_AUDIENCE: z.string().default('drainguard-api'),

    SMS_PROVIDER: z.enum(['mock', 'africastalking', 'twilio']).default('mock'),
    SMS_MAX_ATTEMPTS: intFromEnv(3, 1, 10),
    SMS_RETRY_BASE_MINUTES: intFromEnv(2, 1, 60),
    SMS_FALLBACK_PHONE: z.string().optional(),
    AFRICASTALKING_USERNAME: z.string().optional(),
    AFRICASTALKING_API_KEY: z.string().optional(),
    AFRICASTALKING_SENDER_ID: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    INGEST_MAX_PAST_DAYS: intFromEnv(7, 1, 90),
    INGEST_MAX_FUTURE_MINUTES: intFromEnv(10, 0, 120),
    MAX_READING_BODY_BYTES: intFromEnv(262144, 1024, 1048576),

    OFFLINE_JOB_CRON: z.string().default('* * * * *'),
    RULE_SWEEP_CRON: z.string().default('* * * * *'),
    NOTIFICATION_RETRY_CRON: z.string().default('* * * * *'),
    ESCALATION_CRON: z.string().default('* * * * *'),
    JOBS_ENABLED: booleanString,

    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return;

    if (value.SMS_PROVIDER === 'twilio') {
      for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const) {
        if (!value[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when SMS_PROVIDER=twilio` });
        }
      }
    }

    if (value.SMS_PROVIDER === 'africastalking') {
      for (const key of ['AFRICASTALKING_USERNAME', 'AFRICASTALKING_API_KEY'] as const) {
        if (!value[key]) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when SMS_PROVIDER=africastalking` });
        }
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
