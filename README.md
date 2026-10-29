# SM Live — boilerplate monorepo

Live streaming + voice chat + games platform with Admin Control Panel.
**Virtual coins only** — a mock game provider stands in for a real one and
`real_money_enabled` defaults to `false` on every market.

## Quick start (5 minutes)

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis livekit
pnpm db:migrate && pnpm db:seed
pnpm dev:all        # api :4001 · admin :5173 · provider-mock :4100
```

Then open http://localhost:5173 (admin) and log in.

## What runs where

| service | dev url | notes |
|---|---|---|
| api (Fastify) | http://localhost:4001 | REST + Socket.IO + BullMQ workers; `GET /health`, `GET /metrics` |
| admin (React) | http://localhost:5173 | 11 pages, RBAC-aware; docker: :8081 |
| provider-mock | http://localhost:4100 | fake game provider with test buttons |
| mobile (Expo) | `pnpm dev:mobile` | config-driven; LiveKit needs a dev build (`expo run:ios/android`) |
| postgres | localhost:5433 | user/pass/db: sm_live / sm_live / sm_live |
| redis | localhost:6380 | config cache, rate limits, BullMQ |
| livekit | ws://localhost:7880 | devkey / devsecret_that_is_at_least_16_chars |

## Default logins (after seed)

| role | credentials |
|---|---|
| super admin | `superadmin` / `SuperAdmin123!` |
| read-only viewer | `viewer` / `Viewer123!` (sees no write buttons) |
| player (×20) | `+880170000001` … `+880170000020` / `User123!` |
| game provider key | `mockcorp-key-1` / secret `mockcorp-secret-please-rotate` |

## Verify it works

```bash
pnpm test          # 22 api unit/integration tests (ledger, wallet, webhook sig, RBAC)
pnpm -F @sm-live/mobile test   # 8 mobile unit tests
pnpm test:flow     # register → recharge → launch → bet → win → refund → duplicate → assert
pnpm loadtest      # 200 concurrent bets + 50 duplicate replays, no double debit, sums == balances
pnpm -F @sm-live/admin exec playwright test   # admin smoke (login + 3 pages + viewer RBAC)
```

## Stack

- pnpm workspaces, TypeScript strict everywhere
- apps/api — Fastify 5, Prisma 6, PostgreSQL, Redis, BullMQ, Socket.IO, Zod, pino
- apps/admin — React 18, Vite, Tailwind, React Router, TanStack Query, Recharts
- apps/mobile — Expo (Expo Router), LiveKit React Native SDK, one codebase for iOS/Android
- apps/provider-mock — behaves like a real game provider (HMAC-signed calls, RTP RNG)
- packages/shared — Zod schemas, types, constants
- infra — docker-compose (dev + prod overlay), backup/restore scripts, CI

## Key design points

- **Everything dynamic**: games, bet limits, feature flags, gift catalog, country
  filters, agency commission, roles/permissions, branding (name, logo, colours,
  bottom tabs) live in the database, edited in the admin panel, delivered by
  `GET /v1/config/app` with Redis caching + invalidation. No hard-coded business values.
- **One ledger** for every coin movement: immutable rows, unique `txKey`
  idempotency, `SELECT … FOR UPDATE` row locking, no negative balances,
  `balanceAfter` on every row; `GET /v1/admin/wallet/integrity` asserts it.
- **RBAC** on every admin endpoint (super_admin, security_admin, finance,
  support, agency_admin + editable permission matrix), every admin write audited.
- **Provider API**: HMAC-SHA256 over `METHOD|path|timestamp|sha256(body)` with
  ±300s window + IP allow list; retry-safe webhooks; stuck-round recovery job.
- Ports 5433/6380/4001/4100 avoid clashes with local services on this machine
  (native postgres/redis on 5432/6379, k8s on 4000).

Docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [API + provider signature scheme](docs/API.md) ·
[RUNBOOK (VPS deploy, backups, rollback)](docs/RUNBOOK.md) ·
[CHECKLIST modules A–H](docs/CHECKLIST.md)

> The mock provider stands in for a real one. Before any real money is involved,
> swap in the licensed provider's API and have a lawyer confirm the games are
> lawful in each target market.
