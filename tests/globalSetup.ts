import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Runs once, before any test file.
 *
 * Applies migrations to the test database so `npm test` works from a clean
 * checkout with nothing but `docker compose up` (spec §0.4). Uses
 * `migrate deploy` rather than `migrate dev`: deploy applies committed
 * migrations and never generates new ones or prompts.
 */

/**
 * Resolves the Prisma CLI entry point so it can be run with the current Node
 * binary directly.
 *
 * Not `npx`: Node refuses to spawn a `.cmd` shim without a shell on Windows
 * (EINVAL, since the CVE-2024-27980 fix), and passing args through a shell does
 * not escape them (DEP0190). Running the CLI's JavaScript with `process.execPath`
 * avoids both, and works identically on Linux for CI.
 */
function resolvePrismaCli(): string {
  const manifestPath = require.resolve('prisma/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };

  const binField = manifest.bin;
  const relative = typeof binField === 'string' ? binField : (binField?.prisma ?? 'build/index.js');

  return path.join(path.dirname(manifestPath), relative);
}

export default function globalSetup(): void {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? 'postgresql://kinvo:kinvo@localhost:5433/kinvo_test';

  try {
    execFileSync(process.execPath, [resolvePrismaCli(), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Could not migrate the test database.\n' +
        'Is Docker running? Start it with `npm run db:up`.\n' +
        `Target: ${databaseUrl}\n\n${details}`,
    );
  }
}
