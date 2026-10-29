process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PORT = '4001';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://drainguard:drainguard@localhost:5432/drainguard_test?schema=public';
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-different-and-32-characters';
process.env.JWT_ACCESS_TTL_MINUTES = '15';
process.env.JWT_REFRESH_TTL_DAYS = '7';
process.env.BCRYPT_ROUNDS = '8';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.SMS_PROVIDER = 'mock';
process.env.JOBS_ENABLED = 'false';
process.env.INGEST_MAX_PAST_DAYS = '7';
process.env.INGEST_MAX_FUTURE_MINUTES = '10';
