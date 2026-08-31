import {
  type BillingCycle,
  PaymentSource,
  SubscriptionStatus,
  SubscriptionTier,
  type Prisma,
  prisma,
} from '@/db/prisma';
import type { ProviderEvent } from '@/providers/payment.provider';
import { emitEntitlementsUpdated } from '@/realtime/emit';
import { notify } from '@modules/notifications/notifications.service';
import { ApiError } from '@utils/api-error';
import { ERROR_CODES } from '@utils/error-codes';
import { logger } from '@utils/logger';
import { getPaymentProvider } from './providers';

/**
 * Subscriptions (spec §5.10, Batch 13).
 *
 * THE RULE, quoted from the spec because everything here follows from it:
 *
 *   "Never grant entitlement from a client claim alone. The app sends a
 *    transaction; the server verifies it with the store before anything
 *    changes. A client-trusting implementation is trivially exploitable and
 *    will be exploited."
 *
 * So there is no endpoint that takes a tier, a price, or a receipt and grants
 * access. Access changes in exactly one place — `applyProviderEvent`, which is
 * only ever reached from a signature-verified webhook or a direct read from the
 * provider's API.
 *
 * ENTITLEMENT BELONGS TO THE USER, not a device or a store account. The tier is
 * resolved from Subscription rows keyed on user_id, so signing in anywhere
 * carries it.
 */

/**
 * Statuses that still grant access.
 *
 * `cancelled` is here on purpose: cancelling means "do not renew", and the user
 * has already paid for the rest of the period. `current_period_end` is what
 * actually ends access, checked separately below.
 *
 * `in_grace_period` and `on_billing_retry` are here because the provider is
 * still trying to collect. Cutting someone off over a card that needed
 * reissuing loses the customer AND the payment.
 */
const ENTITLING_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.active,
  SubscriptionStatus.in_grace_period,
  SubscriptionStatus.on_billing_retry,
  SubscriptionStatus.cancelled,
];

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  basic: 1,
  advanced: 2,
};

/**
 * The tier a user is actually entitled to, from subscription rows.
 *
 * This replaces the Batch 6 stub that read `user.subscription_tier` as a hand-
 * set column. That column is still maintained as a denormalised copy for admin
 * lists and analytics, but it is no longer the source of truth — a column
 * somebody can edit is not an entitlement.
 *
 * Takes the HIGHEST entitling tier: someone who upgrades mid-period may briefly
 * hold two rows, and the answer must be the better one rather than whichever
 * the database returned first.
 */
export async function resolveTier(userId: string, now = new Date()): Promise<SubscriptionTier> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      user_id: userId,
      status: { in: ENTITLING_STATUSES },
      // Access ends when the paid period ends, whatever the status says.
      current_period_end: { gt: now },
      revoked_at: null,
      refunded_at: null,
    },
    select: { product: { select: { tier: true } } },
  });

  return subscriptions.reduce<SubscriptionTier>(
    (best, row) => (TIER_RANK[row.product.tier] > TIER_RANK[best] ? row.product.tier : best),
    SubscriptionTier.free,
  );
}

/**
 * Recomputes the tier and writes the denormalised copy.
 *
 * Called after every state change. Emits over the socket so a client sitting on
 * the paywall updates the moment the payment clears, rather than on next
 * launch.
 */
async function syncTier(userId: string): Promise<SubscriptionTier> {
  const tier = await resolveTier(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscription_tier: true },
  });

  if (user && user.subscription_tier !== tier) {
    await prisma.user.update({ where: { id: userId }, data: { subscription_tier: tier } });

    emitEntitlementsUpdated(userId, tier);

    logger.info({ user_id: userId, tier }, 'subscription tier changed');
  }

  return tier;
}

export interface SubscriptionView {
  id: string;
  tier: SubscriptionTier;
  billing_cycle: BillingCycle;
  product_slug: string;
  status: SubscriptionStatus;
  source: PaymentSource;
  current_period_start: string;
  current_period_end: string;
  auto_renew: boolean;
  /** True while access is live, whatever the status label says. */
  is_active: boolean;
  cancelled_at: string | null;
  created_at: string;
}

const SUBSCRIPTION_INCLUDE = {
  product: { select: { slug: true, tier: true, billing_cycle: true } },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionRow = Prisma.SubscriptionGetPayload<{ include: typeof SUBSCRIPTION_INCLUDE }>;

function toView(subscription: SubscriptionRow, now = new Date()): SubscriptionView {
  return {
    id: subscription.id,
    tier: subscription.product.tier,
    billing_cycle: subscription.product.billing_cycle,
    product_slug: subscription.product.slug,
    status: subscription.status,
    source: subscription.source,
    current_period_start: subscription.current_period_start.toISOString(),
    current_period_end: subscription.current_period_end.toISOString(),
    auto_renew: subscription.auto_renew,
    is_active:
      ENTITLING_STATUSES.includes(subscription.status) &&
      subscription.current_period_end > now &&
      subscription.revoked_at === null &&
      subscription.refunded_at === null,
    cancelled_at: subscription.cancelled_at?.toISOString() ?? null,
    created_at: subscription.created_at.toISOString(),
  };
}

export interface ProductView {
  slug: string;
  name: string;
  tier: SubscriptionTier;
  billing_cycle: BillingCycle;
  /** spec §4.6: integer minor units plus currency. Never floats. */
  price: { amount_minor: number; currency: string } | null;
  stripe_price_id: string | null;
}

/**
 * What is on sale.
 *
 * Prices come from the current PriceVersion rather than being hardcoded, so a
 * price change is a row with a new `effective_from` and the old one keeps its
 * history for grandfathering and reporting (spec §5.10).
 */
export async function listProducts(): Promise<ProductView[]> {
  const now = new Date();

  const products = await prisma.subscriptionProduct.findMany({
    where: { is_active: true },
    orderBy: [{ tier: 'asc' }, { sort_order: 'asc' }],
    include: {
      price_versions: {
        where: {
          effective_from: { lte: now },
          OR: [{ effective_to: null }, { effective_to: { gt: now } }],
        },
        orderBy: { effective_from: 'desc' },
        take: 1,
      },
    },
  });

  return products.map((product) => {
    const price = product.price_versions[0];

    return {
      slug: product.slug,
      name: product.name,
      tier: product.tier,
      billing_cycle: product.billing_cycle,
      price: price ? { amount_minor: price.amount_minor, currency: price.currency } : null,
      stripe_price_id: product.stripe_price_id,
    };
  });
}

/**
 * Starts a purchase.
 *
 * Grants NOTHING. The response is a URL; the user is not subscribed until the
 * provider says so through a verified webhook. That separation is the whole
 * defence against a forged client claim.
 */
export async function createCheckout(
  userId: string,
  productSlug: string,
  urls: { successUrl: string; cancelUrl: string },
): Promise<{ url: string; session_id: string }> {
  const provider = getPaymentProvider();

  if (!provider.isConfigured) {
    throw new ApiError(ERROR_CODES.SERVICE_UNAVAILABLE, 'Payments are not available yet.');
  }

  const product = await prisma.subscriptionProduct.findFirst({
    where: { slug: productSlug, is_active: true },
    select: { id: true, stripe_price_id: true, tier: true },
  });

  if (!product || !product.stripe_price_id) {
    throw ApiError.notFound('That plan is not available.');
  }

  // Reuse the provider's customer record so a returning subscriber keeps one
  // billing history rather than accumulating a customer per purchase.
  const existing = await prisma.subscription.findFirst({
    where: { user_id: userId, store_purchase_token: { not: null } },
    orderBy: { created_at: 'desc' },
    select: { store_purchase_token: true },
  });

  const session = await provider.createCheckout({
    userId,
    externalPriceId: product.stripe_price_id,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    externalCustomerId: existing?.store_purchase_token ?? null,
  });

  logger.info({ user_id: userId, product: productSlug }, 'checkout started');

  return session;
}

export async function createPortalSession(
  userId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const provider = getPaymentProvider();

  const subscription = await prisma.subscription.findFirst({
    where: { user_id: userId, store_purchase_token: { not: null } },
    orderBy: { created_at: 'desc' },
    select: { store_purchase_token: true },
  });

  if (!subscription?.store_purchase_token) {
    throw ApiError.notFound('There is no billing account to manage yet.');
  }

  return provider.createPortalSession({
    externalCustomerId: subscription.store_purchase_token,
    returnUrl,
  });
}

/**
 * Applies a verified provider event. THE ONLY PLACE ACCESS CHANGES.
 *
 * Idempotent by the provider's event id: both Stripe and the app stores retry,
 * and duplicates are routine rather than exceptional (spec §5.10). The
 * `WebhookEvent` row is written first and its unique constraint is what makes
 * a concurrent duplicate a no-op rather than a double-apply.
 */
export async function applyProviderEvent(event: ProviderEvent): Promise<{ applied: boolean }> {
  const alreadySeen = await prisma.processedWebhookEvent.findUnique({
    where: { source_event_id: { source: PaymentSource.stripe, event_id: event.event_id } },
    select: { id: true },
  });

  if (alreadySeen) {
    logger.debug({ event_id: event.event_id }, 'duplicate webhook ignored');
    return { applied: false };
  }

  const existing = await prisma.subscription.findFirst({
    where: {
      source: PaymentSource.stripe,
      original_transaction_id: event.external_subscription_id,
    },
    include: SUBSCRIPTION_INCLUDE,
  });

  // A checkout.session.completed carries the user but no period yet; the
  // subscription.created that follows carries the period. Skipping the first is
  // correct rather than an omission — acting on it would write a subscription
  // with invented dates.
  const userId = event.user_id ?? existing?.user_id ?? null;

  if (!userId) {
    logger.warn({ event_id: event.event_id }, 'webhook has no resolvable user');
    await recordProcessed(event);
    return { applied: false };
  }

  if (!event.current_period_end && !existing) {
    await recordProcessed(event);
    return { applied: false };
  }

  const product = event.external_price_id
    ? await prisma.subscriptionProduct.findFirst({
        where: { stripe_price_id: event.external_price_id },
        select: { id: true },
      })
    : null;

  const productId = product?.id ?? existing?.product_id;

  if (!productId) {
    // An event for a price nobody seeded. Recorded so it is not retried
    // forever, and logged loudly because it means the catalogue is out of step
    // with the provider.
    logger.error(
      { event_id: event.event_id, price: event.external_price_id },
      'webhook references an unknown price',
    );
    await recordProcessed(event);
    return { applied: false };
  }

  const revoked = event.status === SubscriptionStatus.refunded;

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          product_id: productId,
          status: event.status,
          auto_renew: event.auto_renew,
          ...(event.current_period_start
            ? { current_period_start: event.current_period_start }
            : {}),
          ...(event.current_period_end ? { current_period_end: event.current_period_end } : {}),
          ...(event.status === SubscriptionStatus.cancelled ? { cancelled_at: new Date() } : {}),
          ...(event.status === SubscriptionStatus.expired ? { expired_at: new Date() } : {}),
          // spec §5.10: a refunded user keeping premium is a revenue leak.
          // Ending the period NOW is what actually removes access, because
          // resolveTier checks the period rather than the label.
          ...(revoked
            ? {
                refunded_at: event.revoked_at ?? new Date(),
                revoked_at: event.revoked_at ?? new Date(),
                current_period_end: event.revoked_at ?? new Date(),
              }
            : {}),
        },
      });
    } else {
      await tx.subscription.create({
        data: {
          user_id: userId,
          product_id: productId,
          status: event.status,
          source: PaymentSource.stripe,
          original_transaction_id: event.external_subscription_id,
          store_transaction_id: event.external_subscription_id,
          current_period_start: event.current_period_start ?? new Date(),
          current_period_end: event.current_period_end ?? new Date(),
          auto_renew: event.auto_renew,
        },
      });
    }

    await tx.processedWebhookEvent.create({
      data: {
        source: PaymentSource.stripe,
        event_id: event.event_id,
        event_type: event.type,
      },
    });
  });

  const tier = await syncTier(userId);

  await announce(userId, event, tier);

  logger.info({ event_id: event.event_id, type: event.type, tier }, 'subscription event applied');

  return { applied: true };
}

async function recordProcessed(event: ProviderEvent): Promise<void> {
  await prisma.processedWebhookEvent.create({
    data: {
      source: PaymentSource.stripe,
      event_id: event.event_id,
      event_type: event.type,
    },
  });
}

async function announce(
  userId: string,
  event: ProviderEvent,
  tier: SubscriptionTier,
): Promise<void> {
  if (event.status === SubscriptionStatus.refunded) {
    await notify({
      userId,
      category: 'subscription',
      title: 'Subscription refunded',
      body: 'Your premium features have ended.',
      data: { tier },
    });
    return;
  }

  if (event.type === 'customer.subscription.created' && tier !== SubscriptionTier.free) {
    await notify({
      userId,
      category: 'subscription',
      title: 'Welcome to Kinvo Premium',
      body: 'Your new features are ready.',
      data: { tier },
    });
    return;
  }

  if (event.status === SubscriptionStatus.on_billing_retry) {
    await notify({
      userId,
      category: 'subscription',
      title: 'Payment problem',
      body: 'We could not take your payment. Update your card to keep your features.',
      data: { tier },
    });
  }
}

/** The user's own subscription state. */
export async function getMySubscription(userId: string): Promise<{
  tier: SubscriptionTier;
  subscription: SubscriptionView | null;
}> {
  const subscription = await prisma.subscription.findFirst({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    include: SUBSCRIPTION_INCLUDE,
  });

  return {
    tier: await resolveTier(userId),
    // spec §4.6: null, never an omitted key.
    subscription: subscription ? toView(subscription) : null,
  };
}

/**
 * Re-reads state from the provider (spec §5.10: restore purchases).
 *
 * Reads from the PROVIDER, never from anything the client sent — that is what
 * makes it a restore rather than a way to claim a subscription.
 *
 * Entitlement belongs to the user, so a subscription bought on one device
 * resolves on any other simply by being keyed on user_id.
 */
export async function restorePurchases(userId: string): Promise<{
  restored: number;
  tier: SubscriptionTier;
}> {
  const provider = getPaymentProvider();

  if (!provider.isConfigured || !('fetchSubscription' in provider)) {
    return { restored: 0, tier: await resolveTier(userId) };
  }

  const known = await prisma.subscription.findMany({
    where: { user_id: userId, source: PaymentSource.stripe },
    select: { original_transaction_id: true },
  });

  const stripe = provider as unknown as {
    fetchSubscription(id: string): Promise<ProviderEvent | null>;
  };

  let restored = 0;

  for (const row of known) {
    if (!row.original_transaction_id) {
      continue;
    }

    const event = await stripe.fetchSubscription(row.original_transaction_id);

    if (event) {
      // A fresh event id each time, so a restore is never mistaken for a
      // duplicate webhook and skipped.
      const result = await applyProviderEvent({ ...event, user_id: userId });
      if (result.applied) {
        restored += 1;
      }
    }
  }

  return { restored, tier: await syncTier(userId) };
}

/**
 * Expires subscriptions whose paid period has run out.
 *
 * Bookkeeping only: `resolveTier` already checks `current_period_end`, so a
 * lapsed subscription stops entitling the moment it lapses whether or not this
 * has run. It exists so admin lists and analytics can filter on the column.
 */
export async function sweepExpiredSubscriptions(now = new Date()): Promise<number> {
  const lapsed = await prisma.subscription.findMany({
    where: {
      status: { in: [SubscriptionStatus.active, SubscriptionStatus.cancelled] },
      current_period_end: { lte: now },
    },
    select: { id: true, user_id: true },
  });

  if (lapsed.length === 0) {
    return 0;
  }

  await prisma.subscription.updateMany({
    where: { id: { in: lapsed.map((row) => row.id) } },
    data: { status: SubscriptionStatus.expired, expired_at: now },
  });

  for (const userId of new Set(lapsed.map((row) => row.user_id))) {
    await syncTier(userId);
  }

  return lapsed.length;
}

export { ENTITLING_STATUSES };
