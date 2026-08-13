import { Router } from 'express';

import { getHealth } from '@modules/health/health.controller';
import { asyncHandler } from '@utils/async-handler';

export const healthRouter: Router = Router();

healthRouter.get('/', asyncHandler(getHealth));
