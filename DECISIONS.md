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

### 1.3 Still open — must be answered before the batch listed

| #   | Question                                                                                                   | Blocks batch   | Notes                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Should enabling Cuddle mode require verification?                                                          | 5              | Spec §5.7 flags Cuddle as elevated risk and recommends yes.                                                                                                                  |
| 6   | Match expiry TTL — how many days? **And what expiry does to the conversation.**                            | 7              | The spec asks only for the number. Eng flagged the missing half: does the conversation go read-only, vanish, or move to Archived? Does a new message reset the clock?        |
| 7   | Free-tier daily swipe cap and message cap — numbers?                                                       | 7, 8           | Counter resets at UTC midnight (spec §5.3).                                                                                                                                  |
| 10  | Is Rewind free or premium?                                                                                 | 7              |                                                                                                                                                                              |
| —   | **Block visibility:** does a blocked pair's conversation stay visible read-only, or disappear entirely?    | 8, 12          | Spec §5.5 says read-only; spec §4.4 says return 404 so a block is not confirmed. These contradict. Eng recommends: conversation visible and frozen, 404 on every other path. |
| 8   | Moderation provider for "review before you send" — OpenAI, AWS Comprehend, Perspective, or rules-based v1? | 10             | Must fail open on timeout (spec §5.4).                                                                                                                                       |
| —   | **Profile photo URLs:** CDN signed URLs vs expiring S3 presigned GETs.                                     | 4              | Presigned GETs expire and are unique per request, so Flutter's image cache misses on every render. Eng recommends CDN for photos, short presigned GETs for ID documents.     |
| —   | **Cloudflare R2 instead of S3** for media bytes?                                                           | 4              | Identical API, no egress charges. For a photo-heavy app, egress is the fastest-growing line on the bill. Same SDK code, different endpoint.                                  |
| 2   | Basic vs Advanced Premium — which features in which tier?                                                  | 13 (seed at 1) | Batch 1 seeds a **provisional** matrix with documented defaults. Because the matrix is data, filling these in later is a seed change, never a code change.                   |
| 3   | Pricing shape — six SKUs (tier × cycle) or two?                                                            | 13             | Every SKU must be created in App Store Connect and Play Console. Store-set pricing means the spec's yearly-increase automation cannot work as written.                       |
| 14  | Ship the US Stripe link-out in v1, or IAP only?                                                            | 13             | Eng recommends IAP-only for v1: always compliant, no region gating, and the US carve-out is under Supreme Court review.                                                      |
| —   | RevenueCat as an abstraction over Apple and Google receipt validation?                                     | 13             | Spec §2 asks for this to be raised rather than adopted unilaterally.                                                                                                         |
| 12  | Admin analytics — which metrics exactly?                                                                   | 15             |                                                                                                                                                                              |

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
- **Outstanding:** the git remote is not configured — awaiting the repository URL from PO.
- **Resolved:** `KINVO_BACKEND_BUILD.md` was missing from the repository. Eng deliberately did not transcribe it from the chat — a reconstructed specification could drift from the master in ways nobody would notice, and this document governs fifteen batches of work. Located the canonical copy at `C:\Users\hp\Downloads\KINVO_BACKEND_BUILD.md` and copied it into the repository root unmodified (39.1 KB, 556 lines, all ten sections present). Verified clean UTF-8 — the corruption seen when the document was pasted into chat was a paste artifact, and a second apparent corruption was PowerShell 5.1 misreading UTF-8-without-BOM as ANSI. `CLAUDE.md`'s reference to the specification now resolves.
- **Defect found in the specification, not fixed:** in §1, a stray blank line at line 109 splits the eight-mode table into a four-row table followed by four orphaned lines of literal pipe text. Content is intact — all eight modes are present and match what has been built. Cosmetic only; renders wrongly. Left for PO to correct, since this is the governing document.

---

## 3. Batch plan and dependencies

Status: ✅ done · ▶ current · ⬜ not started

| Batch | Name                        | Status | Needs installed / provisioned                                | Blocked by decisions           |
| ----- | --------------------------- | ------ | ------------------------------------------------------------ | ------------------------------ |
| 0     | Foundation                  | ✅     | Node 24, npm                                                 | —                              |
| 1     | Database schema             | ▶      | **Docker** (Postgres + PostGIS, Redis)                       | — (#2/#3 seeded provisionally) |
| 2     | Auth                        | ⬜     | Docker. Twilio Verify (mocked in tests)                      | —                              |
| 3     | Users, profiles, onboarding | ⬜     | Docker                                                       | —                              |
| **—** | **Deployment interlude**    | ⬜     | **AWS account + IAM user, AWS CLI, Terraform, domain name**  | —                              |
| 4     | Media and verification      | ⬜     | **AWS S3 buckets (real)**                                    | Photo URL strategy; R2 vs S3   |
| 5     | Modes and settings          | ⬜     | Docker                                                       | **#9**                         |
| 6     | Entitlements (stub)         | ⬜     | Redis                                                        | —                              |
| 7     | Discovery and matching      | ⬜     | Redis + BullMQ                                               | **#6, #7, #10**                |
| 8     | Matches and chat REST       | ⬜     | Docker                                                       | #7; block visibility           |
| 9     | Realtime                    | ⬜     | Redis. **Host must support WebSockets**                      | —                              |
| 10    | Moderation                  | ⬜     | Moderation provider account                                  | **#8**                         |
| 11    | Notifications               | ⬜     | **Firebase project + service account, SMTP credentials**     | —                              |
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
