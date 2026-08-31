import Stripe from 'stripe';

import { PaymentSource, SubscriptionStatus } from '@/db/prisma';
import { logger } from '@utils/logger';
import type { CheckoutSession, PaymentProvider, ProviderEvent } from './payment.provider';

/**
 * Stripe (spec §5.10, Batch 13).
 *
 * Money never touches this service. Checkout and the customer portal are hosted
 * by Stripe, so no card number, CVC, or billing address reaches our
 * infrastructure — which keeps PCI scope at the lowest tier and means a
 * compromise here cannot leak payment instruments.
 */

/**
 * Stripe's subscription states mapped onto ours.
 *
 * `past_due` becomes `on_billing_retry` and `unpaid` becomes
 * `in_grace_period` deliberately: both mean Stripe is still trying, and the
 * spec says a user keeps entitlement while billing retries. Treating either as
 * expired would cut off a paying customer over a card that just needed
 * reissuing.
 */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: SubscriptionStatus.active,
  trialing: SubscriptionStatus.active,
  past_due: SubscriptionStatus.on_billing_retry,
  unpaid: SubscriptionStatus.in_grace_period,
  canceled: SubscriptionStatus.cancelled,
  incomplete: SubscriptionStatus.expired,
  incomplete_expired: SubscriptionStatus.expired,
  paused: SubscriptionStatus.expired,
};

/** Events that change access. Anything else is acknowledged and ignored. */
const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
]);

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly source = PaymentSource.stripe;
  readonly isConfigured: boolean;

  private readonly client: Stripe | null;
  private readonly webhookSecret: string | undefined;

  constructor(options: { secretKey?: string; webhookSecret?: string }) {
    this.isConfigured = Boolean(options.secretKey);
    this.webhookSecret = options.webhookSecret;
    this.client = options.secretKey
      ? new Stripe(options.secretKey, {
          // Pinned. An unpinned version means Stripe can change response
          // shapes under a running deployment, and the first sign is a
          // subscription that silently stops renewing.
          apiVersion: '2026-08-26.dahlia',
          typescript: true,
        })
      : null;
  }

  private require(): Stripe {
    if (!this.client) {
      throw new Error('Stripe is not configured');
    }
    return this.client;
  }

  async createCheckout(options: {
    userId: string;
    externalPriceId: string;
    successUrl: string;
    cancelUrl: string;
    externalCustomerId?: string | null;
  }): Promise<CheckoutSession> {
    const session = await this.require().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: options.externalPriceId, quantity: 1 }],
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
      ...(options.externalCustomerId ? { customer: options.externalCustomerId } : {}),
      // The ONLY link between a Stripe subscription and a Kinvo account. It is
      // set here, server-side, and read back off the webhook — never sent by
      // the client, which is what stops someone claiming another user's
      // purchase.
      client_reference_id: options.userId,
      subscription_data: {
        metadata: { kinvo_user_id: options.userId },
      },
      metadata: { kinvo_user_id: options.userId },
    });

    if (!session.url) {
      throw new Error('Stripe returned a checkout session with no URL');
    }

    return { url: session.url, session_id: session.id };
  }

  async createPortalSession(options: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.require().billingPortal.sessions.create({
      customer: options.externalCustomerId,
      return_url: options.returnUrl,
    });

    return { url: session.url };
  }

  /**
   * Verifies the signature, then translates.
   *
   * Returns null for events we do not act on, so the caller can answer 200 and
   * stop Stripe retrying. Throwing on an unhandled event would make Stripe
   * retry it forever and eventually disable the endpoint.
   */
  verifyWebhook(rawBody: Buffer, signature: string): ProviderEvent | null {
    if (!this.webhookSecret) {
      throw new Error('Stripe webhook secret is not configured');
    }

    // Throws on a bad signature, a replayed timestamp, or a mangled body. The
    // caller turns that into a 400, which is what tells Stripe the endpoint is
    // misconfigured rather than that the event was accepted.
    const event = this.require().webhooks.constructEvent(rawBody, signature, this.webhookSecret);

    if (!HANDLED_EVENTS.has(event.type)) {
      logger.debug({ type: event.type }, 'stripe event ignored');
      return null;
    }

    return this.translate(event);
  }

  private translate(event: Stripe.Event): ProviderEvent | null {
    if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
      const charge = event.data.object as Stripe.Charge | Stripe.Dispute;
      const subscriptionId = this.subscriptionIdFromCharge(charge);

      if (!subscriptionId) {
        return null;
      }

      // spec §5.10: a refunded user keeping premium is a straightforward
      // revenue leak. A dispute is treated the same way — the money is gone
      // either way, and waiting for the outcome means weeks of free access.
      return {
        event_id: event.id,
        type: event.type,
        external_subscription_id: subscriptionId,
        external_price_id: null,
        user_id: null,
        status: SubscriptionStatus.refunded,
        current_period_start: null,
        current_period_end: null,
        auto_renew: false,
        revoked_at: new Date(event.created * 1000),
        raw: event.data.object,
      };
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

      if (!subscriptionId) {
        return null;
      }

      return {
        event_id: event.id,
        type: event.type,
        external_subscription_id: subscriptionId,
        external_price_id: null,
        // Set by us when the session was created, so it cannot be forged.
        user_id: session.client_reference_id ?? null,
        status: SubscriptionStatus.active,
        current_period_start: null,
        current_period_end: null,
        auto_renew: true,
        revoked_at: null,
        raw: session,
      };
    }

    const subscription = event.data.object as Stripe.Subscription;
    const item = subscription.items?.data?.[0];

    // `cancel_at_period_end` is NOT a cancellation. The user keeps access until
    // the period ends (spec §5.10), so the status stays active and only
    // auto_renew changes. Treating it as cancelled would cut off someone who
    // has already paid for the rest of the month.
    const status =
      event.type === 'customer.subscription.deleted'
        ? SubscriptionStatus.expired
        : (STATUS_MAP[subscription.status] ?? SubscriptionStatus.expired);

    return {
      event_id: event.id,
      type: event.type,
      external_subscription_id: subscription.id,
      external_price_id: item?.price?.id ?? null,
      user_id: (subscription.metadata?.kinvo_user_id as string | undefined) ?? null,
      status,
      current_period_start: item?.current_period_start
        ? new Date(item.current_period_start * 1000)
        : null,
      current_period_end: item?.current_period_end
        ? new Date(item.current_period_end * 1000)
        : null,
      auto_renew: !subscription.cancel_at_period_end,
      revoked_at: null,
      raw: subscription,
    };
  }

  private subscriptionIdFromCharge(charge: Stripe.Charge | Stripe.Dispute): string | null {
    const invoice = 'invoice' in charge ? charge.invoice : null;

    if (typeof invoice === 'string') {
      // Only the id is on the charge; the caller resolves it against a stored
      // subscription rather than making another API call on the webhook path.
      return invoice;
    }

    if (invoice && typeof invoice === 'object' && 'subscription' in invoice) {
      const subscription = (invoice as { subscription?: string | { id: string } }).subscription;
      return typeof subscription === 'string' ? subscription : (subscription?.id ?? null);
    }

    return null;
  }

  /** Looks up a subscription directly — used by restore, never by the webhook. */
  async fetchSubscription(externalSubscriptionId: string): Promise<ProviderEvent | null> {
    const subscription = await this.require().subscriptions.retrieve(externalSubscriptionId);
    const item = subscription.items?.data?.[0];

    return {
      event_id: `manual_${subscription.id}_${Date.now()}`,
      type: 'manual.sync',
      external_subscription_id: subscription.id,
      external_price_id: item?.price?.id ?? null,
      user_id: (subscription.metadata?.kinvo_user_id as string | undefined) ?? null,
      status: STATUS_MAP[subscription.status] ?? SubscriptionStatus.expired,
      current_period_start: item?.current_period_start
        ? new Date(item.current_period_start * 1000)
        : null,
      current_period_end: item?.current_period_end
        ? new Date(item.current_period_end * 1000)
        : null,
      auto_renew: !subscription.cancel_at_period_end,
      revoked_at: null,
      raw: subscription,
    };
  }

  /** Finds a customer's subscriptions, for restore-purchases. */
  async listCustomerSubscriptions(externalCustomerId: string): Promise<string[]> {
    const result = await this.require().subscriptions.list({
      customer: externalCustomerId,
      status: 'all',
      limit: 10,
    });

    return result.data.map((subscription) => subscription.id);
  }
}

/** Used until a Stripe key exists, and in every test that does not need one. */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = 'unconfigured';
  readonly source = PaymentSource.stripe;
  readonly isConfigured = false;

  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(new Error('No payment provider is configured'));
  }

  createPortalSession(): Promise<{ url: string }> {
    return Promise.reject(new Error('No payment provider is configured'));
  }

  verifyWebhook(): ProviderEvent | null {
    throw new Error('No payment provider is configured');
  }
}
