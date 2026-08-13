import type { Server } from 'node:http';

import { app } from '@/app';
import { API_PREFIX } from '@config/constants';
import { env } from '@config/env';
import { logger } from '@utils/logger';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server: Server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { port: env.PORT, host: env.HOST, environment: env.NODE_ENV, api_prefix: API_PREFIX },
    'kinvo api listening',
  );
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info({ signal }, 'shutting down');

  // Force-exit if in-flight requests never drain, so orchestrators do not hang
  // on a stuck connection.
  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'error while closing server');
      process.exit(1);
    }
    logger.info('shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Spec 0.5: no unhandled promise rejections. Crash loudly rather than run on in
// an unknown state — the orchestrator restarts a clean process.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});

export { server };
