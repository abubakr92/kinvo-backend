import { env } from '@config/env';
import type { PaymentProvider } from '@/providers/payment.provider';
import { StripePaymentProvider, UnconfiguredPaymentProvider } from '@/providers/stripe.provider';
import { logger } from '@utils/logger';

/**
 * Provider selection (spec §5.10, Batch 13).
 *
 * Falls back to an unconfigured provider when no Stripe key is present, which
 * is what lets the whole subscription lifecycle be built and tested before the
 * account exists. Unlike push and email, this fallback THROWS rather than
 * quietly succeeding — a payment that silently does nothing is far worse than
 * one that fails loudly, and there is no equivalent of "the feed still has it".
 *
 * Resolved lazily so importing this module never reads credentials.
 */

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    if (env.STRIPE_SECRET_KEY) {
      provider = new StripePaymentProvider({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      });
    } else {
      logger.warn('payments disabled — STRIPE_SECRET_KEY is not set');
      provider = new UnconfiguredPaymentProvider();
    }
  }

  return provider;
}

/** Tests swap in a stub; without a reset it leaks into the next suite. */
export function setPaymentProvider(next: PaymentProvider | null): void {
  provider = next;
}
