import { calculateAge } from '@utils/age';

/**
 * Shared compact shapes (spec §4.7).
 *
 * "Return enough to render a screen in one request. A match list item that
 * returns only user_id forces N+1 calls and a janky list."
 *
 * These become single Dart models on the client, so the shape must be identical
 * everywhere it appears — decks, matches, likes-you, conversation headers. Build
 * it here and nowhere else.
 */

export interface UserCompact {
  id: string;
  display_name: string;
  age: number | null;
  primary_photo_url: string | null;
  is_verified: boolean;
  is_premium: boolean;
  is_online: boolean;
  last_active_at: string;
}

/** The columns any query must select to build a UserCompact. */
export interface UserCompactSource {
  id: string;
  display_name: string;
  date_of_birth: Date | null;
  is_verified: boolean;
  subscription_tier: string;
  last_active_at: Date;
}

/**
 * Presence is real-time state that Socket.IO owns from Batch 9. Until then
 * every user reads as offline rather than the key being absent — spec §4.6
 * requires the key to exist with a null-or-default value, not to disappear.
 */
function resolveIsOnline(): boolean {
  return false;
}

/**
 * @param primaryPhotoUrl passed in rather than read from a nested relation, so
 * every caller decides explicitly how it loads the photo. Photos arrive in
 * Batch 4; until then callers pass null, and the key is always present rather
 * than omitted (spec §4.6).
 */
export function toUserCompact(
  source: UserCompactSource,
  primaryPhotoUrl: string | null = null,
): UserCompact {
  return {
    id: source.id,
    display_name: source.display_name,
    // spec §5.1: age is always computed from date of birth, never stored.
    age: source.date_of_birth ? calculateAge(source.date_of_birth) : null,
    primary_photo_url: primaryPhotoUrl,
    is_verified: source.is_verified,
    is_premium: source.subscription_tier !== 'free',
    is_online: resolveIsOnline(),
    // spec §4.6: UTC ISO-8601 with Z.
    last_active_at: source.last_active_at.toISOString(),
  };
}

/**
 * The Prisma `select` that produces a UserCompactSource. Kept beside the mapper
 * so a field added to one is impossible to forget in the other.
 */
export const USER_COMPACT_SELECT = {
  id: true,
  display_name: true,
  date_of_birth: true,
  is_verified: true,
  subscription_tier: true,
  last_active_at: true,
} as const;
