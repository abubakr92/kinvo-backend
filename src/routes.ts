import { Router } from 'express';

import { authRouter } from '@modules/auth/auth.routes';
import { healthRouter } from '@modules/health/health.routes';

/**
 * Every versioned route mounts here. Module routers are added batch by batch.
 */
export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
