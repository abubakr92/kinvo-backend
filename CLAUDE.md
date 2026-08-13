# CLAUDE.md — Kinvo Backend

Working notes for anyone (human or agent) touching this repository.
The authoritative product specification is `KINVO_BACKEND_BUILD.md`. **Read it before changing behaviour.** This file is the operational summary, not a replacement.

---

## What this is

REST API for **Kinvo**, a multi-mode social connection app. Clients: a Flutter mobile app, and a future admin web client. **APIs only** — no web frontend, no server-rendered views.

---

## The core architectural rule: mode scoping

Kinvo is not one social graph with a mode tag bolted on. It is **eight parallel graphs** sharing one user table, one media store, one billing account, and one moderation pipeline.

The eight modes: `dating`, `study_buddy`, `networking`, `trading`, `foodie`, `cuddle`, `pet_dates`, `fitness`.

- Swipes are unique on `(actor_id, target_id, mode)`. The same pair may like in one mode and pass in another.
- A match belongs to **exactly one** mode. Two users can hold several simultaneous matches in different modes.
- A conversation inherits its match's mode and never changes it.
- Discovery preferences are stored **per mode** (`UserMode`), not once per user.
- Decks are built per `(user, mode, day)`.
- Deck actions are always `pass` | `like` | `super_like`. Mode changes only the **label the app renders** — served from `GET /config`. Never create per-mode action enums.

**Trading is an interest category and nothing else.** No endpoint moves money or assets between users, records a trade, or serves market data. Its one asymmetry: scam/payment-language moderation checks must be globally scoped, not dating-scoped, because this mode attracts investment fraud.

---

## Stack

| Concern    | Choice                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Runtime    | **Node.js 24** (spec said 20 LTS; 20 reached end-of-life April 2026 — changed with the product owner's approval) |
| Language   | TypeScript, strict                                                                                               |
| Framework  | Express 4                                                                                                        |
| Database   | PostgreSQL 16 + PostGIS                                                                                          |
| ORM        | Prisma                                                                                                           |
| Validation | Zod                                                                                                              |
| Auth       | JWT access + refresh, `jsonwebtoken` + `argon2`                                                                  |
| Realtime   | Socket.IO                                                                                                        |
| Media      | AWS S3, presigned URLs                                                                                           |
| Push       | Firebase Cloud Messaging                                                                                         |
| SMS / OTP  | Twilio Verify                                                                                                    |
| Video      | Twilio Video, behind a `VideoProvider` interface                                                                 |
| Payments   | Apple StoreKit 2 + Google Play Billing (primary), Stripe (US web link-out)                                       |
| Jobs       | BullMQ + Redis                                                                                                   |
| Logging    | Pino                                                                                                             |
| Testing    | Jest + Supertest against a real Postgres                                                                         |

Do not substitute a library without asking.

---

## Commands

```bash
npm install
cp .env.example .env

npm run db:up          # docker compose up -d  (postgres + redis)
npm run dev            # tsx watch, hot reload
npm run build          # tsc -> dist, path aliases rewritten by tsc-alias
npm start              # run the build

npm test               # jest
npm run test:coverage  # with the 80% threshold enforced
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (flat config)
npm run format         # prettier --write
```

Docker exposes Postgres on **5433** and Redis on **6380** so they never collide with local installs.

---

## Layout

```
src/
  config/     env loading + validation, constants
  db/         prisma client, seeds                    (Batch 1)
  middleware/ auth, error handler, rate limit, validation
  modules/    one folder per domain module
    <module>/<module>.routes|controller|service|schema|types.ts
  realtime/   Socket.IO server, namespaces, handlers  (Batch 9)
  jobs/       BullMQ queues, workers, schedulers      (Batch 7+)
  providers/  external service adapters               (Batch 4+)
  types/      ambient type augmentation
  utils/      shared helpers
  routes.ts   versioned router assembly
  app.ts      express app assembly (exported without listening)
  server.ts   entry point: listen + graceful shutdown
```

Module folders: `auth`, `users`, `profiles`, `media`, `modes`, `settings`, `discovery`, `matches`, `chat`, `moderation`, `notifications`, `safety`, `plans`, `venues`, `subscriptions`, `calls`, `admin`, plus `entitlements` and `health`.

Path aliases: `@/*`, `@config/*`, `@middleware/*`, `@modules/*`, `@utils/*`. Declared in `tsconfig.json` and mirrored in `jest.config.js` — **change both together.**

---

## Non-negotiable conventions

**Layering.** Routes call controllers, controllers call services, services own business logic and touch the database. No business logic in a route handler. No database access from a controller.

**Validation.** Every endpoint validates with Zod via the `validate` middleware before business logic runs.

**Envelope (spec 4.2).** Every response goes through `src/utils/response.ts`. Never `res.json()` directly.

```jsonc
{ "success": true,  "data": {}, "meta": null }
{ "success": true,  "data": [], "meta": { "pagination": { "next_cursor": "…", "has_more": true, "limit": 20 } } }
{ "success": false, "error": { "code": "AUTH_TOKEN_EXPIRED", "message": "…", "details": null } }
```

`data` is always an object or array — wrap scalars as `{ "count": 4 }`. `message` is user-displayable. `code` is a stable machine contract; **renaming a shipped code is a breaking change.**

**Error codes.** Only from `src/utils/error-codes.ts`. Throw `ApiError`; never hand-roll an error response.

**Data formats (spec 4.6).**

- Timestamps: UTC ISO-8601 with `Z`, field names end in `_at`.
- Dates: `YYYY-MM-DD` (date of birth only — store DOB, never an age integer).
- IDs: UUID v4 strings. Never sequential integers.
- JSON fields: `snake_case`.
- Enums: lowercase snake_case strings, never integers.
- Money: integer minor units plus currency.
- **Distance: metres.** The client formats to miles.
- Null vs absent: return `null`, never omit the key. Empty lists are `[]`.

**Pagination.** Cursor-based (opaque base64) for decks, matches, messages, notifications. Messages paginate backwards. Offset pagination is acceptable on admin lists only.

**Auth.** Bearer tokens in the `Authorization` header, returned in the response body — not cookies. Access 30 min, refresh 60 days, rotated on every use. A replayed refresh token revokes the whole family. Keep `AUTH_REQUIRED`, `AUTH_TOKEN_EXPIRED`, and `AUTH_TOKEN_INVALID` distinct — the app does something different for each.

**Quota vs rate limit.** Infrastructure protection → `429 RATE_LIMITED`. Business limits that sell subscriptions → `422 QUOTA_EXCEEDED` with paywall context. Conflating them hides the paywall and costs revenue.

**Blocks (spec 5.5).** Blocks beat everything. Enforce via a **single shared exclusion clause** reused by every query — never re-implemented per endpoint. Return `404`, not `403`, when a block is the reason; a 403 confirms the resource exists.

**Reporter anonymity (spec 5.7).** A reported user must never learn who reported them through any endpoint, notification, or error message.

**Logging.** Pino only — `no-console` is an ESLint error. No PII in logs; redaction lives in `src/utils/logger.ts`. Log `req.path`, never `req.originalUrl`.

**Secrets.** Environment only, validated at boot. Never in code.

**Comments.** Explain _why_, not _what_. Business rules from the spec cite their section number.

---

## How work is sequenced

15 batches, defined in `KINVO_BACKEND_BUILD.md` §7. Rules:

1. One batch at a time, in order.
2. State the goal and the file list, then wait for confirmation before writing code.
3. Finish the batch — code, tests, docs.
4. Full test suite green.
5. Print the §0.6 completion report.
6. **Stop.** Do not start the next batch unbidden.

When blocked, ask. Do not invent a business rule and bury it in code.

**Tests are not optional.** Integration tests per endpoint covering happy path, validation failure, auth failure, and the permission boundary (can user A touch user B's resource?). Unit tests for pure logic. Real Postgres, mocks only for external HTTP. 80% line coverage on `src/` excluding config. Tests seed and clean their own data and run in any order.

---

## Decisions already made — do not re-ask

| #   | Decision                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Database:** PostgreSQL + PostGIS. S3 for media bytes only — never application records.                                                                  |
| 4   | **Trading mode:** interest category only, no trading functionality.                                                                                       |
| 13  | **Payment rails:** Apple IAP + Google Play Billing primary; Stripe as an optional US-only link-out.                                                       |
| 5   | **"Requests" tab:** a **likes-you inbox** — profiles, not messages. Users cannot message before matching, so a conversation always has a match behind it. |
| 11  | **Study Buddy groups:** one-to-one only in v1. Every conversation has exactly two participants.                                                           |
| —   | **Runtime:** Node 24 instead of the spec's EOL Node 20.                                                                                                   |

## Still open — ask before the batch that needs them

| #   | Question                                                                                | Blocks |
| --- | --------------------------------------------------------------------------------------- | ------ |
| 2   | Basic vs Advanced Premium — which features in which tier?                               | 13     |
| 3   | Pricing shape — six SKUs or two?                                                        | 13     |
| 6   | Match expiry TTL, and what expiry does to the conversation                              | 7      |
| 7   | Free-tier daily swipe cap and message cap                                               | 7, 8   |
| 8   | Moderation provider for "review before you send"                                        | 9      |
| 9   | Should enabling Cuddle mode require verification?                                       | 5      |
| 10  | Is Rewind free or premium?                                                              | 7      |
| 12  | Admin analytics — which metrics?                                                        | 15     |
| 14  | Ship the US Stripe link-out in v1, or IAP only?                                         | 13     |
| —   | Block visibility: does a blocked pair's conversation stay visible read-only, or vanish? | 8, 12  |
| —   | Profile photo URLs: CDN signed URLs vs expiring S3 presigned GETs                       | 4      |

---

## Trap checklist — run at the end of every batch

1. Does every new query filter by **mode** where it should?
2. Does every new endpoint use the shared **block** exclusion clause?
3. Timestamps UTC, ISO-8601, `Z`, `_at` suffix?
4. Distances in **metres**?
5. Enums as strings, not integers?
6. Do list endpoints return compact objects, or force **N+1** follow-up calls?
7. Quota returns **422 with paywall context**, not 429?
8. **404 instead of 403** where a block is the reason?
9. Can a reported user learn who reported them through any path?
10. Envelope on **everything** — errors and empty lists included?
