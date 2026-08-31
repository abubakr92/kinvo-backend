import express, { Router } from 'express';

import { authenticate } from '@middleware/authenticate';
import { validate } from '@middleware/validate';
import { asyncHandler } from '@utils/async-handler';
import * as controller from './subscriptions.controller';
import { checkoutSchema, portalSchema } from './subscriptions.schema';

/**
 * Subscription routes (spec §7, §5.10, Batch 13).
 *
 * Nothing here grants access. Checkout returns a URL, the portal returns a URL,
 * and restore re-reads from the provider. Access changes only through the
 * webhook below, and only after its signature verifies.
 */
export const subscriptionsRouter: Router = Router();

/** Public: the paywall is shown before anyone signs in on some screens. */
subscriptionsRouter.get('/products', asyncHandler(controller.listProducts));

subscriptionsRouter.use(authenticate);

subscriptionsRouter.get('/me', asyncHandler(controller.getMySubscription));

subscriptionsRouter.post(
  '/checkout',
  validate({ body: checkoutSchema }),
  asyncHandler(controller.createCheckout),
);

subscriptionsRouter.post(
  '/portal',
  validate({ body: portalSchema }),
  asyncHandler(controller.createPortal),
);

subscriptionsRouter.post('/restore', asyncHandler(controller.restorePurchases));

/**
 * The webhook. Mounted separately in routes.ts, NOT on this router.
 *
 * It needs the RAW body for signature verification, and it must not sit behind
 * `authenticate` — Stripe has no bearer token, its signature IS the
 * authentication.
 */
export const subscriptionsWebhookRouter: Router = Router();

subscriptionsWebhookRouter.post(
  '/stripe',
  // express.raw, not express.json. Any parsing changes the bytes the signature
  // was computed over, and verification then fails for a reason that looks
  // nothing like the cause.
  express.raw({ type: 'application/json', limit: '1mb' }),
  asyncHandler(controller.handleStripeWebhook),
);
