import type { Request, Response } from 'express';

import { env } from '@config/env';
import { requireUser } from '@middleware/authenticate';
import { ApiError } from '@utils/api-error';
import { ERROR_CODES } from '@utils/error-codes';
import { logger } from '@utils/logger';
import { sendSuccess } from '@utils/response';
import { getPaymentProvider } from './providers';
import * as subscriptionsService from './subscriptions.service';
import type { CheckoutBody, PortalBody } from './subscriptions.schema';

/** HTTP translation only. No business logic, no database access (spec §0.5). */

export async function listProducts(_req: Request, res: Response): Promise<void> {
  const products = await subscriptionsService.listProducts();

  sendSuccess(res, { products });
}

export async function getMySubscription(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const result = await subscriptionsService.getMySubscription(user.id);

  sendSuccess(res, { ...result });
}

export async function createCheckout(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as CheckoutBody;

  const result = await subscriptionsService.createCheckout(user.id, body.product_slug, {
    successUrl: body.success_url ?? env.STRIPE_SUCCESS_URL ?? 'https://kinvo.app/premium/success',
    cancelUrl: body.cancel_url ?? env.STRIPE_CANCEL_URL ?? 'https://kinvo.app/premium',
  });

  sendSuccess(res, { ...result }, 201);
}

export async function createPortal(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as PortalBody;

  const result = await subscriptionsService.createPortalSession(
    user.id,
    body.return_url ?? env.STRIPE_CANCEL_URL ?? 'https://kinvo.app/premium',
  );

  sendSuccess(res, { ...result });
}

export async function restorePurchases(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);

  const result = await subscriptionsService.restorePurchases(user.id);

  sendSuccess(res, { ...result });
}

/**
 * The Stripe webhook (spec §5.10).
 *
 * The ONLY path that changes entitlement, and it earns that by verifying a
 * signature over the raw body before anything is read from the payload.
 *
 * Response codes carry meaning to Stripe:
 *
 *   400 — the signature did not verify. Stripe stops retrying and surfaces the
 *         endpoint as misconfigured, which is exactly right: a forged or
 *         mangled request must never be acknowledged as accepted.
 *   200 — accepted, or an event we deliberately ignore. Anything else makes
 *         Stripe retry an event nothing will ever act on, and eventually
 *         disable the endpoint.
 *   500 — genuine failure on our side. Stripe retries, which is what we want.
 */
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.get('stripe-signature');

  if (!signature) {
    throw new ApiError(ERROR_CODES.BAD_REQUEST, 'Missing signature.');
  }

  if (!Buffer.isBuffer(req.body)) {
    // Means a JSON parser ran first and the raw bytes are gone, so the
    // signature can never verify. Loud, because it is a routing mistake that
    // would otherwise present as every webhook silently failing.
    logger.error('stripe webhook did not receive a raw body');
    throw new ApiError(ERROR_CODES.INTERNAL_ERROR, 'Webhook misconfigured.');
  }

  let event;

  try {
    event = getPaymentProvider().verifyWebhook(req.body, signature);
  } catch (error) {
    logger.warn({ err: error }, 'stripe webhook signature rejected');
    throw new ApiError(ERROR_CODES.BAD_REQUEST, 'Invalid signature.');
  }

  if (!event) {
    // Verified, but an event type we do not act on.
    sendSuccess(res, { received: true, applied: false });
    return;
  }

  const result = await subscriptionsService.applyProviderEvent(event);

  sendSuccess(res, { received: true, applied: result.applied });
}
