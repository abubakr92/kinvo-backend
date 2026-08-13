import { disconnectDatabase, prisma } from '@/db/prisma';
import { seedCatalogues } from './seeds/catalogues';
import { seedEntitlements } from './seeds/entitlements';
import { seedProducts } from './seeds/products';
import { seedUsers } from './seeds/users';
import { seedVenues } from './seeds/venues';

/**
 * Development seed (spec §7, Batch 1).
 *
 * Every step is idempotent — re-running updates rather than duplicating — so
 * this is safe against a database that already has data.
 *
 * Order matters: users attach interests, so catalogues must exist first.
 *
 * This is NOT test data. Tests seed and clean their own (spec §0.4).
 * Uses console output deliberately: this is a CLI script, not the server, so
 * the Pino request logger would be the wrong tool.
 */

/* eslint-disable no-console */

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('Seeding Kinvo development data…\n');

  const catalogues = await seedCatalogues();
  console.log(`  catalogues     ${catalogues.interests} interests, ${catalogues.prompts} prompts`);

  const entitlements = await seedEntitlements();
  console.log(
    `  entitlements   ${entitlements.flags} flags across 3 tiers ` +
      `(${entitlements.provisional} provisional — open decisions #2, #7, #10)`,
  );

  const products = await seedProducts();
  console.log(`  products       ${products.products} subscription products with price versions`);

  const venues = await seedVenues();
  console.log(`  venues         ${venues.venues} venues with PostGIS locations`);

  const users = await seedUsers();
  console.log(`  users          ${users.users} dev users with profiles, modes, and interests`);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);
  console.log('Dev users have no password hash — argon2 arrives in Batch 2.');
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => prisma.$disconnect());
  });
