/**
 * Runs before the test framework and before any src module loads.
 *
 * src/config/env.ts throws on a missing required variable, so the test
 * environment must be complete here.
 */
process.env.NODE_ENV = 'test';

// Silences pino and, importantly, keeps pino-pretty's worker thread out of the
// run — an open worker prevents Jest from exiting.
process.env.LOG_LEVEL = 'silent';

/**
 * The test database is set UNCONDITIONALLY, not with `??=`.
 *
 * tests/helpers/db.ts truncates every table between tests. If .env leaked its
 * DATABASE_URL into a test run, that truncate would wipe the developer's
 * development data. Overriding here makes that impossible; TEST_DATABASE_URL is
 * the only way to point the suite elsewhere.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://kinvo:kinvo@localhost:5433/kinvo_test';

process.env.PORT ??= '3001';
process.env.HOST ??= '127.0.0.1';
process.env.CORS_ORIGINS ??= '*';
process.env.JSON_BODY_LIMIT ??= '1mb';
process.env.REDIS_URL ??= 'redis://localhost:6380';
