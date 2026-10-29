# SM Live — Feature checklist (modules A–H)

Status: ✅ done · 🟡 partial · ❌ missing. “Where” points at file → endpoint.

## A. Live streaming & voice

| feature | status | where |
|---|---|---|
| Live rooms (1 host + audience) | ✅ | `apps/api/src/routes/v1/rooms.ts` → `POST /v1/rooms`, `POST /v1/rooms/:id/token`; mobile `app/room/[id].tsx` |
| Voice rooms, mic slots 3/5/10/15/20 | ✅ | `createRoomSchema` slots enum; `RoomParticipant.slotIndex`; slot request/approve socket events |
| Party rooms up to 9 | ✅ | room type `party`, slots 9 (seeded room + mobile slot grid) |
| Publish permission only for allowed slots | ✅ | `apps/api/src/services/room.service.ts` → token grant `canPublish` host/slot only |
| LiveKit token minting | ✅ | `services/room.service.ts` (`livekit-server-sdk` AccessToken) |
| Chat in room | ✅ | `apps/api/src/socket.ts` `chat:send/chat:message`; mobile chat panel |
| Gifts with effects + ranking | ✅ | `routes/v1/gifts.ts` (ledger batch, Ranking upsert); mobile gift sheet + `gift:broadcast` animation flag |
| Mute / kick | ✅ | socket `room:mute`, `room:kick` (host only) |
| Slot request flow | ✅ | `POST /v1/rooms/:id/slot-request` + `slot:approve/assigned` |
| VIP & noble badges | ✅ | User.vipLevel/nobleLevel rendered (mobile room/chat, admin) |
| PK battle | 🟡 | flag `pk_battle.enabled` (off) + mobile banner stub — scoring flow not implemented |
| 1:1 voice/video call | 🟡 | LiveKit tokens + socket layer support it; dedicated call screen not implemented |
| Short video feed | ✅ | `routes/v1/content.ts`, ShortVideo model, mobile home feed |
| Moments | ✅ | Moment model + mobile feed |
| Media upload/transcode | ❌ | URLs stored only (seed uses placeholder CDN); no upload service in boilerplate |

## B. User & agency

| feature | status | where |
|---|---|---|
| Register/login (phone/email) + OTP stub | ✅ | `routes/v1/auth.ts` (dev OTP 123456 in response) |
| JWT access + refresh rotation | ✅ | `lib/auth.ts`, Session table, `POST /v1/auth/refresh` |
| Country filter | ✅ | CountryFilter model + ConfigService.isCountryBlocked (room listing) |
| Agency tree (parent, commission rate) | ✅ | Agency model self-relation; `GET /v1/agencies/tree`, admin CRUD |
| Agency commission on gifts | ✅ | `routes/v1/gifts.ts` ledger entry `agency_commission` |
| Coin agency panel | ✅ | `GET /v1/agencies/panel` (30d commission/members) + admin Users → Wallet modal |
| Recharge on behalf of users | ✅ | `POST /v1/admin/users/:id/recharge` (audited, ledgered) |
| Referral tracking | 🟡 | `referrerCode` stored at register; no rewards flow |

## C. Game management

| feature | status | where |
|---|---|---|
| Game CRUD (code, version, status, isPro) | ✅ | Game model; admin Games tab (resource `games`) |
| Status active/maintenance/disabled | ✅ | `Game.status`; launch + provider bet enforce; `/v1/config/app` reflects |
| Per-market bet limits & timing | ✅ | GameConfig (minBet, maxBet, bettingSeconds, timeoutSeconds) — admin Game configs tab |
| Provider registry (apiBase, secret, commission) | ✅ | GameProvider + admin Providers tab |
| Signed launch URL | ✅ | `services/game.service.ts` + `lib/hmac.ts` launchSignature |
| Stuck round recovery (refund/settle) | ✅ | `workers/rounds.recovery.ts` + BullMQ every 30s + admin trigger |
| RTP tracking | ✅ | RtpSnapshot hourly job + admin Wallet → RTP view |
| Real provider integration | ❌ | mock provider only by design — swap `apps/provider-mock` for licensed API |

## D. Wallet & coin

| feature | status | where |
|---|---|---|
| Single ledger service | ✅ | `services/ledger.service.ts` — the only coin path |
| Immutable entries, unique txKey, row locks, no negative, balanceAfter | ✅ | enforced + `test/ledger.test.ts`, `test:load` |
| Recharge via pluggable adapter | ✅ | `services/payment.adapter.ts` (fake adapter) |
| Refund | ✅ | `POST /v1/admin/wallet/refund` (audited) + provider `/provider/refund` |
| Win/cancel/bet endpoints | ✅ | `routes/provider.ts` |
| Reconnect session state | ✅ | `GET /v1/games/session/:id/state` |
| Deduction/winning records | ✅ | admin Wallet → ledger explorer (kind filter, CSV) |
| Integrity check | ✅ | `GET /v1/admin/wallet/integrity` (sums == balances) |
| Withdraw (player → real money) | ❌ | intentionally absent — requires PSP + licensing; AgencyWithdrawal model exists (admin flow not built) |

## E. Player control

| feature | status | where |
|---|---|---|
| Restrictions ban/mute/freeze_wallet/kick | ✅ | PlayerRestriction + admin Restrictions tab + enforced at login/gift/launch/ledger |
| Session list per player | ✅ | `GET /v1/admin/players/:id/detail` |
| Suspicious events | 🟡 | SuspiciousEvent stored (security auth failures); heuristics minimal |
| Complaints workflow | ✅ | Complaint model + admin Players → complaints (resolve/reject) |
| ApiAccessKey IP allow list | ✅ | provider auth (`ipAllowed`) + admin API keys tab |

## F. Reports

| feature | status | where |
|---|---|---|
| Dashboard totals + 30d chart | ✅ | `GET /v1/admin/dashboard` + Recharts |
| Total bets/winnings/rounds | ✅ | admin Reports (daily/weekly/monthly) |
| Game performance + RTP | ✅ | `GET /v1/admin/reports/games` |
| Daily rollup | ✅ | DailyRevenue + BullMQ 00:05 job |
| CSV export | ✅ | every table (client-side CSV) |
| Report totals match raw rows | ✅ | verified in final verification (seeded day) |

## G. API integration

| feature | status | where |
|---|---|---|
| HMAC-SHA256 signature + timestamp | ✅ | `lib/hmac.ts`; scheme in `docs/API.md` |
| IP allow list | ✅ | ApiAccessKey |
| /bet /win /cancel /refund /balance | ✅ | `routes/provider.ts` |
| Retry-safe webhook | ✅ | `/provider/webhook/round` duplicate:true on replay |
| API error log visible in admin | ✅ | ApiErrorLog + admin API errors tab |
| Duplicate-call handling | ✅ | txKey idempotency (unit + load tested) |

## H. Provider settlement

| feature | status | where |
|---|---|---|
| ProviderBill generation (monthly, idempotent) | ✅ | `workers/bills.ts` + job + admin Generate |
| Commission / revenue share | ✅ | provider.commissionPct on gross margin |
| Monthly service fee | ✅ | MonthlyServiceFee job + Settings key |
| Integration fee | 🟡 | model + admin surfaces; no automatic charging |
| Settlement records | ✅ | SettlementRecord + admin tab |
| Payment execution (bank/crypto rails) | ❌ | records only — no money movement by design |

## Cross-cutting (from the global rules)

| rule | status | where |
|---|---|---|
| Everything dynamic from DB (games, limits, flags, gifts, countries, commission, branding, tabs) | ✅ | Config pipeline + `/v1/config/app`; zero hard-coded business values in clients |
| One ledger for all coin movement | ✅ | see module D |
| AuditLog on every admin action | ✅ | `writeAudit()` in all admin writes |
| RBAC on every admin endpoint | ✅ | `requireAdmin(req, perm)`; roles: super_admin, security_admin, finance, support, agency_admin (+viewer) |
| Zod validation + consistent error JSON + no secret logging | ✅ | shared schemas; pino redact; envelope everywhere |
| Per-market real_money_enabled, default false | ✅ | Market.realMoneyEnabled (false everywhere in seed) |
| Tests for ledger, wallet, webhook signature, RBAC | ✅ | `apps/api/test/*` (22 tests) |

**Summary — missing by design:** real payment provider, real game provider,
withdraw rails, media upload pipeline, PK scoring, 1:1 call screen. Everything
else is implemented and exercised by automated checks.
