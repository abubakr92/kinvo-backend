/**
 * Runs before the test framework and before any src module loads.
 *
 * src/config/env.ts throws on a missing required variable, so the test
 * environment must be complete here. Values default rather than overwrite, so a
 * developer can point the suite at a different database via a real env var.
 */
process.env.NODE_ENV = 'test';

// Silences pino and, importantly, keeps pino-pretty's worker thread out of the
// run — an open worker prevents Jest from exiting.
process.env.LOG_LEVEL = 'silent';

process.env.PORT ??= '3001';
process.env.HOST ??= '127.0.0.1';
process.env.CORS_ORIGINS ??= '*';
process.env.JSON_BODY_LIMIT ??= '1mb';

// Matches docker-compose.yml. Unused until Batch 1, but env validation requires it.
process.env.DATABASE_URL ??= 'postgresql://kinvo:kinvo@localhost:5433/kinvo_test';
process.env.REDIS_URL ??= 'redis://localhost:6380';
