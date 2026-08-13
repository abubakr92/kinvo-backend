import type { Request, Response } from 'express';

import { API_VERSION } from '@config/constants';
import { env } from '@config/env';
import { sendSuccess } from '@utils/response';

const startedAt = Date.now();

/**
 * Spec 4.12: liveness, no auth.
 *
 * Deliberately checks no dependency. A liveness probe that fails when Postgres
 * blips causes the orchestrator to kill healthy processes. Dependency
 * readiness gets its own endpoint once Prisma and Redis land in Batch 1.
 */
export function getHealth(_req: Request, res: Response): void {
  sendSuccess(res, {
    status: 'ok',
    api_version: API_VERSION,
    environment: env.NODE_ENV,
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    // Spec 4.6: UTC ISO-8601 with Z, field name ends in _at.
    checked_at: new Date().toISOString(),
  });
}
