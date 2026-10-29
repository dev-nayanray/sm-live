# SM Live — Architecture

## Services

```
                        ┌──────────────────────────────────────────────────┐
                        │                    clients                       │
   ┌──────────────┐     │   ┌──────────────┐   ┌──────────────────────┐   │
   │ Expo mobile  │─────┼──▶│   API        │◀──│  React admin panel   │   │
   │ (config-     │ REST│   │  (Fastify)   │   │  (Vite build, nginx) │   │
   │  driven)     │     │   │  :4001       │   │  :8081 / :5173 dev   │   │
   └──────┬───────┘     │   └──┬───┬───┬───┘   └──────────┬───────────┘   │
          │             │      │   │   │                  │               │
          │ WebSocket   │      │   │   └──── REST /v1/admin/*             │
          │ (socket.io) │      │   │        (RBAC + AuditLog)             │
          ▼             │      │   ▼                                      │
   ┌──────────────┐     │   ┌──▼────────────┐   ┌──────────────────────┐   │
   │  LiveKit SFU │◀────┼───│ tokens w/     │   │  provider-mock       │   │
   │  :7880       │     │   │ slot grants   │   │  (Fastify :4100)     │   │
   └──────────────┘     │   └───────────────┘   └─────────┬────────────┘   │
                        │                                  │ HMAC-signed    │
   ┌──────────────┐     │   ┌──────────────┐   ┌──────────▼───────────┐   │
   │ PostgreSQL   │◀────┼───│   Redis      │◀──│  /provider/* wallet  │   │
   │ :5433        │     │   │  :6380       │   │  API + webhooks      │   │
   │ (Prisma)     │     │   │ cache+BullMQ │   │  (real providers use │   │
   └──────────────┘     │   └──────────────┘   │  the same contract)  │   │
                        │                      └──────────────────────┘   │
                        └──────────────────────────────────────────────────┘
```

| Service | Dev port | Role |
|---|---|---|
| apps/api | 4001 | REST + Socket.IO, JWT auth, ledger, BullMQ workers, /metrics |
| apps/admin | 5173 (dev) / 8081 (docker) | RBAC-aware control panel, all config entities |
| apps/mobile | expo | Whole UI driven by GET /v1/config/app |
| apps/provider-mock | 4100 | Signs calls exactly like a real game provider |
| postgres | 5433 (host) | All state; no business values in code |
| redis | 6380 (host) | config cache, rate limiting, BullMQ queues |
| livekit | 7880 | WebRTC SFU for live/voice/party rooms |

## Coin flow (every movement, one path)

```
 recharge (fake adapter)      gift send                       game bet
 ─────────────────────  ─────────────────────────────  ─────────────────────────
 POST /v1/wallet/         POST /v1/gifts/send            POST /provider/bet
   recharge                 │                              (HMAC + IP allowlist)
   │                        ▼                              │
   │                   one ledger batch:                   ▼
   ▼                   debit sender ──────┐        validate status/window/
 Recharge row              credit host    │        min/max → one ledger batch:
    │                      commission →   │        debit player
    └──── ledger: credit ─┘  agency user  │              │
                             │            │              ▼
                             ▼            │        Bet row (status=placed)
                        GiftTransaction   │              │
                        Ranking points    │        win / cancel / refund / webhook
                                          │              │
                                          ▼              ▼
                                   ┌──────────────────────────────────┐
                                   │  LedgerEntry (immutable, append) │
                                   │  - unique txKey (idempotency)    │
                                   │  - row-locked Wallet FOR UPDATE  │
                                   │  - running balance ≥ 0 enforced  │
                                   │  - balanceAfter on every row     │
                                   └───────────┬──────────────────────┘
                                               ▼
                                   Wallet.balance == SUM(entries)
                                   (GET /v1/admin/wallet/integrity asserts it)
```

### Ledger invariants (enforced + tested)

1. Every coin movement is one or more `LedgerEntry` rows — no direct wallet writes anywhere.
2. `txKey` is globally unique; replaying the same key returns the original row (`replayed: true`) and never double-applies. Tested with 10 concurrent identical calls and 50 duplicate replays in the load test.
3. Wallet rows are locked `SELECT … FOR UPDATE` ordered by userId inside the posting transaction — no deadlocks, no lost updates.
4. A debit that would take the running balance below zero aborts the whole batch (`insufficient_funds`).
5. `balanceAfter` is stored per row and always equals `Wallet.balance` after commit.

## Game round lifecycle

```
launch ─▶ GameSession ─▶ provider /bet (window = bettingSeconds) ─▶ Bet(placed)
                            │                                        │
              provider /win │ /cancel /refund         webhook /provider/webhook/round
                            ▼                                        ▼
                     Payout / Bet(won|cancelled|refunded)    GameRound(settled|cancelled)
                                                                     │
                                              BullMQ recovery (every 30s)
                                              rounds open past timeoutSeconds →
                                              refund or settle per GameConfig.stuckPolicy
```

## Config pipeline

```
DB (Game, GameConfig, Gift, Market, BrandConfig, FeatureFlag, Setting, CountryFilter)
   │  admin panel CRUD (audited, RBAC)          ┌── Redis cache 60s ──┐
   └───────────────────────────────────────────▶│ ConfigService       │
                                                └────────┬────────────┘
                       invalidateConfig() on writes ◀─────┘
                                                          ▼
                                            GET /v1/config/app?market=…
                                            brand · flags · games(+limits)
                                            gifts · bottomTabs · realMoneyEnabled
                                                          ▼
                                            mobile app boots entirely from this
```

## Background jobs (BullMQ)

| job | schedule | behaviour |
|---|---|---|
| recover-rounds | every 30s | stuck rounds → refund/settle per config |
| daily-rollup | 00:05 UTC | upsert DailyRevenue for yesterday |
| rtp-snapshot | hourly | realized RTP per game → RtpSnapshot |
| monthly-fees | 1st 00:20 | MonthlyServiceFee per provider |
| provider-bills | 1st 00:30 | draft ProviderBill per provider (idempotent) |

## Security layers

- Users: JWT access (15m) + hashed refresh sessions; admin: separate secret + RBAC permission per route.
- Provider API: HMAC-SHA256 over `METHOD|path|timestamp|sha256(body)` (±300s), API key lookup, IP allow list, all failures stored in ApiErrorLog/SecurityEvent.
- Every admin mutation writes an AuditLog row (who/what/before/after/ip).
- Rate limits on login/OTP/register/recharge/gift/launch; helmet headers; CORS allow list; request IDs; prometheus /metrics.
- `real_money_enabled` default false on every market; mobile renders the flag; nothing real-money is implemented by design.
