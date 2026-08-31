import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { API_PREFIX } from '@config/constants';
import { env } from '@config/env';
import { errorHandler } from '@middleware/error-handler';
import { notFound } from '@middleware/not-found';
import { generalRateLimit } from '@middleware/rate-limit';
import { requestId } from '@middleware/request-id';
import { requestLogger } from '@middleware/request-logger';
import { healthRouter } from '@modules/health/health.routes';
import { apiRouter } from '@/routes';

/**
 * Builds the Express app without binding a port, so Supertest can drive it
 * in-process and tests never race over a socket.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind a load balancer; needed for correct client IPs in rate limiting (Batch 2).
  app.set('trust proxy', 1);

  // First, so every later log line and error response carries the correlation id.
  app.use(requestId);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
      // Spec 4.3: bearer tokens in headers, not cookies — no credentials needed.
      credentials: false,
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    }),
  );
  app.use(compression());

  /**
   * Everything EXCEPT webhooks gets a parsed JSON body.
   *
   * A provider signs the raw bytes it sent. Parsing and re-serialising changes
   * them — key order, whitespace, number formatting — so a webhook that has
   * been through express.json() can never verify, and the failure looks like a
   * bad secret rather than a middleware ordering problem.
   *
   * The webhook router applies express.raw() itself. This skip is what leaves
   * it something to apply it to.
   */
  const WEBHOOK_PREFIX = `${API_PREFIX}/webhooks`;

  app.use((req, res, next) => {
    if (req.path.startsWith(WEBHOOK_PREFIX)) {
      next();
      return;
    }

    express.json({ limit: env.JSON_BODY_LIMIT })(req, res, next);
  });

  app.use(express.urlencoded({ extended: true, limit: env.JSON_BODY_LIMIT }));

  app.use(requestLogger);

  // Unversioned alias for load balancers and container probes, which cannot be
  // told to follow an API version. Deliberately ahead of the rate limiter —
  // probes poll continuously and must never be throttled.
  app.use('/health', healthRouter);

  // A ceiling under every versioned route (spec §4.9). Routes that need
  // tighter bounds add their own limiter on top; this is here so that
  // forgetting to add one is not an unbounded endpoint.
  app.use(API_PREFIX, generalRateLimit, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app: Express = createApp();
