import { Router } from 'express';

import { env } from '@config/env';
import { docsRouter } from '@/docs/docs.routes';
import { authRouter } from '@modules/auth/auth.routes';
import { configRouter } from '@modules/config/config.routes';
import { healthRouter } from '@modules/health/health.routes';
import { mediaRouter, verificationRouter } from '@modules/media/media.routes';
import { onboardingRouter, usersRouter } from '@modules/users/users.routes';

/**
 * Every versioned route mounts here. Module routers are added batch by batch.
 */
export const apiRouter: Router = Router();

// Documentation first, and deliberately outside the versioned resource
// routes: /docs describes v1 but is not part of the v1 contract.
if (env.DOCS_ENABLED) {
  apiRouter.use('/docs', docsRouter);
}

apiRouter.use('/health', healthRouter);
apiRouter.use('/config', configRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/onboarding', onboardingRouter);
apiRouter.use('/media', mediaRouter);
apiRouter.use('/verification', verificationRouter);
