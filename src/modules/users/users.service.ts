import { UserStatus, prisma } from '@/db/prisma';
import { revokeAllTokensForUser } from '@modules/auth/token.service';
import { ApiError } from '@utils/api-error';
import { logger } from '@utils/logger';

/**
 * Account-level operations (spec §7, Batch 3).
 */

export interface DeleteAccountResult {
  deleted_at: string;
}

/**
 * Account deletion.
 *
 * A soft delete: `deleted_at` is stamped, the status moves to `deleted`, and
 * every session is revoked. The shared exclusion clause in
 * `@modules/safety/block.service` filters `deleted_at: null`, so the account
 * disappears from every read path immediately.
 *
 * Personal data is NOT scrubbed here. Reports, moderation history, and evidence
 * retention all reference this user, and deciding what must survive an erasure
 * request is a safety question that Batch 12 answers with the rest of the
 * safety module. Until then the row is retained in full — deliberately, and
 * recorded in DECISIONS.md, because retaining data you have promised to erase
 * is a compliance problem rather than an oversight to discover later.
 *
 * Idempotent: deleting twice returns the original timestamp rather than
 * erroring, so a retried request on a flaky connection is not a failure.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deleted_at: true },
  });

  if (!user) {
    throw ApiError.notFound();
  }

  if (user.deleted_at) {
    return { deleted_at: user.deleted_at.toISOString() };
  }

  const deletedAt = new Date();

  await prisma.user.update({
    where: { id: userId },
    data: {
      deleted_at: deletedAt,
      status: UserStatus.deleted,
      // Out of every deck immediately, without waiting for a job to run.
      is_snoozed: true,
    },
  });

  // Sessions die with the account; a live access token must not outlive it.
  await revokeAllTokensForUser(userId);

  logger.info({ user_id: userId }, 'account deleted');

  return { deleted_at: deletedAt.toISOString() };
}
