# SM Live — API reference

Base URL (dev): `http://localhost:4001`

All responses use one envelope:

```json
{ "ok": true,  "data": { … } }
{ "ok": false, "error": { "code": "…", "message": "…", "details": … } }
```

Auth: `Authorization: Bearer <accessToken>` — user tokens and admin tokens use
different secrets and are not interchangeable (401 otherwise).

## Public / player endpoints

| method | path | notes |
|---|---|---|
| GET | `/health` | liveness: db + redis checks |
| GET | `/metrics` | prometheus exposition |
| GET | `/v1/config/app?market=bd` | brand, flags, games (+bet limits), gifts, bottom tabs, realMoneyEnabled |
| POST | `/v1/auth/register` | `{phone?, email?, password, displayName, market}` |
| POST | `/v1/auth/login` | `{identifier, password}` (rate limited) |
| POST | `/v1/auth/otp/request` `{identifier}` | dev stub returns `devCode` (123456) |
| POST | `/v1/auth/otp/verify` `{identifier, code}` | |
| POST | `/v1/auth/refresh` `{refreshToken}` | rotates the session |
| POST | `/v1/auth/logout` | |
| GET | `/v1/auth/me` | |
| GET | `/v1/rooms?type=&country=` | open rooms, country-filtered |
| POST | `/v1/rooms` `{title,type,slots,country}` | host = caller |
| POST | `/v1/rooms/:id/join` · `/leave` | |
| POST | `/v1/rooms/:id/token` | **LiveKit token — publish only for host/slot holders** |
| POST | `/v1/rooms/:id/slot-request` | emits `slot:request` to host |
| POST | `/v1/gifts/send` `{giftId, roomId?, recipientId?, quantity}` | ledger: sender −, host +, agency commission + |
| GET | `/v1/gifts/ranking?period=daily|weekly|monthly` | |
| GET | `/v1/agencies/tree` · `/v1/agencies/panel` | agency subtree + 30d commission |
| GET | `/v1/wallet/balance` · `/v1/wallet/history` | |
| POST | `/v1/wallet/recharge` `{amount, provider:"fake"}` | pluggable adapter |
| GET | `/v1/games?market=` | |
| POST | `/v1/games/:code/launch` | returns `{url, sessionId}` signed launch URL |
| GET | `/v1/games/session/:sessionKey/state` | reconnect: pending bets + balance |
| GET | `/v1/content/short-videos` · `/v1/content/moments` | feeds |

Socket.IO events (auth via `{ token }` in handshake): `room:join`, `chat:send`,
`chat:message`, `room:kick`, `room:mute`, `slot:request`, `slot:approve`,
`slot:assigned`, `gift:broadcast`.

## Admin endpoints (`/v1/admin/*`)

Login `POST /v1/admin/auth/login` `{username, password}` → `{accessToken, permissions}`.
`GET /v1/admin/auth/me` returns the caller's permission set.

Generic config CRUD (pagination + search + sort on every resource):
`GET|POST /v1/admin/resources/:resource`, `GET|PATCH|DELETE /v1/admin/resources/:resource/:id`
where resource ∈ `gifts, games, game-providers, game-configs, markets, brand-configs,
feature-flags, country-filters, settings, api-access-keys, restrictions`.
Field metadata for forms: `GET /v1/admin/resources`. Every write requires the
resource's write permission and lands in AuditLog; config entities invalidate
the `/v1/config/app` cache immediately.

Specialised: `/v1/admin/dashboard`, `/v1/admin/users`, `/v1/admin/agencies`,
`/v1/admin/users/:id/recharge|adjust`, `/v1/admin/rooms(+/:id/close)`,
`/v1/admin/rounds`, `/v1/admin/bets(+/:id/cancel)`, `/v1/admin/rounds/:id/force`
`(settle|cancel|restart)`, `/v1/admin/rounds/recover-stuck`,
`/v1/admin/wallet/ledger|recharges|refund|integrity|rtp`,
`/v1/admin/players/:id/detail`, `/v1/admin/complaints`, `/v1/admin/suspicious`,
`/v1/admin/reports/revenue|games|daily-rollup`,
`/v1/admin/settlement/bills|records|generate-bills`,
`/v1/admin/security/audit|events|api-errors|status`, `/v1/admin/roles(+/…/permissions)`,
`/v1/admin/admin-users`.

---

## Provider wallet API — signature scheme

This is the contract a **real** game provider integrates against
(`apps/provider-mock/src/client.ts` is a working reference implementation).

### Signing

Every call must carry three headers:

```
X-Api-Key:     <key from ApiAccessKey, seeded: mockcorp-key-1>
X-Timestamp:   <unix seconds>
X-Signature:   <hex HMAC_SHA256 below>
```

```
bodyHash  = SHA256_hex(rawBody)
payload   = "#{METHOD}|#{path}|#{timestamp}|#{bodyHash}"
signature = HMAC_SHA256_hex(provider.apiSecret, payload)
```

- `path` is the exact request path without query string, e.g. `/provider/bet`.
- Timestamps outside ±300s are rejected (`CONSTANT.PROVIDER_SIGNATURE_TOLERANCE_SECONDS`).
- The key must be enabled and the caller IP must be in `ApiAccessKey.ipAllowList`
  (exact IP or `prefix*` entries).
- Failures are stored (`ApiErrorLog`, `SecurityEvent`) and visible in the admin panel.

### Endpoints

| method | path | body | idempotency |
|---|---|---|---|
| POST | `/provider/wallet/balance` | `{sessionId}` | — |
| POST | `/provider/bet` | `{sessionId, roundId, amount, txId}` | same `txId` → original bet, `replayed:true` |
| POST | `/provider/win` | `{sessionId, roundId, amount, txId, payoutMultiplier?}` | same `txId` → original payout |
| POST | `/provider/cancel` | `{sessionId, roundId, txId}` | bet → cancelled + refund |
| POST | `/provider/refund` | `{sessionId, roundId, txId}` | bet → refunded + refund |
| POST | `/provider/webhook/round` | see below | replay returns `{duplicate:true}` + 200 |

Bet validation: game must be `active`, amount within `GameConfig.minBet..maxBet`
for the session's market, and the round must still be inside `bettingSeconds`.

Webhook body:

```json
{
  "roundId": "mock-r-abc123",
  "sessionId": "8f22…",
  "status": "settled",            // settled | cancelled
  "bets": [ { "txId": "uuid", "amount": 100, "outcome": "won|lost|refunded" } ],
  "ts": 1793271000
}
```

### Launch (platform → provider)

`POST /v1/games/:code/launch` returns:

```
{provider.apiBase}/launch?session=<sessionKey>&user=<userId>&ts=<unix>&sig=<hex>
sig = HMAC_SHA256_hex(apiSecret, "#{sessionKey}|#{userId}|#{ts}")
```

### Reconnect

After a network drop the client re-reads
`GET /v1/games/session/:sessionKey/state` → `{ balance, pendingBets[], recentRounds[] }`
and the round continues; stuck rounds are recovered by the BullMQ job per
`GameConfig.stuckPolicy` (`refund` default, or `settle`).

### Error codes

`unauthorized` (bad key/sig/ip), `bad_request` (validation, window closed,
status not active), `insufficient_funds` (422), `not_found` (404),
`conflict` (409), `rate_limited` (429) — always the same JSON envelope.
