import { SubscriptionTier, prisma } from '@/db/prisma';

/**
 * The entitlement matrix (spec §5.11).
 *
 * The spec is explicit that this must be DATA, NOT CODE: "Filling in a `?`
 * later must be a seed change, never a code change." So the resolver in Batch 6
 * reads these rows and knows nothing about tier names.
 *
 * PROVISIONAL VALUES. Open decisions #2 (which features in which tier), #3
 * (pricing shape), #7 (free-tier caps), and #10 (is rewind premium) are still
 * unanswered. Every value marked PROVISIONAL below is a placeholder chosen so
 * the system runs end to end — changing it is editing this file and re-seeding.
 * Nothing downstream branches on a tier name.
 *
 * Numeric flags use -1 for "unlimited".
 */

const UNLIMITED = -1;

interface FlagSeed {
  key: string;
  label: string;
  description: string;
  value_type: 'boolean' | 'number';
  free: boolean | number;
  basic: boolean | number;
  advanced: boolean | number;
  /** True where the spec matrix has a `?` and we have picked a placeholder. */
  provisional?: boolean;
}

const FLAGS: FlagSeed[] = [
  {
    key: 'standard_discovery',
    label: 'Profile and standard discovery',
    description: 'Browse decks and build a profile.',
    value_type: 'boolean',
    free: true,
    basic: true,
    advanced: true,
  },
  {
    key: 'daily_swipe_limit',
    label: 'Daily swipes',
    description: 'Swipes per UTC day. -1 is unlimited. Resets at UTC midnight.',
    value_type: 'number',
    free: 50, // PROVISIONAL — open decision #7
    basic: UNLIMITED,
    advanced: UNLIMITED,
    provisional: true,
  },
  {
    key: 'daily_message_limit',
    label: 'Daily messages',
    description: 'Messages per UTC day. -1 is unlimited.',
    value_type: 'number',
    free: 30, // PROVISIONAL — open decision #7
    basic: UNLIMITED,
    advanced: UNLIMITED,
    provisional: true,
  },
  {
    key: 'basic_filters',
    label: 'Basic filters',
    description: 'Age and distance filtering.',
    value_type: 'boolean',
    free: true,
    basic: true,
    advanced: true,
  },
  {
    key: 'advanced_filters',
    label: 'Advanced filters',
    description: 'Interests, goals, and category filtering.',
    value_type: 'boolean',
    free: false,
    basic: true,
    advanced: true,
  },
  {
    key: 'see_who_liked_you',
    label: 'See who liked you',
    description: 'The Requests tab — a likes-you inbox (decision #5).',
    value_type: 'boolean',
    free: false,
    basic: false, // PROVISIONAL — open decision #2
    advanced: true,
    provisional: true,
  },
  {
    key: 'extend_matches',
    label: 'Extend matches',
    description: 'Push a match past its expiry.',
    value_type: 'boolean',
    free: false,
    basic: false, // PROVISIONAL — open decision #2
    advanced: true,
    provisional: true,
  },
  {
    key: 'boost',
    label: 'Boost / Spotlight',
    description: 'Temporarily raise deck ranking.',
    value_type: 'boolean',
    free: false,
    basic: false, // PROVISIONAL — open decision #2
    advanced: true,
    provisional: true,
  },
  {
    key: 'rewind',
    label: 'Rewind / undo swipe',
    description: 'Reverse the last swipe in the current mode.',
    value_type: 'boolean',
    free: false, // PROVISIONAL — open decision #10
    basic: true,
    advanced: true,
    provisional: true,
  },
  {
    key: 'max_simultaneous_modes',
    label: 'Simultaneous modes',
    description: 'How many modes may be enabled at once. -1 is unlimited.',
    value_type: 'number',
    // Decided by the product owner, 2026-08-26. Free gets three rather than one
    // so the multi-mode idea is visible to someone who has not paid — one mode
    // makes Kinvo look like every other dating app until you subscribe.
    free: 3,
    basic: 5, // PROVISIONAL — open decision #2
    advanced: UNLIMITED,
    provisional: true,
  },
  {
    key: 'show_ads',
    label: 'Ads shown',
    description: 'AdMob is client-side; the backend only exposes this flag (spec §5.10).',
    value_type: 'boolean',
    free: true,
    basic: false,
    advanced: false,
  },
];

export async function seedEntitlements(): Promise<{ flags: number; provisional: number }> {
  for (const flag of FLAGS) {
    const record = await prisma.entitlementFlag.upsert({
      where: { key: flag.key },
      create: {
        key: flag.key,
        label: flag.label,
        description: flag.description,
        value_type: flag.value_type,
      },
      update: {
        label: flag.label,
        description: flag.description,
        value_type: flag.value_type,
      },
    });

    const byTier: [SubscriptionTier, boolean | number][] = [
      [SubscriptionTier.free, flag.free],
      [SubscriptionTier.basic, flag.basic],
      [SubscriptionTier.advanced, flag.advanced],
    ];

    for (const [tier, value] of byTier) {
      await prisma.tierEntitlement.upsert({
        where: { tier_flag_id: { tier, flag_id: record.id } },
        create: { tier, flag_id: record.id, value },
        update: { value },
      });
    }
  }

  return {
    flags: FLAGS.length,
    provisional: FLAGS.filter((flag) => flag.provisional).length,
  };
}
