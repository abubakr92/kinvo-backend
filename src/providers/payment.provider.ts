import type { PaymentSource, SubscriptionStatus } from '@/db/prisma';

/**
 * The payment provider boundary (spec §5.10, Batch 13).
 *
 * Apple IAP and Google Play Billing are OUT OF SCOPE — the mobile team owns
 * both stores (DECISIONS.md §1.2j and §1.2l). This interface exists anyway,
 * with one implementation, because the subscription LIFECYCLE is the hard part
 * and it must not learn the shape of whoever is charging the card. Adding a
 * store later is a new class here and nothing else.
 *
 * THE RULE THAT SHAPES EVERYTHING BELOW (spec §5.10):
 *
 *   "Never grant entitlement from a client claim alone. A client-trusting
 *    implementation is trivially exploitable and will be exploited."
 *
 * So no method here takes a tier, a price, or an entitlement from the caller.
 * The client asks for a checkout session; everything that changes access
 * arrives later, signed, through a webhook.
 */

/** A state change reported by the provider, already verified. */
export interface ProviderEvent {
  /** The provider's own id, used to make processing idempotent. */
  event_id: string;
  type: string;
  /** Identifies the subscription across its whole life, including renewals. */
  external_subscription_id: string;
  /** The provider's price identifier, mapped to a SubscriptionProduct. */
  external_price_id: string | null;
  /** Who this belongs to, as recorded when checkout was created. */
  user_id: string | null;
  status: SubscriptionStatus;
  current_period_start: Date | null;
  current_period_end: Date | null;
  auto_renew: boolean;
  /** Set only on refund or revocation. */
  revoked_at: Date | null;
  raw: unknown;
}

export interface CheckoutSession {
  /** Where to send the user to pay. */
  url: string;
  session_id: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly source: PaymentSource;
  readonly isConfigured: boolean;

  /**
   * Starts a purchase. Grants nothing — the user is not subscribed until the
   * provider says so through a verified webhook.
   */
  createCheckout(options: {
    userId: string;
    externalPriceId: string;
    successUrl: string;
    cancelUrl: string;
    /** Reuses the provider's customer record so history stays on one profile. */
    externalCustomerId?: string | null;
  }): Promise<CheckoutSession>;

  /**
   * A link to the provider's own management screen, where the user cancels or
   * updates a card. Building that ourselves would mean handling card details.
   */
  createPortalSession(options: {
    externalCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  /**
   * Verifies a webhook's signature and returns the event, or throws.
   *
   * Takes the RAW body: any parsing or re-serialisation before this point
   * changes the bytes the signature was computed over, and verification then
   * fails for a reason that looks nothing like the cause.
   */
  verifyWebhook(rawBody: Buffer, signature: string): ProviderEvent | null;
}
