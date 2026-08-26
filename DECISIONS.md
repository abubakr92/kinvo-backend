# DECISIONS.md — Kinvo Backend

A living record of **what was decided, what was done, and what each batch depends on.**

Three rules for this file:

1. Every decision that the spec did not dictate gets logged here, with its reasoning and who made it.
2. Every action taken against the repository or the environment gets logged here.
3. Nothing here overrides `KINVO_BACKEND_BUILD.md`. That document is the specification; this one is the audit trail.

Roles below: **PO** = product owner (Abubakr). **Eng** = the implementing agent.

---

## 1. Decision log

### 1.1 Resolved by the specification — do not re-ask

| #   | Decision                                                                                           | Source                 |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | **Database: PostgreSQL 16 + PostGIS.** S3 stores media bytes only, never application records.      | Spec §6, confirmed Eng |
| 4   | **Trading mode is an interest category only.** No trading, transfers, brokerage, or market data.   | Spec §1, §6            |
| 13  | **Payment rails:** Apple StoreKit 2 + Google Play Billing primary; Stripe as US-only web link-out. | Spec §2, §6            |

### 1.2 Resolved during this engagement

| #   | Decision                                                                                                                                             | Date       | By  | Reasoning                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —   | **Runtime is Node.js 24**, not the spec's Node 20 LTS.                                                                                               | 2026-08-13 | PO  | Node 20 reached end-of-life in April 2026 — four months before this build started. Shipping on an EOL runtime means no security patches from day one. Eng raised it; PO approved 24 (the version already installed locally).        |
| 5   | **The "Requests" tab is a likes-you inbox.** It lists _profiles_ of people who liked you and are awaiting your response — not messages.              | 2026-08-13 | PO  | Eng recommended it. Option B (message requests from unmatched users) would let a conversation exist with no match behind it, breaking spec §5.4's "conversation belongs to a match". Also a safety liability in Cuddle and Trading. |
| —   | **Users cannot message before matching.** Direct consequence of #5.                                                                                  | 2026-08-13 | PO  | Every conversation has exactly one match behind it. `Conversation.match_id` is non-nullable.                                                                                                                                        |
| 11  | **Study Buddy is one-to-one only in v1.** No multi-party group chats in any mode.                                                                    | 2026-08-13 | PO  | Eng recommended it. Groups would break read receipts, unread counts, typing indicators, block enforcement, and match expiry all at once, and the demand would immediately spread to Fitness and Foodie.                             |
| —   | **Every conversation has exactly two participants.** Direct consequence of #11.                                                                      | 2026-08-13 | PO  | Lets the schema use two user columns rather than a participants join table.                                                                                                                                                         |
| —   | **Deploy to AWS**, on the client's existing AWS account, rather than Render.                                                                         | 2026-08-13 | PO  | Eng initially recommended Render for lower operational overhead. PO has the client's AWS account, and the client expects it there. Nothing in the codebase is host-specific, so this is a deployment concern only.                  |
| —   | **AWS shape: EC2 (API in Docker) + RDS Postgres/PostGIS + ElastiCache Redis + S3.** Caddy terminates TLS. Terraform describes the infrastructure.    | 2026-08-13 | Eng | The production database must be managed (RDS), not self-run in a container — Batch 4 stores government ID images, and owning backup and recovery for that is not acceptable. Awaiting PO confirmation at the deployment interlude.  |
| —   | **Never use AWS root credentials.** An IAM user with scoped permissions, MFA on root, and a billing alert are prerequisites for any deployment work. | 2026-08-13 | PO  | The client supplied root credentials. Root cannot be permission-limited and can close the account. PO is creating the IAM user.                                                                                                     |
| —   | **Deploy staging after Batch 3**, not at Batch 15.                                                                                                   | 2026-08-13 | Eng | After Batch 3 the mobile team has auth, profiles, and onboarding — enough to build against. Deploying later blocks them for months, then surfaces every integration problem at once.                                                |

### 1.2b Resolved during Batch 2 (auth)

| Decision                                                                                                                             | Date       | By  | Reasoning                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`users.date_of_birth` is nullable.** The under-18 rejection fires whenever a date of birth is set, not only at email registration. | 2026-08-14 | PO  | Google, Apple, and Twilio supply no date of birth, so a social or phone signup cannot know a user's age at account creation. A user without one stays `pending` and is blocked from discovery, matching, and chat, so nobody under 18 reaches the product — which is what spec §5.1 actually protects.           |
| **A new phone number creates a pending account** rather than being refused.                                                          | 2026-08-14 | PO  | Same reasoning. Consistent with social signup, and `requireOnboarded` is the single gate for both.                                                                                                                                                                                                               |
| **Libraries added:** `argon2`, `jsonwebtoken`, `twilio`, `google-auth-library`, `express-rate-limit`, `rate-limit-redis`, `ioredis`. | 2026-08-14 | PO  | PO delegated the choice. The first three are named in spec §2; the rest cover Google ID-token verification and the rate limiting §4.9 requires.                                                                                                                                                                  |
| **Apple ID tokens are verified with no JWKS library** — Node's `createPublicKey` plus `jsonwebtoken`.                                | 2026-08-14 | Eng | `jose` was planned and approved, but it is ESM-only and the CommonJS test runner cannot load it; `jwks-rsa` depends on it and fails the same way. Apple's JWKS is a small JSON document and Node imports a JWK natively, so this removed a dependency instead of adding one. **Deviates from what PO approved.** |
| **Rate limits are disabled under test** via a test-only switch, and enabled by the suite that asserts them.                          | 2026-08-14 | Eng | A suite makes far more requests from one address than any real client, so limits would fail unrelated tests. The switch throws if called outside tests.                                                                                                                                                          |
| **`X-RateLimit-*` legacy headers stay on.** The draft-7 `RateLimit` header is emitted alongside.                                     | 2026-08-14 | Eng | Spec §4.9 names `X-RateLimit-*` explicitly, so those are the client contract the Flutter app reads.                                                                                                                                                                                                              |
| **Dev seed users share the password `kinvo-dev-password`.**                                                                          | 2026-08-14 | Eng | The mobile team needs sign-in-able accounts on staging. Safe because the seed only ever runs against development and staging databases.                                                                                                                                                                          |

### 1.2c Resolved during Batches 4 and 5

| Decision | Date | By | Reasoning |
| --- | --- | --- | --- |
| **Free tier gets 3 simultaneous modes.** Basic 5, Advanced unlimited. | 2026-08-26 | PO | Eng proposed 2; PO chose 3. One mode makes Kinvo look like every other dating app until you pay, so the multi-mode idea has to be visible to someone who has not subscribed. Seeded value, changeable without code. |
| **Enabling Cuddle requires an approved verification.** | 2026-08-26 | PO | Spec §5.7 flags Cuddle as elevated risk: physical-contact meetups, and it will attract misuse. Far easier to require from day one than to impose later on existing users. `can_enable` is returned up front so the app greys the toggle rather than letting the user tap into a 403. |
| **Onboarding requires: display name, date of birth (18+), bio, location, ≥1 interest, ≥1 approved photo, ≥1 enabled mode.** | 2026-08-26 | Eng | A declared checklist in `onboarding.service.ts`, not scattered conditionals. Batch 4 added the photo, Batch 5 the mode. Adding a requirement is one entry there. |
| **Account deletion is a soft delete; PII is NOT scrubbed.** | 2026-08-21 | PO | Deferred to Batch 12, where reports and evidence retention are on the table and it can be decided what must survive an erasure request. **This is a GDPR exposure until then** — recorded so it is a known debt, not a surprise. |
| **Media auto-approval is an explicit env switch, forbidden in production.** | 2026-08-20 | Eng | Nothing moves a photo from pending to approved until Batch 10, so without it every uploaded photo is invisible to everyone. Same shape as the Twilio dev stub: useful locally, impossible to ship. **Batch 10 must delete `MEDIA_AUTO_APPROVE_UPLOADS` entirely.** |
| **Staging waives third-party integrations** via `REQUIRE_THIRD_PARTY_INTEGRATIONS=false`. | 2026-08-25 | Eng | No Twilio, Google, or Apple accounts exist yet. Production still refuses to boot without them. The waiver deliberately does not relax the CORS or media-moderation rules, and a test asserts it cannot. **Must become true before real users sign in.** |
| **API documentation is served at `/docs`**, brought forward from Batch 15. | 2026-08-26 | PO | The mobile team needed the contract. Request bodies generate from the Zod schemas the endpoints validate with, and a test fails the build if a route is undocumented. |

### 1.2d Resolved during Batch 6 (entitlements)

| Decision | Date | By | Reasoning |
| --- | --- | --- | --- |
| **The entitlement matrix stays data; no code branches on a tier name.** | 2026-08-26 | Eng | Spec §5.11 requires it, and it is what lets #2, #3, #7 and #10 be answered after launch. A test proves it: flipping Rewind on for free is a seeded row edit, and the endpoint reports the change with no deploy. |
| **A missing or wrongly typed flag fails CLOSED** (boolean → false, number → 0). | 2026-08-26 | Eng | A broken seed must never hand out a premium feature or an unlimited quota. Closed is loud — someone reports the feature missing within the hour. Open is silent and leaks revenue indefinitely. The seed additionally refuses to run if a declared key has no row. |
| **The matrix is cached in process for 60s; the user’s TIER IS NEVER CACHED.** | 2026-08-26 | Eng | The matrix is global and changes quarterly. A tier changes the instant a payment clears, and a stale tier tells someone who just paid to upgrade — the worst bug this module could have. Same reasoning as `authenticate` reloading the user rather than trusting a token claim. |
| **Quota counters fail OPEN when Redis is unreachable.** | 2026-08-26 | Eng | Quotas bind only the free tier; paid tiers are unlimited and never reach the counter. Failing closed turns a cache outage into "nobody can swipe or send a message" — a total outage to protect revenue from users who are not paying. Logged at error level so the outage is still visible. |
| **Check-and-consume is a single Lua script, not GET-then-INCR.** | 2026-08-26 | Eng | Two concurrent requests both read "49 of 50" and both proceed otherwise. The limit that is supposed to sell a subscription would be quietly exceedable by anyone tapping fast. A test fires 20 concurrent consumes at a cap of 5 and asserts exactly 5 succeed. |
| **Numeric caps are consumed in the service, not in middleware.** | 2026-08-26 | Eng | A daily cap must be spent inside the transaction that performs the action so it can be refunded when that action fails — otherwise a user is charged a swipe the database rejected. Middleware cannot see that far. `requireEntitlement` therefore gates boolean features only. |
| **The mode cap now reads the resolver** rather than querying the matrix itself. | 2026-08-26 | Eng | Batch 5 read `tier_entitlements` directly because the resolver did not exist. Two places interpreting the same rows drift; the Batch 5 copy is gone. |
| **Tests seed the REAL matrix**, via production’s own seed function. | 2026-08-26 | Eng | Batch 5’s mode tests hand-built a one-row stub, which proves the resolver works against fixtures nobody ships. Calling the real seed means a broken matrix fails the suite instead of surfacing in staging. |

### 1.2e Provisional answers taken under autonomous execution

On 2026-08-26 the PO authorised running Batches 6→10 without stopping between
them, accepting that the open decisions below would be answered with documented
defaults. **These are engineering placeholders, not PO decisions.** Each is
listed with what it costs to change later.

| # | Question | Placeholder | Cost to change |
| --- | --- | --- | --- |
| 7 | Free daily swipe cap | **50/day** | Seed edit + re-seed. Free. |
| 7 | Free daily message cap | **30/day** | Seed edit + re-seed. Free. |
| 10 | Rewind free or premium | **Premium (basic and above)** | Seed edit + re-seed. Free. |
| 6 | Match expiry TTL | **14 days** | Config constant. Cheap. |
| 6 | What expiry does to the conversation | **Read-only, stays visible** | **Code.** Affects the chat query and the match list. |
| — | Block visibility | **Conversation frozen and visible; 404 on every other path** | **Code.** Affects the shared exclusion clause and the chat module. |
| 8 | Moderation provider | **Rules-based v1, behind a provider interface** | Provider swap. Cheap by design. |

### 1.2f Resolved during Batch 7 (discovery and matching)

| Decision | Date | By | Reasoning |
| --- | --- | --- | --- |
| **A pass costs no quota; only likes and super likes do.** | 2026-08-26 | Eng | The spec says "daily swipe cap" and the flag is `daily_swipe_limit`. Read literally that would cap passes too, which strands a free user on a profile they do not want and extracts no value — nobody has ever paid to skip someone faster. Read as a cap on the actions that can lead to a match, it does the job it exists for. **This is an interpretation, not a PO decision** — one constant in `swipe.service.ts` reverses it. |
| **Rewind deletes the match its swipe created.** | 2026-08-26 | Eng | Keeping it leaves a conversation neither person can trace, and the unique index on `(user_a, user_b, mode)` would stop the pair ever matching again in that mode. Rewind means restoring the pre-swipe state or it means nothing. |
| **Decks are generated lazily on read; BullMQ precompute is an optimisation.** | 2026-08-26 | Eng | Built the other way round, a worker that is down, behind, or not yet deployed shows users an empty product. This way a queue outage costs latency on first open and nothing else. |
| **Boost and verification are RANKING inputs only.** | 2026-08-26 | Eng | Neither can place someone into a deck a filter excluded them from. Conflating ranking with filtering is precisely how a paid boost would start beating a block. A test asserts a boosted, blocked user still does not appear. |
| **The deck pre-excludes cheaply, then applies the shared clause in Prisma.** | 2026-08-26 | Eng | PostGIS cannot compose `visibleUserFilter`, so the radius query takes an exclusion array (self, blocks, already-swiped) and the real clause runs on the result. `CANDIDATE_POOL` is 500 against a deck of 50, so the two-phase split cannot truncate a correct answer. |
| **Cursors are opaque base64, never parsed outside `@utils/cursor`.** | 2026-08-26 | Eng | The moment anything reads a cursor payload it becomes an API surface, and the ordering key can never change again without a client release. |

### 1.2g Resolved during Batch 8 (matches and chat)

| Decision | Date | By | Reasoning |
| --- | --- | --- | --- |
| **Block visibility: the conversation stays VISIBLE and FROZEN.** | 2026-08-26 | Eng (placeholder, see 1.2e) | Spec §5.5 says read-only, §4.4 says do not confirm a block; these pull in opposite directions. Hiding the thread makes history vanish mid-scroll and reads as data loss. Leaving it writable defeats the block. Visible-and-frozen satisfies both, and the send error is identical for every closed reason. |
| **Every closed-conversation reason answers the SAME 403.** | 2026-08-26 | Eng | Blocked, expired, unmatched, and other-account-deleted return byte-identical errors. Distinguishing them would let someone confirm a block by elimination — the same leak a 403 on a blocked profile causes. A test asserts the blocker and the blocked side get identical status, code, and message. |
| **`is_writable` is returned on matches and conversations.** | 2026-08-26 | Eng | The app hides the composer on a flag rather than discovering the state by having a send rejected. Without it the only way to learn a thread is frozen is to type a message and lose it. |
| **Match expiry is computed at READ time; the sweeper is bookkeeping.** | 2026-08-26 | Eng | A row whose `expires_at` has passed is expired the moment it passes. Trusting the status column would leave matches writable for however long the job is behind, so a queue outage would silently extend everyone. The job only updates the column for admin lists and analytics. |
| **Extend adds to the CURRENT expiry, not to now.** | 2026-08-26 | Eng | Extending a match with three days left must give the full window on top, not reset it to a shorter one. An already-expired match extends from now, so it becomes usable again rather than staying expired. |
| **The conversation is created inside the match transaction.** | 2026-08-26 | Eng | A match can never exist without somewhere to talk, and the chat module never has to handle a missing conversation. Both `conversation_state` rows are created at the same time so the unread badge has somewhere to live from the first message. |
| **Unmatch is a status change, not a delete.** | 2026-08-26 | Eng | `unmatched_by_id` is what a later report investigation needs, and it is never exposed to the other person. The swipes stay so the pair is not offered to each other again in that mode. |
| **A new message un-archives the thread for the recipient.** | 2026-08-26 | Eng | Otherwise an archived conversation is silently unreachable while its unread badge counts up. |

### 1.2h Resolved during Batch 9 (realtime)

| Decision | Date | By | Reasoning |
| --- | --- | --- | --- |
| **Realtime is a DELIVERY layer, never a second write path.** | 2026-08-26 | Eng | Spec §7: persist first, then emit. Every socket event describes something already committed, and every emitter is called after its transaction. A dropped socket costs a refresh, never a message, and the whole feature can be switched off without the product losing correctness. |
| **Typing indicators are addressed to the other participant, not a shared room.** | 2026-08-26 | Eng | A conversation room has to be joined first, which makes delivery depend on a join the sender cannot observe — the recipient silently misses indicators. Every conversation has exactly two people (#11), so addressing the other one directly is simpler and cannot race. |
| **Presence counts CONNECTIONS, not users.** | 2026-08-26 | Eng | A boolean marks someone offline the moment one of two devices closes. A Redis set of socket ids, with a 90s TTL so a commuter switching networks does not flicker offline and fan an event out to every match. |
| **Presence is only ever sent to active matches, never across a block.** | 2026-08-26 | Eng | Broadcasting it widely tells strangers when someone is at their phone; telling a blocked person hands them a live activity feed of the person who blocked them. Two tests assert both negatives. |
| **Online state in Redis, `last_active_at` in Postgres.** | 2026-08-26 | Eng | Online state changes on every connect and is worthless after a restart. `last_active_at` is shown on profiles long after the socket is gone, so it is durable — written on a 5-minute throttle rather than on every heartbeat. |
| **`is_online` is resolved in BULK by the caller.** | 2026-08-26 | Eng | `toUserCompact` takes it as a parameter for the same reason it takes the photo URL: reading presence per row is the N+1 that compact objects exist to prevent. It defaults to false, so a list that has not resolved presence understates activity rather than claiming someone is available. |
| **The socket contract is its own document at `/docs/realtime.json`.** | 2026-08-26 | Eng | OpenAPI has no vocabulary for socket events. Generated from the same Zod schemas the server validates against, so the document cannot describe a payload the server would reject, and a drift test fails the build on an undocumented event. |
| **The socket shares the HTTP server and port.** | 2026-08-26 | Eng | A separate port needs its own load-balancer rule and its own certificate. Riding the same server means realtime inherits the TLS termination and CORS policy the REST API already has. |

### 1.2i Resolved during Batch 10 (moderation)

| Decision | Date | By | Reasoning |
| --- | --- | --- | --- |
| **#8 answered: rules-based v1**, behind a `ModerationProvider` interface. | 2026-08-26 | Eng (placeholder — see 1.2e) | No account and no key, so it cannot become the thing blocking a launch. No per-call cost, so it runs on every message rather than being rationed. And it does not send users’ private messages to a third party, which for a dating app is a real privacy property rather than a cost saving. It is worse at nuance than a model and is meant to be replaced — that is what the interface is for. |
| **The check is advisory at every severity.** `can_send` is a constant `true`. | 2026-08-26 | Eng | Spec §5.4. It is written as a constant deliberately: the day it becomes conditional, the product has started blocking messages on a regex. |
| **Fail open, everywhere.** | 2026-08-26 | Eng | A provider outage returns `timed_out: true`, severity `none`, and queues the content for review. Blocking a user’s message on a third party’s outage is a worse failure than reviewing it late. The message send path fails open too, not just the check endpoint. |
| **Checked content is hashed, never stored.** | 2026-08-26 | Eng | The row has to be linkable so a moderator can tell two reports about the same text apart. Keeping a copy of every message a user *considered* sending — including the ones they edited away — is a surveillance database nobody asked for. |
| **Scam and payment rules take no mode argument at all.** | 2026-08-26 | Eng | Spec §1 requires these checks to be global rather than dating-scoped, because Trading attracts investment fraud. Making the function unable to accept a mode is stronger than remembering not to pass one. |
| **`MEDIA_AUTO_APPROVE_UPLOADS` deleted**, as promised in 1.2c. | 2026-08-26 | Eng | Replaced by the real pipeline: photos go live on upload and are queued for post-hoc human review (spec §7 asks for a "post-hoc scanning queue"). Every photo pending a moderator would mean nobody can finish onboarding until one is awake. |
| **A provider that cannot assess a subject queues it rather than passing it.** | 2026-08-26 | Eng | Rules read words and cannot look at pixels. Claiming image support would mark every photo clean and leave a queue that looks healthy while nothing is checked — worse than admitting the gap. |
| **Flags are idempotent per subject, and severity ratchets upward only.** | 2026-08-26 | Eng | A message scanned twice must not appear twice in the queue, and a later benign scan must never quiet an earlier serious finding. |
| **The queue answers 403 for non-moderators, not 404.** | 2026-08-26 | Eng | Unlike a block, where 404 hides whether something exists (§4.4), an admin surface is a documented part of the API. There is nothing to conceal and a clear error is more useful. |

### 1.3 Still open — must be answered before the batch listed

| #   | Question                                                                                                   | Blocks batch   | Notes                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Match expiry TTL — how many days? **And what expiry does to the conversation.**                            | 7              | The spec asks only for the number. Eng flagged the missing half: does the conversation go read-only, vanish, or move to Archived? Does a new message reset the clock?        |
| 7   | Free-tier daily swipe cap and message cap — numbers?                                                       | 7, 8           | Counter resets at UTC midnight (spec §5.3).                                                                                                                                  |
| 10  | Is Rewind free or premium?                                                                                 | 7              |                                                                                                                                                                              |
| —   | **Block visibility:** does a blocked pair's conversation stay visible read-only, or disappear entirely?    | 8, 12          | Spec §5.5 says read-only; spec §4.4 says return 404 so a block is not confirmed. These contradict. Eng recommends: conversation visible and frozen, 404 on every other path. |
| —   | **Profile photo URLs:** CDN signed URLs vs expiring S3 presigned GETs.                                     | 4              | Presigned GETs expire and are unique per request, so Flutter's image cache misses on every render. Eng recommends CDN for photos, short presigned GETs for ID documents.     |
| —   | **Cloudflare R2 instead of S3** for media bytes?                                                           | 4              | Identical API, no egress charges. For a photo-heavy app, egress is the fastest-growing line on the bill. Same SDK code, different endpoint.                                  |
| 2   | Basic vs Advanced Premium — which features in which tier?                                                  | 13 (seed at 1) | Batch 1 seeds a **provisional** matrix with documented defaults. Because the matrix is data, filling these in later is a seed change, never a code change.                   |
| 3   | Pricing shape — six SKUs (tier × cycle) or two?                                                            | 13             | Every SKU must be created in App Store Connect and Play Console. Store-set pricing means the spec's yearly-increase automation cannot work as written.                       |
| 14  | Ship the US Stripe link-out in v1, or IAP only?                                                            | 13             | Eng recommends IAP-only for v1: always compliant, no region gating, and the US carve-out is under Supreme Court review.                                                      |
| —   | RevenueCat as an abstraction over Apple and Google receipt validation?                                     | 13             | Spec §2 asks for this to be raised rather than adopted unilaterally.                                                                                                         |
| 12  | Admin analytics — which metrics exactly?                                                                   | 15             |                                                                                                                                                                              |

---

### 1.4 Questions awaiting an answer — full options

The table in 1.3 lists every open decision. This section spells out the four that
block the next two batches, so the choice can be made without re-deriving the
trade-offs. Delete a block once it is answered and move it to 1.2.

---

#### Q1 — Free-tier daily swipe cap (decision #7, blocks Batch 7)

How many swipes does a free user get per day, and is the counter per mode or
shared across all enabled modes? Resets at UTC midnight either way (spec §5.3).

| Option                             | Consequence                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **50 per mode** _(Eng recommends)_ | Each enabled mode has its own counter. Generous enough that casual users rarely hit it, tight enough to sell Premium.                                        |
| 25 per mode                        | Users reach the paywall in one sitting. Converts faster; risks a new user exhausting the deck on day one and not returning.                                  |
| 50 shared across all modes         | One counter for the account. Simpler to explain, but penalises multi-mode use — the exact behaviour the product exists to encourage.                         |
| No cap at all                      | Monetise through see-who-liked-you, boost, and advanced filters instead. Contradicts spec §5.3, which mandates a cap, so this would be an explicit override. |

**Dependency worth knowing:** per-mode versus shared only differs if free users
can enable more than one mode at once. That is open decision #2, currently seeded
as 1 mode for free. If free stays at one mode, the two options behave identically
today and diverge only if that changes.

---

#### Q2 — Free-tier daily message cap (decision #7, blocks Batch 8)

Spec §5.4 mandates a cap. The number is not specified.

| Option                                 | Consequence                                                                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **30 messages/day** _(Eng recommends)_ | Across all conversations. Enough for a few real exchanges; a heavy day hits the wall. Balanced.                                                                                                           |
| 50 messages/day                        | Rarely hit in normal use. The cap becomes anti-spam protection rather than a paywall lever; revenue leans on swipes and premium features instead.                                                         |
| 10 messages/day                        | Forces payment to hold any real conversation. High conversion pressure, high risk users conclude the app does not work.                                                                                   |
| Cap new conversations instead          | e.g. 5 new conversations/day, unlimited messages within them. Protects conversations already going, which is what users value. Deviates from the spec's wording; would be built as a separate quota type. |

---

#### Q3 — Is Rewind free or premium? (decision #10, blocks Batch 7)

Rewind reverses the last swipe in the current mode and restores the profile to
the deck (spec §5.3).

| Option                                                | Consequence                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Premium only**                                      | Category standard and a reliable upsell — an accidental pass becomes a concrete reason to subscribe at the moment of regret. Strongest on revenue. |
| Free, 1 per day _(Eng leans here on product grounds)_ | Covers the genuine mis-tap without giving the feature away, and teaches users it exists, which makes the premium version worth buying.             |
| Free and unlimited                                    | Best experience, no revenue, and it weakens the deck: a user can undo backwards indefinitely, making "already swiped" exclusions leaky.            |

---

#### Q4 — Should enabling Cuddle mode require verification? (decision #9, blocks Batch 5)

| Option                                                               | Consequence                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yes, required to enable** _(Eng recommends, and so does the spec)_ | §5.7 flags Cuddle as elevated risk: it invites physical-contact meetups and will attract misuse. Far easier to require from day one than to impose later on existing users. |
| Yes, but only to message                                             | Browse the deck unverified; verify before a match can become a conversation. Lower signup friction, protection at the point where risk actually begins.                     |
| No, treat it like any other mode                                     | Lowest friction and fastest growth in that mode. Accepts materially higher safety and moderation exposure, and a painful retrofit if incidents force the policy later.      |

---

## 2. Action log

Newest last. Every entry is something that changed the repository or the machine.

### 2026-08-13 — Specification review

- Read `KINVO_BACKEND_BUILD.md` in full. Produced the §9 first-action reply: mode-system restatement, pushback list, database answer, Batch 0 file plan.
- Raised 11 items of pushback. Acted on: Node 20 EOL, decision #5, decision #11. Recorded for later: block visibility, photo URL strategy, deck-vs-mutable-filters, match expiry side effects, user status model.
- **No code written.** Awaited approval per spec §0.1.

### 2026-08-13 — Batch 0: Foundation

- Created 40 files: TypeScript strict config with path aliases, ESLint 9 flat config, Prettier, Jest + ts-jest, `docker-compose.yml`, `.env.example`, `CLAUDE.md`, `README.md`.
- Built `src/`: env validation, error-code table, `ApiError`, response envelope, Pino logger with PII redaction, request-id and request-logger middleware, error handler, not-found handler, Zod validate middleware, health module, app assembly, server with graceful shutdown.
- Wrote 49 tests across 5 suites.
- **Verified:** `npm run typecheck` clean · `npm run lint` clean · `npm run format:check` clean · 49/49 tests passing · 96.71% line coverage against an 80% threshold · `npm run build` succeeds · compiled server boots and serves the envelope · `tsx` dev server boots and serves the envelope.
- Printed the §0.6 completion report. Stopped.

### 2026-08-13 — Environment verification

- Docker Desktop 29.7.2 installed by PO. `npm run db:up` pulled images and started both containers.
- **Verified:** `kinvo-postgres` healthy on host port 5433 · `kinvo-redis` healthy on host port 6380.
- **Verified:** PostgreSQL 16.4 · databases `kinvo_dev` and `kinvo_test` both present, confirming the init script ran · extensions available: `postgis` 3.4.3, `uuid-ossp` 1.1, `pg_trgm` 1.6 · Redis 7.4.10 responds to PING.
- **Verified PostGIS end to end:** ran a live `ST_DWithin` radius query. A 5 km radius around Westminster returned Westminster (0 m) and Camden (3,688 m) and correctly excluded Manchester. This is the exact query shape the Batch 7 deck builder depends on. Extension created in the throwaway `postgres` database and dropped afterwards, so the Batch 1 migration still does the real work.

### 2026-08-13 — Version control

- `git init -b main`. Default branch is `main`.
- **Verified before committing:** `.env` is ignored (`.gitignore:5`) and `node_modules/` is ignored (`.gitignore:1`). No secret or dependency directory is tracked.
- Initial commit: 41 files, Batch 0 foundation.
- Created this file.
- **Resolved:** remote `origin` set to `https://github.com/abubakr92/kinvo-backend.git` (supplied by PO). Repository was empty, so `main` pushed cleanly with no merge. Upstream tracking configured.
- **Verified after push:** no `.env`, `.pem`, `.key`, or credentials file appears in any commit in history. 44 files tracked.
- **Resolved:** `KINVO_BACKEND_BUILD.md` was missing from the repository. Eng deliberately did not transcribe it from the chat — a reconstructed specification could drift from the master in ways nobody would notice, and this document governs fifteen batches of work. Located the canonical copy at `C:\Users\hp\Downloads\KINVO_BACKEND_BUILD.md` and copied it into the repository root unmodified (39.1 KB, 556 lines, all ten sections present). Verified clean UTF-8 — the corruption seen when the document was pasted into chat was a paste artifact, and a second apparent corruption was PowerShell 5.1 misreading UTF-8-without-BOM as ANSI. `CLAUDE.md`'s reference to the specification now resolves.
- **Defect found in the specification, not fixed:** in §1, a stray blank line at line 109 splits the eight-mode table into a four-row table followed by four orphaned lines of literal pipe text. Content is intact — all eight modes are present and match what has been built. Cosmetic only; renders wrongly. Left for PO to correct, since this is the governing document.

---

### 2026-08-14 — Batch 1: Database schema

- Installed Prisma **7.9.1**. Prisma 7 differs from 5/6 in three ways that shaped this batch:
  1. The datasource URL moved out of `schema.prisma` into a root `prisma.config.ts`.
  2. The generator is `prisma-client` (TypeScript output) with a required `output` path — the client is emitted into the project tree, not `node_modules`. Placed at `src/generated/prisma` so the compiler's `rootDir` covers it; the first attempt at repository root broke `npm run build`.
  3. **The client no longer connects by URL.** A driver adapter is mandatory, so `@prisma/adapter-pg` was installed. Flagged because it is a real dependency the spec did not anticipate.
- Wrote `prisma/schema.prisma`: 48 models, 31 Postgres enums, indexes on every foreign key and every query path the spec names.
- Hand-wrote what Prisma cannot express at the foot of the migration: `CREATE EXTENSION postgis`, 4 GIST indexes, 12 CHECK constraints, 3 partial unique indexes.
- **Verified:** migration applies clean to an empty database · 50 tables · 31 enum types · PostGIS 3.4.3 · every GIST index, CHECK constraint, and partial unique index present in `pg_indexes` / `pg_constraint`.
- Seeded 43 interests, 13 prompt questions, 11 entitlement flags across 3 tiers, 6 subscription products with price versions, 20 venues, and 30 dev users. **Verified idempotent** by running the seed twice and confirming row counts did not double.
- **Verified:** 111 tests passing, 92.12% line coverage · `npm test` bootstraps a dropped-and-recreated `kinvo_test` from nothing · typecheck, lint, format, and build all clean.
- Two Windows-specific problems found and fixed in `tests/globalSetup.ts`: Node refuses to spawn `npx.cmd` without a shell (EINVAL, post-CVE-2024-27980), and passing args through a shell does not escape them (DEP0190). Resolved by running the Prisma CLI's JavaScript with `process.execPath`, which also works unchanged on Linux for CI.

### 2026-08-14 — Batch 2: Auth

- Twelve endpoints: register, login, refresh, logout, forgot/reset/change password, OTP send and verify, Google, Apple, and `GET /auth/me`.
- Middleware every later batch depends on: `authenticate`, `optionalAuth`, `requireOnboarded`, `requireRole`, plus Redis-backed rate limiting.
- Migration `20260813204346_nullable_date_of_birth`. **Prisma generated four `DROP INDEX` statements for the PostGIS GIST indexes** — exactly the fragility flagged in the Batch 1 report, arriving on the very next migration. Removed by hand; the migration now carries a warning block. The GIST assertion in `postgis.test.ts` is the backstop and would have caught it.
- **Verified:** 274 tests passing, 87.21% line and 86.56% function coverage · typecheck, lint, format, and build clean · seed still runs and is still idempotent · GIST indexes survived the migration.
- **Verified end to end against the running build**, not only through Supertest: login → `/auth/me` → refresh → replay rejected 401 → wrong password rejected 401.
- `jose` was installed, then removed: ESM-only, unloadable by the CommonJS test runner. `jwks-rsa` was tried next and failed identically because it depends on `jose`. Apple verification ended up needing no library at all.

### 2026-08-14 — Security audit of Batches 0–2

Requested by PO before starting Batch 3. Findings and fixes:

- **CRITICAL — account takeover via registration. Fixed.** Social sign-in records the user's verified address as an email identity with no password, so a later Google or Apple sign-in links rather than duplicating. `register` treated that empty password as an invitation to set one and returned tokens, so anyone who knew the address of a Google- or Apple-created account could take it over with no proof of mailbox ownership. Registration now always returns 409 for an existing address; the legitimate route to a first password is forgot-password, which requires mailbox control. A test had asserted the vulnerable behaviour and was rewritten. `tests/integration/auth/security.test.ts` now covers it.
- **HIGH — no rate limit on four public endpoints. Fixed.** `generalRateLimit` existed but was never mounted, so `/refresh`, `/reset-password`, `/google`, and `/apple` had no ceiling at all. `/google` and `/apple` make outbound calls to Google and Apple, so an unbounded endpoint let anyone spend our provider quota. Mounted `generalRateLimit` under the whole versioned router and added specific limiters for those four. `/health` is deliberately ahead of the limiter so load-balancer probes are never throttled.
- **MEDIUM — identical JWT secrets were accepted. Fixed.** If both keys matched, only the `type` claim separated a 30-minute token from a 60-day one. Env validation now refuses to start.
- **MEDIUM — wildcard CORS was accepted in production. Fixed.** Harmless while the only client is a mobile app, but the admin web console is coming. Env validation now refuses `*` in production.
- **LOW — tests could corrupt each other.** All suites share one database and truncate between tests; only `npm test`'s `--runInBand` prevented parallel workers wiping each other. `maxWorkers: 1` is now in the Jest config so a bare `npx jest` is safe too.

Verified clean, no change needed: no secrets in any commit; no `console.*` in `src/`; every response goes through the envelope; all raw SQL parameterised through tagged templates, with the one `$executeRawUnsafe` confined to test teardown over `pg_tables` names; PII redaction configured for authorization, cookie, password, token, email, and phone; request logger records `req.path` and never the query string; helmet emitting CSP, HSTS, nosniff, and frame-options.

Accepted risks, recorded rather than fixed:

- `forgot-password` returns the reset token in the response body outside production, so the flow is testable before email lands in Batch 11. **Staging must run `NODE_ENV=production`**, or reset tokens are exposed.
- `display_name` is stored verbatim, including markup. Correct for a Flutter client that renders text, but the admin web console must escape on output (Batch 15).
- `resetPassword` resolves the email identity with `findFirst`. Unambiguous today because the linking rules give a user at most one email identity; it would become ambiguous if that ever changes.
- **Account deletion does not scrub personal data.** `DELETE /users/me` soft-deletes, revokes every session, and removes the user from every read path, but email, phone, display name, and bio are retained in full. Reports, moderation history, and evidence retention all reference the user, and deciding what must survive an erasure request is a safety question Batch 12 answers. **This is a GDPR exposure until then** — recorded deliberately rather than discovered later, and it must be closed before real users exist.
- Refresh rotation is not transactional, so two simultaneous refreshes can both succeed and leave two live chains in one family. Replay detection still works; worth a row lock if it ever shows up in practice.

### 2026-08-14 — Batch 3: Users, profiles, onboarding

- Eleven endpoints: `GET /config`, profile read/update, location, interests, prompts, preview, public profile, account deletion, and the onboarding status/date-of-birth/complete trio. Added `GET /health/ready`.
- **Built the shared block exclusion clause now rather than in Batch 12.** `GET /users/:id` is the first endpoint that exposes another user, so deferring it would have shipped a leak for Batch 12 to remember to close. `src/modules/safety/block.service.ts` holds it; Batch 12 adds the block/unblock endpoints on top of a helper that is already enforced and tested.
- **`GET /config` landed here.** Spec §4.12 defines it but assigns it to no batch, and Batch 3 is the first that needs interest tags and prompt questions client-side. It serves the per-mode deck action labels, which is what keeps spec §1's "the mode only changes the label" true without an app release per mode.
- **Onboarding requirements are a declared checklist**, not scattered conditionals: display_name, date_of_birth (18+), bio, location, ≥1 interest. Batch 4 and 5 add one entry each.
- **Account deletion is a soft delete only.** Personal data is deliberately not scrubbed — see the accepted risk below.
- **Two production bugs found while fixing a hanging test.** `server.ts` never opened or closed its Postgres and Redis connections: a bad connection string became a 500 on a user's first request instead of a failure at deploy time, and shutdown severed in-flight queries and leaked pool connections. Now connects before accepting traffic and disconnects after the HTTP server drains.
- **Verified:** all Batch 3 suites green.

### 2026-08-20 — Batch 4: Media and verification

AWS access was delayed, so S3 runs locally as **MinIO** in docker-compose. This is not a stubbed storage layer: the application uses the real `@aws-sdk/client-s3`, issues real presigned URLs, and the buckets are genuinely private. Moving to AWS is a change of endpoint and credentials in `.env` with no code change.

- Two buckets, kept apart deliberately: `kinvo-media` for photos, chat media, and voice notes; `kinvo-verification` for government ID images and report evidence, with a much shorter presigned-URL lifetime (spec §7 Batch 4).
- Uploads are a two-step handshake — presign, client PUTs directly to storage, then the server HEADs the object and records what actually landed. An asset without `uploaded_at` may never be attached to anything.
- Migration `media_upload_ledger`: added `profile_photo` to the media kinds and `uploaded_at` to media assets. **Prisma emitted the four PostGIS `DROP INDEX` statements again** — the second occurrence, exactly as the previous migration's warning predicted. Removed by hand; the GIST assertion in `postgis.test.ts` remains the backstop.
- Migration `photo_reorder_staging_band`: the Batch 1 CHECK constraint allowed positions 0–5 only, which made reordering impossible. Reordering has to park photos at temporary positions inside one transaction, because the partial unique index on `(profile_id, position)` rejects any sequence passing through a duplicate. The CHECK now permits −6…5, where negatives exist only between the two phases of a single transaction.
- **Bug found by a test, not in review:** the first reorder attempt promoted the new first photo before demoting the old primary, tripping the one-primary-per-profile partial unique index. Phase one now clears every primary flag as well as parking positions.
- Broke a genuine import cycle: `profiles.service` needed photos for the primary photo URL while `photos.service` needed `ensureProfile`. Moved `ensureProfile` into `profiles/profile.repository.ts`. The cycle resolved at runtime under CommonJS, but only by accident of module ordering.
- Onboarding now requires at least one approved photo, and profile completion scores photos — both as planned in Batch 3. Because completion is normalised over whatever criteria exist, adding one re-weighted the rest automatically.
- Readiness (`/health/ready`) now probes storage alongside Postgres and Redis: with photos on every deck card, unreachable storage is as fatal as an unreachable database.

**`MEDIA_AUTO_APPROVE_UPLOADS` — a temporary switch, recorded so it is not forgotten.** spec §4.8 keeps pending media visible to its owner alone, but nothing moves a photo from pending to approved until the moderation pipeline lands in Batch 10. Without a switch, no uploaded photo would be visible to anyone and no deck card would ever render. It defaults on for development and staging and is **forced off in production** by env validation — the same shape as the Twilio dev stub. **Batch 10 must delete it.**

**Still open, unchanged:** whether profile photo URLs move to CDN signed URLs instead of expiring presigned GETs, and whether media bytes move to Cloudflare R2 (identical API, no egress charges — which matters most for a photo-heavy app). Presigned GETs are correct for now; both remain decisions for the deployment.

### 2026-08-25 — Deployment: AWS staging

- Live at **https://dm9o5kgscmnxv.cloudfront.net/api/v1**. Terraform in `infra/`, ~$18/month against $120 of credits, $60 budget alert at 85% and 100%.
- EC2 t3.small running the API, Postgres+PostGIS, Redis and Caddy in Docker. S3 replaces local MinIO. CloudFront supplies HTTPS on a `*.cloudfront.net` hostname, which satisfies iOS App Transport Security without a domain.
- **Six bugs found by running it, none visible to a passing test suite:**
  1. Prisma emitted ESM because `tsconfig.json` was copied after `prisma generate` — container died on boot, worked locally.
  2. `req.path` is router-relative, so every request logged as `/`.
  3. `postgis/postgis` publishes no arm64 image — crash-looped on Graviton. Switched to x86; architecture must agree in three places (instance type, AMI, Compose plugin).
  4. `set -x` traced the JWT keys and database password into `/var/log/cloud-init-output.log`. Secrets rotated, tracing disabled around the block.
  5. Caddy declared `depends_on: [api]`, so it could not start before the first image existed.
  6. Env validation demanded static S3 keys in production — on AWS the instance role supplies them, so the check mandated the worse practice.
- `infra/tfplan` was caught at `git add` — saved plans embed generated secrets in plaintext. Now git-ignored.
- Deploys build **on the instance**: source is 280KB over S3, versus an 877MB image push that timed out repeatedly on this uplink.

### 2026-08-26 — API documentation

- `/api/v1/docs` (Swagger UI) and `/api/v1/docs/openapi.json`.
- Request bodies generate from the same Zod schemas the endpoints validate with, so they cannot drift.
- `tests/integration/docs.test.ts` parses the route files and fails if any endpoint is undocumented or documented-but-nonexistent.
- Bug caught immediately: the document advertised `http://` because CloudFront sets `CloudFront-Forwarded-Proto`, not `X-Forwarded-Proto`. "Try it out" would have failed on first use.

### 2026-08-26 — Batch 5: Modes and settings

- 12 endpoints: modes (list, get, configure, primary), settings (get, update, snooze, resume), devices (list, revoke, revoke others).
- Migration `user_settings` plus a CHECK bounding text scale to 0.8–2.0. **Prisma tried to drop the four PostGIS GIST indexes for the third time.**
- Per-mode preference validation: one Zod schema per mode, `.strict()`, so `pet_type` on `dating` is rejected rather than stored where it would become a filter matching nobody.
- **Security bug found by its own test: "revoke device" did not revoke.** The Device row recorded the id from the header or body; the refresh token recorded only the body. Signing in with `X-Device-Id` made them disagree, so the revoke matched no tokens, returned 200, and left the session alive. One resolved id now flows to both.

### 2026-08-26 — Batch 6: Entitlements

- `GET /me/entitlements` returns the whole plan in one call: every flag, every quota with what is left of it, the tier, and whether an upgrade exists. The app renders paywalls and remaining-swipe counters from this rather than inferring them from 403s and 422s.
- `EntitlementService.resolve` / `hasFeature` / `getLimit` / `requireFeature`; `requireEntitlement(flag)` middleware.
- Redis quota counters keyed `quota:{name}:{user}:{utc-day}`, TTL to the next UTC midnight, so yesterday expires on its own and no sweeper job is needed.
- **Found a false green in my own new tests.** The endpoint suite passed while Redis was never connected: `readCount` swallows connection errors and reports zero used, which is indistinguishable from a fresh counter. The suite proved nothing. Redis is now connected explicitly in `beforeAll`, and the helper documents why skipping it does not fail loudly.
- Avoided a second trap: `jest.useFakeTimers()` around a live Redis call deadlocks, because ioredis drives its command queue on real timers. The UTC-day test writes yesterday’s key directly instead.
- Batch 5’s duplicate matrix read in `modes.service` deleted.

### 2026-08-26 — Batch 7: Discovery and matching

- 6 endpoints: deck, swipe, rewind, likes-you, boost, stats — all mode-scoped through a path parameter, so no request can reach a service without a mode.
- The deck builder applies six rules at once: the shared block clause, radius, age window, mode-enabled, already-swiped-in-this-mode, and account state. Each has its own test rather than one composite assertion.
- BullMQ added: queue, worker, and a UTC-midnight scheduler. Jobs never start under test.
- **Bug found by its own test: the likes-you filter was inverted.** It excluded actors whose `swipes_made` included a swipe at the viewer — which is the very like being listed, so every admirer silently excluded themselves and the premium inbox was always empty. The correct question is whether the actor RECEIVED a swipe from the viewer. Five tests caught it.
- **Bug found while writing the worker:** the scheduler fans out on the queue it feeds, so the repeatable job arrived with empty data and the worker tried to build a deck for an undefined user. The worker now branches on job name.
- Cursor pagination added (`@utils/cursor`), first used here and reused by matches, messages, and notifications from Batch 8.

### 2026-08-26 — Batch 8: Matches and chat REST

- 11 endpoints: matches (list, detail, unmatch, extend) and conversations (list, detail, messages, send, read, archive/mute, unread-count).
- **Messages paginate BACKWARDS** — the only list in the API that does. A chat opens at the bottom, so the first page is the newest and the cursor walks into history.
- The three Connections tabs are split across two modules by design: Matches and Archived are `GET /matches`; Requests is `GET /discovery/{mode}/likes-you` from Batch 7, because Requests holds profiles who liked you, not conversations (decision #5).
- Media messages go through `claimAsset`, so a verification document cannot be promoted into a chat image. Tested directly.
- Every closed-conversation reason answers one identical 403. A test asserts the blocker and blocked sides receive the same status, code, and message.
- Match expiry sweep added to the daily job — bookkeeping only, since expiry is decided at read time.

### 2026-08-26 — Batch 9: Realtime

- Socket.IO on the same HTTP server. JWT handshake, per-user rooms, message delivery, typing, read receipts, presence, plan updates.
- The contract is published at `GET /docs/realtime.json`, generated from the Zod schemas the server validates with. A drift test fails the build if an event is added without a documented shape.
- `is_online` in `user_compact` became real. It was hardcoded false since Batch 3 — a lie in a shipped contract.

**Four bugs found by the tests, three of them real production defects:**

- **Handlers were registered after several awaits in `onConnection`.** Socket.IO drops a packet with no listener, so a client that emits the moment it connects — exactly what a chat app does when reopening a thread — silently lost the event. Three tests failed on this one cause. Handlers now register before any await.
- **A short-lived connection left a phantom "online" entry.** `markOnline` could land after `markOffline` when a socket opened and closed within milliseconds, leaving the user online until the TTL lapsed. The disconnect handler now waits for the connect sequence before undoing it.
- **Every expired token read as INVALID.** The handshake caught `TokenExpiredError`, but `verifyAccessToken` had already mapped it to an `ApiError` — so the catch never matched. The app signs the user out on INVALID and refreshes on EXPIRED, so this turned every routine 30-minute expiry into a forced sign-out. Now reuses the existing mapping instead of repeating it.
- Typing indicators depended on a room join the sender could not observe; switched to addressing the other participant directly.

### 2026-08-26 — Batch 10: Moderation

- 3 endpoints: `POST /moderation/check` (pre-send, advisory), `GET /moderation/flags` and `PATCH /moderation/flags/{id}` (the moderation queue, moderator/admin only).
- Rules-based provider with 15 rules across 7 categories: scam/payment, contact info, sexual content, hate speech, threats, self-harm, minor safety.
- Post-hoc scanning wired into message send and photo upload. The pre-send check is offered, never required — what was actually sent is scanned regardless of whether the client called it.
- **`MEDIA_AUTO_APPROVE_UPLOADS` is gone**, closing the debt recorded in 1.2c. Photos now go live and are queued for human review.
- Evasion handling split in two after a test caught the first attempt merging adjacent obfuscated words: `normalise()` rejoins letters split by punctuation only, and `compact()` strips everything for a short list of high-value terms. Collapsing spaces in `normalise` turned "w-a-l-l-e-t a-d-d-r-e-s-s" into one word and stopped it matching the phrase it plainly is.
- Ten "ordinary message" cases assert the rules do NOT fire. A warning users learn to dismiss reflexively protects nobody, so the false-positive tests carry as much weight as the true positives.

## 3. Batch plan and dependencies

Status: ✅ done · ▶ current · ⬜ not started

| Batch | Name                        | Status | Needs installed / provisioned                                | Blocked by decisions           |
| ----- | --------------------------- | ------ | ------------------------------------------------------------ | ------------------------------ |
| 0     | Foundation                  | ✅     | Node 24, npm                                                 | —                              |
| 1     | Database schema             | ✅     | **Docker** (Postgres + PostGIS, Redis)                       | — (#2/#3 seeded provisionally) |
| 2     | Auth                        | ✅     | Docker. Twilio Verify (mocked in tests)                      | —                              |
| 3     | Users, profiles, onboarding | ✅     | Docker                                                       | —                              |
| **—** | **Deployment interlude**    | ✅     | **AWS account + IAM user, AWS CLI, Terraform, domain name**  | —                              |
| 4     | Media and verification      | ✅     | **AWS S3 buckets (real)**                                    | Photo URL strategy; R2 vs S3   |
| 5     | Modes and settings          | ✅     | Docker                                                       | **#9** answered                |
| 6     | Entitlements (stub)         | ✅     | Redis                                                        | —                              |
| 7     | Discovery and matching      | ✅     | Redis + BullMQ                                               | #6, #7, #10 — see **1.2e**     |
| 8     | Matches and chat REST       | ✅     | Docker                                                       | #7; block visibility           |
| 9     | Realtime                    | ✅     | Redis. **Host must support WebSockets**                      | —                              |
| 10    | Moderation                  | ✅     | Moderation provider account                                  | **#8**                         |
| 11    | Notifications               | ▶      | **Firebase project + service account, SMTP credentials**     | —                              |
| 12    | Safety, plans, venues       | ⬜     | S3 (report evidence)                                         | Block visibility               |
| 13    | Subscriptions               | ⬜     | **Apple Developer + App Store Connect, Google Play Console** | **#2, #3, #14**, RevenueCat    |
| 14    | Video calling               | ⬜     | **Twilio Video credentials**                                 | —                              |
| 15    | Admin, docs, hardening      | ⬜     | —                                                            | **#12**                        |

### 3.1 Tooling timeline

Install nothing before it is needed. Unused tools rot.

| Tool            | Needed at            | Status                    |
| --------------- | -------------------- | ------------------------- |
| Node.js 24, npm | Batch 0              | ✅ v24.18.0 / npm 11.16.0 |
| Git             | Batch 1              | ✅ installed              |
| Docker Desktop  | Batch 1              | ✅ v29.7.2, verified      |
| AWS CLI         | Deployment interlude | ⬜ not installed          |
| Terraform       | Deployment interlude | ⬜ not installed          |

### 3.2 External accounts the PO must provide

Each one gates the batch beside it. Lead time matters — Apple Developer enrolment in particular is not same-day.

| Account                             | Needed for   | Status         |
| ----------------------------------- | ------------ | -------------- |
| AWS IAM user (not root) + MFA       | Interlude    | PO in progress |
| Domain name                         | Interlude    | ⬜             |
| Twilio (Verify)                     | Batch 2 live | ⬜             |
| Firebase (Cloud Messaging)          | Batch 11     | ⬜             |
| SMTP provider                       | Batch 11     | ⬜             |
| Apple Developer / App Store Connect | Batch 13     | ⬜             |
| Google Play Console                 | Batch 13     | ⬜             |
| Twilio Video                        | Batch 14     | ⬜             |

---

## 4. Deployment plan

Runs between Batch 3 and Batch 4. Target: the mobile team gets a working staging URL.

**PO does** — everything requiring a browser sign-in:

1. Enable MFA on the AWS root account. Create IAM user `kinvo-deploy` with scoped permissions. Stop using root.
2. Set a billing alert so a misconfiguration cannot become a silent five-figure bill.
3. Buy the domain.
4. Run `aws configure` locally. **The keys are never pasted into a chat.**

**Eng does:**

5. Install AWS CLI and Terraform.
6. Write the production `Dockerfile` (packages the API — distinct from `docker-compose.yml`, which is local-only and never runs on a server).
7. Write Terraform: VPC, security groups, EC2, RDS Postgres with PostGIS, ElastiCache Redis, S3 buckets, Route 53. **RDS and Redis on the private network only, never publicly reachable.**
8. Caddy config for automatic TLS. HTTPS is mandatory — iOS App Transport Security blocks plain HTTP, and the resulting failure looks like an API bug.
9. `terraform plan`, reviewed with PO, then `terraform apply` on PO's explicit go-ahead.
10. Run migrations against staging RDS. Smoke test.
11. Hand the mobile team a base URL, the docs URL, and seeded test accounts. They receive **staging, never production**.

**Two environments**, staging and production, from identical Terraform with different variables.

---

### 4.1 Deployment traps

- **`deploy.sh` must be passed the image tag docker-compose references**, which is the ECR URI `<account>.dkr.ecr.us-east-1.amazonaws.com/kinvo-staging-api:latest` — not a convenient local name like `kinvo-api:latest`. Passing the wrong tag builds a fresh image that nothing runs: the script reports success, the health check passes against the OLD container, and the deploy looks clean while changing nothing. Caught on the Batch 6 deploy when `/me/entitlements` still 404ed after a "successful" run.
- **The AWS CLI cannot print Docker build output on Windows.** BuildKit draws box characters (U+2502) and the CLI dies with a `charmap` codec error, hiding the entire result. Redirect the deploy to a file on the instance and read it back through `tr -cd "[:print:][:space:]"`.

## 5. Standing engineering decisions

Choices made while building that the specification did not dictate. Recorded so they are not silently reversed.

| Area              | Decision                                                                                                     | Why                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Health endpoint   | `/health` is pure liveness and checks no dependency. Mounted at both `/health` and `/api/v1/health`.         | A liveness probe that fails on a database blip makes the orchestrator kill healthy processes. Readiness gets its own endpoint in Batch 1. |
| Error codes       | Malformed JSON → `400 BAD_REQUEST`. Oversized body → `413 FILE_TOO_LARGE`.                                   | Spec §4.4 names no code for either. Reused existing codes rather than inventing new ones.                                                 |
| Lint              | ESLint 9 flat config (`eslint.config.mjs`), `typescript-eslint` recommended (not type-checked).              | ESLint 9 requires flat config. Type-checked linting is materially slower for marginal benefit here.                                       |
| Jest config       | `jest.config.js`, not `.ts`.                                                                                 | A TypeScript Jest config requires `ts-node` purely to load itself.                                                                        |
| Coverage          | Excludes `src/server.ts`, `src/config/**`, `src/types/**`.                                                   | Spec §0.4 excludes config. `server.ts` cannot run without binding a port; excluded rather than faked.                                     |
| Query validation  | `validate()` redefines `req.query` via `Object.defineProperty`.                                              | Express 4 exposes `query` as a getter-only accessor; plain assignment throws under strict mode.                                           |
| Logging           | Logs `req.path`, never `req.originalUrl`. Redacts authorization, cookie, password, token, email, phone.      | Query strings carry emails and password-reset tokens. Spec §15: no PII in logs.                                                           |
| Docker ports      | Postgres on host 5433, Redis on 6380.                                                                        | Cannot collide with a locally installed Postgres or Redis.                                                                                |
| PostGIS extension | Created by the first Prisma migration, not by the Docker init script.                                        | So it travels with the schema to CI and production instead of existing only on developer machines.                                        |
| Environment vars  | Only the 8 in use are validated. Later-batch credentials are documented but commented out in `.env.example`. | The server must not demand secrets for services it has no code to call.                                                                   |
