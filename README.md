# Kinvo Backend

REST API for Kinvo, a multi-mode social connection app. Clients are a Flutter mobile app and a future admin web console.

- **Product specification:** `KINVO_BACKEND_BUILD.md` — the source of truth for behaviour.
- **Working conventions:** `CLAUDE.md` — stack, layout, house rules, batch process.

## Requirements

- Node.js **24** (`.nvmrc`)
- Docker Desktop — Postgres 16 + PostGIS and Redis run in containers

## Setup

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run db:up             # postgres on :5433, redis on :6380
npm run dev
```

Verify:

```bash
curl http://localhost:3000/api/v1/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "api_version": "v1",
    "environment": "development",
    "uptime_seconds": 3,
    "checked_at": "2026-08-13T09:41:00.000Z"
  },
  "meta": null
}
```

`/health` is also served unversioned at `/health` for container and load-balancer probes.

## Scripts

| Command                     | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `npm run dev`               | Watch mode via tsx                         |
| `npm run build`             | Compile to `dist/`, rewriting path aliases |
| `npm start`                 | Run the compiled build                     |
| `npm test`                  | Jest suite                                 |
| `npm run test:coverage`     | Coverage with the 80% threshold enforced   |
| `npm run typecheck`         | `tsc --noEmit`                             |
| `npm run lint` / `lint:fix` | ESLint                                     |
| `npm run format`            | Prettier                                   |
| `npm run db:up` / `db:down` | Start / stop Postgres and Redis            |

## Configuration

Every variable is documented in `.env.example` and validated by `src/config/env.ts` at boot. A missing or malformed required variable **exits the process** rather than starting half-configured.

## Notes

- The API is versioned at `/api/v1`.
- Docker publishes Postgres on **5433** and Redis on **6380** to avoid colliding with local installs. A `kinvo_test` database is created on first container start for the test suite.
- Batch 0 has no database access, so `npm test` runs without Docker. From Batch 1 onward, tests require `npm run db:up`.
