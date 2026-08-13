import { BillingCycle, SubscriptionTier, prisma } from '@/db/prisma';

/**
 * Subscription products (spec §5.10) — one logical product, three store SKUs.
 *
 * PROVISIONAL. Open decision #3 asks whether six SKUs ship (tier × cycle, per
 * the source doc) or two (per the Premium screen: $19/mo, $99/yr). All six are
 * seeded here because deactivating a row is trivial and adding one later means
 * new App Store Connect and Play Console configuration.
 *
 * The store product identifiers below are placeholders. Real ones are created
 * in App Store Connect and Play Console and must be pasted in before Batch 13.
 *
 * PriceVersion rows are INFORMATIONAL ONLY. With IAP the stores own the actual
 * charge; the backend records price history for reporting and grandfathering
 * and cannot change what a user is billed (spec §5.10, decision #3).
 */

interface ProductSeed {
  slug: string;
  name: string;
  tier: SubscriptionTier;
  billing_cycle: BillingCycle;
  /** spec §4.6: integer minor units. 1900 = $19.00. */
  amount_minor: number;
  currency: string;
}

const PRODUCTS: ProductSeed[] = [
  {
    slug: 'basic_monthly',
    name: 'Kinvo Basic — Monthly',
    tier: SubscriptionTier.basic,
    billing_cycle: BillingCycle.monthly,
    amount_minor: 999,
    currency: 'USD',
  },
  {
    slug: 'basic_quarterly',
    name: 'Kinvo Basic — Quarterly',
    tier: SubscriptionTier.basic,
    billing_cycle: BillingCycle.quarterly,
    amount_minor: 2499,
    currency: 'USD',
  },
  {
    slug: 'basic_yearly',
    name: 'Kinvo Basic — Yearly',
    tier: SubscriptionTier.basic,
    billing_cycle: BillingCycle.yearly,
    amount_minor: 5999,
    currency: 'USD',
  },
  {
    slug: 'advanced_monthly',
    name: 'Kinvo Premium — Monthly',
    tier: SubscriptionTier.advanced,
    billing_cycle: BillingCycle.monthly,
    amount_minor: 1900,
    currency: 'USD',
  },
  {
    slug: 'advanced_quarterly',
    name: 'Kinvo Premium — Quarterly',
    tier: SubscriptionTier.advanced,
    billing_cycle: BillingCycle.quarterly,
    amount_minor: 4900,
    currency: 'USD',
  },
  {
    slug: 'advanced_yearly',
    name: 'Kinvo Premium — Yearly',
    tier: SubscriptionTier.advanced,
    billing_cycle: BillingCycle.yearly,
    amount_minor: 9900,
    currency: 'USD',
  },
];

export async function seedProducts(): Promise<{ products: number }> {
  for (const [index, product] of PRODUCTS.entries()) {
    const record = await prisma.subscriptionProduct.upsert({
      where: { slug: product.slug },
      create: {
        slug: product.slug,
        name: product.name,
        tier: product.tier,
        billing_cycle: product.billing_cycle,
        // Placeholders — replace with the real store identifiers in Batch 13.
        apple_product_id: `com.kinvo.app.${product.slug}`,
        google_product_id: `kinvo_${product.slug}`,
        stripe_price_id: null,
        sort_order: index,
      },
      update: { name: product.name, sort_order: index },
    });

    const existing = await prisma.priceVersion.findFirst({
      where: { product_id: record.id, effective_to: null },
    });

    if (!existing) {
      await prisma.priceVersion.create({
        data: {
          product_id: record.id,
          amount_minor: product.amount_minor,
          currency: product.currency,
          effective_from: new Date('2026-01-01T00:00:00Z'),
          note: 'Seeded placeholder. The store owns the actual charge (spec §5.10).',
        },
      });
    }
  }

  return { products: PRODUCTS.length };
}
