# SM Live — boilerplate monorepo

Live streaming + voice chat + games platform with Admin Control Panel.
**Virtual coins only** — a mock game provider stands in for a real one and
`real_money_enabled` defaults to `false` on every market.

## Stack
- pnpm workspaces, TypeScript strict
- apps/api — Node 20+, Fastify 5, Prisma 6, PostgreSQL, Redis, BullMQ, Socket.IO, Zod, pino
- apps/admin — React 18, Vite, Tailwind, React Router, TanStack Query, Recharts
- apps/mobile — React Native + Expo (Expo Router), LiveKit React Native SDK
- apps/provider-mock — Fastify service that behaves like a real game provider
- packages/shared — Zod schemas, types, constants
- infra — docker-compose (postgres, redis, livekit, api, admin, provider-mock)

## Quick start (5 minutes)
```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis livekit
pnpm db:migrate && pnpm db:seed
pnpm dev:all          # api :4001, admin :5173, provider-mock :4100
```

Default logins (after seed):
- Admin panel: `superadmin / SuperAdmin123!` (read-only viewer: `viewer / Viewer123!`)
- Player: `+880170000001 / User123!` (players 1–20, same pattern)

## Choices recorded
- Host ports 5433/6380/4001/4100/5173 to avoid clashing with local services on this machine (native postgres 5432, redis 6379, k8s 4000). In docker-compose, postgres/redis are 5433/6380 on the host.
- OTP is a dev stub (`123456`) — swap `deliverOtp()` in apps/api/src/routes/v1/auth.ts.
- The fake payment adapter always succeeds; swap via services/payment.adapter.ts.
- Ledger: single coin-movement path with idempotent txKey, row locks, balanceAfter (services/ledger.service.ts).

> The mock provider stands in for a real one. Before any real money is involved,
> swap in the licensed provider's API and have a lawyer confirm the games are
> lawful in each target market.
