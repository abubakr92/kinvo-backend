import { API_PREFIX } from '@config/constants';
import { PaymentSource, SubscriptionStatus, SubscriptionTier, prisma } from '@/db/prisma';
import type { CheckoutSession, PaymentProvider, ProviderEvent } from '@/providers/payment.provider';
import { setPaymentProvider } from '@modules/subscriptions/providers';
import {
  applyProviderEvent,
  resolveTier,
  sweepExpiredSubscriptions,
} from '@modules/subscriptions/subscriptions.service';
import { closeDatabase, resetDatabase } from '../../helpers/db';
import { authHeader, createAuthenticatedUser } from '../../helpers/auth';
import { api, expectErrorEnvelope, expectSuccessEnvelope } from '../../helpers/request';
import { connectRedis, disconnectRedis, seedEntitlements } from '../../helpers/entitlements';
import { seedProducts } from '../../../prisma/seeds/products';

/**
 * Subscriptions (spec §5.10, Batch 13).
 *
 * THE RULE, quoted because every test below exists to enforce it:
 *
 *   "Never grant entitlement from a client claim alone. A client-trusting
 *    implementation is trivially exploitable and will be exploited."
 *
 * Apple and Google are out of scope — the mobile team owns both stores — so
 * this is Stripe plus the provider-agnostic lifecycle.
 */

const SUBS = `${API_PREFIX}/subscriptions`;

/** A provider that verifies nothing, so the LIFECYCLE can be tested directly. */
class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';
  readonly source = PaymentSource.stripe;
  readonly isConfigured = true;
  lastCheckout: { userId: string; externalPriceId: string } | null = null;

  createCheckout(options: { userId: string; externalPriceId: string }): Promise<CheckoutSession> {
    this.lastCheckout = { userId: options.userId, externalPriceId: options.externalPriceId };
    return Promise.resolve({ url: 'https://checkout.test/session', session_id: 'cs_test_1' });
  }

  createPortalSession(): Promise<{ url: string }> {
    return Promise.resolve({ url: 'https://portal.test/session' });
  }

  /**
   * Behaves like a real provider: THROWS on anything it cannot verify.
   *
   * Returning null instead would be the dangerous shape — the controller reads
   * null as "verified, but an event we ignore" and answers 200, which tells the
   * provider a forged request was accepted.
   */
  verifyWebhook(_rawBody: Buffer, signature: string): ProviderEvent | null {
    if (signature !== VALID_TEST_SIGNATURE) {
      throw new Error('signature verification failed');
    }

    return event({ event_id: 'evt_from_webhook' });
  }
}

/** The only signature the stub accepts. Anything else is a forgery. */
const VALID_TEST_SIGNATURE = 't=1,v1=valid-test-signature';

let stub: StubPaymentProvider;

/** Builds a verified-looking event. Never reachable from a client. */
function event(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  const now = new Date();

  return {
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'customer.subscription.created',
    external_subscription_id: 'sub_test_1',
    external_price_id: 'price_advanced_monthly',
    user_id: null,
    status: SubscriptionStatus.active,
    current_period_start: now,
    current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    auto_renew: true,
    revoked_at: null,
    raw: {},
    ...overrides,
  };
}

/** Points a seeded product at a Stripe price id, as the real setup would. */
async function linkPrice(slug: string, priceId: string) {
  await prisma.subscriptionProduct.update({
    where: { slug },
    data: { stripe_price_id: priceId },
  });
}

beforeAll(connectRedis);

beforeEach(async () => {
  await resetDatabase();
  await seedEntitlements();
  await seedProducts();
  await linkPrice('advanced_monthly', 'price_advanced_monthly');
  await linkPrice('basic_monthly', 'price_basic_monthly');
  stub = new StubPaymentProvider();
  setPaymentProvider(stub);
});

afterAll(async () => {
  setPaymentProvider(null);
  await closeDatabase();
  await disconnectRedis();
});

describe('GET /subscriptions/products', () => {
  it('lists the four products with prices in minor units', async () => {
    const response = await api.get(`${SUBS}/products`);

    expect(response.status).toBe(200);
    expectSuccessEnvelope(response.body);
    expect(response.body.data.products).toHaveLength(4);

    const monthly = response.body.data.products.find(
      (p: { slug: string }) => p.slug === 'advanced_monthly',
    );

    // spec §4.6: integer minor units plus currency, never floats.
    expect(monthly.price.amount_minor).toBe(1999);
    expect(monthly.price.currency).toBe('USD');
  });

  it('is readable without a token, because the paywall is shown early', async () => {
    const response = await api.get(`${SUBS}/products`);

    expect(response.status).toBe(200);
  });
});

describe('a client cannot grant itself anything (spec §5.10)', () => {
  it('starts checkout without changing the tier', async () => {
    const user = await createAuthenticatedUser();

    const response = await api
      .post(`${SUBS}/checkout`)
      .set(authHeader(user.tokens))
      .send({ product_slug: 'advanced_monthly' });

    expect(response.status).toBe(201);
    expect(response.body.data.url).toContain('checkout.test');

    // The whole defence: a checkout URL is not access.
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.free);
  });

  it('ignores a tier the client tries to send', async () => {
    const user = await createAuthenticatedUser();

    const response = await api
      .post(`${SUBS}/checkout`)
      .set(authHeader(user.tokens))
      .send({ product_slug: 'basic_monthly', tier: 'advanced', amount_minor: 0 });

    // .strict() rejects the extra fields outright, so there is no path where a
    // client-supplied tier or price is even read.
    expect(response.status).toBe(400);
    expectErrorEnvelope(response.body, 'VALIDATION_FAILED');
  });

  it('binds the checkout to the authenticated user, not to anything sent', async () => {
    const user = await createAuthenticatedUser();
    const victim = await createAuthenticatedUser();

    await api
      .post(`${SUBS}/checkout`)
      .set(authHeader(user.tokens))
      .send({ product_slug: 'advanced_monthly' });

    expect(stub.lastCheckout?.userId).toBe(user.user_id);
    expect(stub.lastCheckout?.userId).not.toBe(victim.user_id);
  });

  it('404s for a product that is not on sale', async () => {
    const user = await createAuthenticatedUser();

    const response = await api
      .post(`${SUBS}/checkout`)
      .set(authHeader(user.tokens))
      .send({ product_slug: 'advanced_quarterly' });

    expect(response.status).toBe(404);
  });

  it('requires a token to start checkout', async () => {
    const response = await api.post(`${SUBS}/checkout`).send({ product_slug: 'basic_monthly' });

    expect(response.status).toBe(401);
  });
});

describe('the webhook is the only thing that grants access', () => {
  it('grants entitlement on a verified subscription event', async () => {
    const user = await createAuthenticatedUser();

    await applyProviderEvent(event({ user_id: user.user_id }));

    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.advanced);
  });

  it('flows straight into the entitlement flags', async () => {
    const user = await createAuthenticatedUser();

    const before = await api.get(`${API_PREFIX}/me/entitlements`).set(authHeader(user.tokens));
    expect(before.body.data.flags.see_who_liked_you).toBe(false);

    await applyProviderEvent(event({ user_id: user.user_id }));

    const after = await api.get(`${API_PREFIX}/me/entitlements`).set(authHeader(user.tokens));
    // spec §5.10: the client reads flags, never infers access from a tier name.
    expect(after.body.data.tier).toBe('advanced');
    expect(after.body.data.flags.see_who_liked_you).toBe(true);
    expect(after.body.data.flags.daily_swipe_limit).toBe(-1);
  });

  it('treats a duplicate delivery as a no-op', async () => {
    const user = await createAuthenticatedUser();
    const duplicate = event({ user_id: user.user_id });

    const first = await applyProviderEvent(duplicate);
    const second = await applyProviderEvent(duplicate);

    // Both Stripe and the app stores retry; duplicates are routine.
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(await prisma.subscription.count()).toBe(1);
  });

  it('ignores an event for a price nobody seeded', async () => {
    const user = await createAuthenticatedUser();

    const result = await applyProviderEvent(
      event({ user_id: user.user_id, external_price_id: 'price_does_not_exist' }),
    );

    expect(result.applied).toBe(false);
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.free);
  });

  it('ignores an event with no resolvable user', async () => {
    const result = await applyProviderEvent(event({ user_id: null }));

    expect(result.applied).toBe(false);
    expect(await prisma.subscription.count()).toBe(0);
  });
});

describe('POST /webhooks/stripe', () => {
  it('rejects a request with no signature', async () => {
    const response = await api
      .post(`${API_PREFIX}/webhooks/stripe`)
      .set('content-type', 'application/json')
      .send(
        Buffer.from(JSON.stringify({ id: 'evt_forged', type: 'customer.subscription.created' })),
      );

    expect(response.status).toBe(400);
  });

  it('rejects a forged payload carrying a bogus signature', async () => {
    const response = await api
      .post(`${API_PREFIX}/webhooks/stripe`)
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send(
        Buffer.from(JSON.stringify({ id: 'evt_forged', type: 'customer.subscription.created' })),
      );

    // The stub throws on verify, which the controller turns into a 400. A
    // forged event must never be acknowledged as accepted.
    expect(response.status).toBe(400);
    expect(await prisma.subscription.count()).toBe(0);
  });
});

describe('the lifecycle (spec §5.10)', () => {
  it('keeps access after cancellation until the period ends', async () => {
    const user = await createAuthenticatedUser();
    await applyProviderEvent(event({ user_id: user.user_id }));

    await applyProviderEvent(
      event({
        user_id: user.user_id,
        type: 'customer.subscription.updated',
        status: SubscriptionStatus.cancelled,
        auto_renew: false,
      }),
    );

    // Cancelling means "do not renew". They have already paid for the rest of
    // the month, and cutting them off would be taking money for nothing.
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.advanced);
  });

  it('keeps access while billing retries', async () => {
    const user = await createAuthenticatedUser();
    await applyProviderEvent(event({ user_id: user.user_id }));

    await applyProviderEvent(
      event({
        user_id: user.user_id,
        type: 'customer.subscription.updated',
        status: SubscriptionStatus.on_billing_retry,
      }),
    );

    // A card that needed reissuing must not cost the customer AND the payment.
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.advanced);
  });

  it('keeps access during a grace period', async () => {
    const user = await createAuthenticatedUser();
    await applyProviderEvent(event({ user_id: user.user_id }));

    await applyProviderEvent(
      event({
        user_id: user.user_id,
        type: 'customer.subscription.updated',
        status: SubscriptionStatus.in_grace_period,
      }),
    );

    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.advanced);
  });

  it('REVOKES access on refund, immediately', async () => {
    const user = await createAuthenticatedUser();
    await applyProviderEvent(event({ user_id: user.user_id }));
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.advanced);

    await applyProviderEvent(
      event({
        user_id: user.user_id,
        type: 'charge.refunded',
        status: SubscriptionStatus.refunded,
        revoked_at: new Date(),
      }),
    );

    // spec §5.10: a refunded user keeping premium is a straightforward revenue
    // leak. Not at period end — now.
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.free);
  });

  it('ends access when the paid period lapses, with no job needed', async () => {
    const user = await createAuthenticatedUser();
    await applyProviderEvent(event({ user_id: user.user_id }));

    await prisma.subscription.updateMany({
      where: { user_id: user.user_id },
      data: { current_period_end: new Date(Date.now() - 1000) },
    });

    // The sweep is bookkeeping; entitlement checks the period directly, so a
    // late job cannot hand out free premium.
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.free);
  });

  it('takes the higher tier when two subscriptions overlap on upgrade', async () => {
    const user = await createAuthenticatedUser();

    await applyProviderEvent(
      event({
        user_id: user.user_id,
        external_subscription_id: 'sub_basic',
        external_price_id: 'price_basic_monthly',
      }),
    );
    await applyProviderEvent(
      event({
        user_id: user.user_id,
        external_subscription_id: 'sub_advanced',
        external_price_id: 'price_advanced_monthly',
      }),
    );

    // Mid-period upgrades leave both rows briefly. The answer must be the
    // better one, not whichever the database returned first.
    expect(await resolveTier(user.user_id)).toBe(SubscriptionTier.advanced);
  });

  it('marks lapsed subscriptions expired when the sweep runs', async () => {
    const user = await createAuthenticatedUser();
    await applyProviderEvent(event({ user_id: user.user_id }));

    await prisma.subscription.updateMany({
      where: { user_id: user.user_id },
      data: { current_period_end: new Date(Date.now() - 1000) },
    });

    expect(await sweepExpiredSubscriptions()).toBe(1);
    expect((await prisma.subscription.findFirstOrThrow()).status).toBe(SubscriptionStatus.expired);
  });
});

describe('entitlement belongs to the USER (spec §5.10)', () => {
  it('resolves for the same user on a different device or session', async () => {
    const user = await createAuthenticatedUser({ email: 'carryover@example.com' });

    await applyProviderEvent(event({ user_id: user.user_id }));

    // A second sign-in is a different session entirely — the subscription is
    // keyed on user_id, so it carries.
    const second = await api
      .post(`${API_PREFIX}/auth/login`)
      .send({ email: 'carryover@example.com', password: 'correct horse battery staple' });

    const response = await api
      .get(`${API_PREFIX}/me/entitlements`)
      .set(authHeader(second.body.data));

    expect(response.body.data.tier).toBe('advanced');
  });

  it('never leaks one user’s subscription to another', async () => {
    const paying = await createAuthenticatedUser();
    const other = await createAuthenticatedUser();

    await applyProviderEvent(event({ user_id: paying.user_id }));

    const response = await api.get(`${SUBS}/me`).set(authHeader(other.tokens));

    expect(response.body.data.tier).toBe('free');
    expect(response.body.data.subscription).toBeNull();
  });
});

describe('GET /subscriptions/me', () => {
  it('returns the subscription and whether it is live', async () => {
    const user = await createAuthenticatedUser();
    await applyProviderEvent(event({ user_id: user.user_id }));

    const response = await api.get(`${SUBS}/me`).set(authHeader(user.tokens));

    expect(response.status).toBe(200);
    expect(response.body.data.tier).toBe('advanced');
    expect(response.body.data.subscription.is_active).toBe(true);
    expect(response.body.data.subscription.auto_renew).toBe(true);
    expect(response.body.data.subscription.current_period_end).toMatch(/Z$/);
  });

  it('returns null, never an omitted key, with no subscription', async () => {
    const user = await createAuthenticatedUser();

    const response = await api.get(`${SUBS}/me`).set(authHeader(user.tokens));

    expect(response.body.data.subscription).toBeNull();
    expect(response.body.data.tier).toBe('free');
  });
});

describe('POST /subscriptions/portal', () => {
  it('404s before there is any billing account', async () => {
    const user = await createAuthenticatedUser();

    const response = await api.post(`${SUBS}/portal`).set(authHeader(user.tokens)).send({});

    expect(response.status).toBe(404);
  });
});
