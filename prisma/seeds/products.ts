import { BillingCycle, SubscriptionTier, prisma } from '@/db/prisma';

/**
 * Subscription products (spec §5.10) — one logical product, three store SKUs.
 *
 * FOUR products: two tiers, monthly and yearly. Decided by the product owner
 * on 2026-08-28 (DECISIONS.md §1.2o), replacing the six provisional SKUs.
 *
 * Quarterly was dropped because it sells to nobody: someone weighing a
 * commitment picks monthly, and someone convinced picks yearly for the
 * discount. Weekly was never added — it is a churn machine.
 *
 * Apple and Google identifiers are NULL. Both stores are out of scope; the
 * mobile team owns them (§1.2j, §1.2l). The columns stay so a store can be
 * added later without a migration.
 *
 * PriceVersion rows are effective-dated so a price change is a new row and the
 * old one survives for grandfathering and reporting. With Stripe these are
 * NOT merely informational — unlike IAP, we set the price, so the amount here
 * is expected to match the Stripe price it points at. Stripe remains the
 * authority on what is actually charged.
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
    // A third off the monthly rate, which is the discount that makes an annual
    // plan worth offering at all.
    slug: 'basic_yearly',
    name: 'Kinvo Basic — Yearly',
    tier: SubscriptionTier.basic,
    billing_cycle: BillingCycle.yearly,
    amount_minor: 7999,
    currency: 'USD',
  },
  {
    slug: 'advanced_monthly',
    name: 'Kinvo Premium — Monthly',
    tier: SubscriptionTier.advanced,
    billing_cycle: BillingCycle.monthly,
    amount_minor: 1999,
    currency: 'USD',
  },
  {
    slug: 'advanced_yearly',
    name: 'Kinvo Premium — Yearly',
    tier: SubscriptionTier.advanced,
    billing_cycle: BillingCycle.yearly,
    amount_minor: 15999,
    currency: 'USD',
  },
];

export async function seedProducts(): Promise<{ products: number }> {
  // Quarterly products were seeded before the four-SKU decision. Deactivated
  // rather than deleted: a deleted product breaks the foreign key on any
  // subscription that ever referenced it, and price history is worth keeping.
  await prisma.subscriptionProduct.updateMany({
    where: { slug: { notIn: PRODUCTS.map((product) => product.slug) } },
    data: { is_active: false },
  });

  for (const [index, product] of PRODUCTS.entries()) {
    const record = await prisma.subscriptionProduct.upsert({
      where: { slug: product.slug },
      create: {
        slug: product.slug,
        name: product.name,
        tier: product.tier,
        billing_cycle: product.billing_cycle,
        // Both stores are out of scope — the mobile team owns them. Null
        // rather than a placeholder, because a placeholder that looks like a
        // real identifier is how a lookup silently matches the wrong product.
        apple_product_id: null,
        google_product_id: null,
        // Set from the real Stripe dashboard price id once the account exists.
        // Until then checkout answers 404 for the plan, which is honest.
        stripe_price_id: null,
        sort_order: index,
      },
      // is_active is set here too, not just on create. The updateMany above
      // deactivates anything absent from PRODUCTS, so without this the seed is
      // one-way: a product removed and later restored would stay invisible,
      // and the only symptom is a plan missing from the paywall.
      update: { name: product.name, sort_order: index, is_active: true },
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
          note: 'Seeded price. Stripe is the authority on what is charged (spec §5.10).',
        },
      });
    }
  }

  return { products: PRODUCTS.length };
}
