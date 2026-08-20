import { Router } from 'express';

import { authRouter } from '@modules/auth/auth.routes';
import { configRouter } from '@modules/config/config.routes';
import { healthRouter } from '@modules/health/health.routes';
import { mediaRouter, verificationRouter } from '@modules/media/media.routes';
import { onboardingRouter, usersRouter } from '@modules/users/users.routes';

/**
 * Every versioned route mounts here. Module routers are added batch by batch.
 */
export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/config', configRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/onboarding', onboardingRouter);
apiRouter.use('/media', mediaRouter);
apiRouter.use('/verification', verificationRouter);
