import { type SubscriptionTier, prisma } from '@/db/prisma';
import { clearEntitlementCache } from '@modules/entitlements/entitlements.service';
import type { EntitlementKey } from '@modules/entitlements/entitlements.types';
import { resetQuotas } from '@modules/entitlements/quota.service';
import { connectRedis, disconnectRedis } from '@/db/redis';
import { seedEntitlements as seedRealMatrix } from '../../prisma/seeds/entitlements';

/**
 * Seeds the REAL matrix, not a hand-built stub.
 *
 * The tier→flag table is data, so a test that invents its own rows proves the
 * resolver works against fixtures nobody ships. Calling production's own seed
 * means a broken matrix fails the suite instead of surfacing in staging.
 */
export async function seedEntitlements(): Promise<void> {
  await seedRealMatrix();
  clearEntitlementCache();
}

/** Overrides one flag for one tier — for testing a limit without seeding 50 swipes. */
export async function setFlag(
  tier: SubscriptionTier,
  key: EntitlementKey,
  value: boolean | number,
): Promise<void> {
  const flag = await prisma.entitlementFlag.findUniqueOrThrow({ where: { key } });
  await prisma.tierEntitlement.update({
    where: { tier_flag_id: { tier, flag_id: flag.id } },
    data: { value },
  });
  clearEntitlementCache();
}

export async function setTier(userId: string, tier: SubscriptionTier): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { subscription_tier: tier } });
}

/**
 * Redis survives `resetDatabase()`, so a counter left by one test would still be
 * there for the next and the suite would stop being order-independent (§0.4).
 */
export { resetQuotas };

/**
 * Redis is configured with lazyConnect and NO offline queue under test, so a
 * command issued before an explicit connect fails rather than buffering. Any
 * suite that exercises quota counters must open the connection itself —
 * production does it in server.ts, which tests never load.
 *
 * Skipping this does not fail loudly: `readCount` swallows connection errors
 * and reports zero used, which is indistinguishable from a fresh counter. A
 * suite would pass while proving nothing.
 */
export { connectRedis, disconnectRedis };
