import { z } from 'zod';

/** Subscription request validation (spec §4.10, §5.10, Batch 13). */

/**
 * Note what is ABSENT: no tier, no price, no amount, no receipt.
 *
 * spec §5.10 — "never grant entitlement from a client claim alone". The client
 * names a product SLUG and nothing else; the price and the tier are read from
 * our own catalogue, and access changes only when the provider says so.
 */
export const checkoutSchema = z
  .object({
    product_slug: z.string().min(1).max(64),
    success_url: z.string().url().optional(),
    cancel_url: z.string().url().optional(),
  })
  .strict();

export const portalSchema = z.object({ return_url: z.string().url().optional() }).strict();

export type CheckoutBody = z.infer<typeof checkoutSchema>;
export type PortalBody = z.infer<typeof portalSchema>;
