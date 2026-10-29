# SM Live — Runbook (single VPS)

Boilerplate operations guide. Sized for one Linux VPS (4 vCPU / 8 GB to start),
Docker Compose only — no k8s needed.

## 1. Provision

```bash
# on a fresh Ubuntu 22.04+ VPS as root
adduser deploy && usermod -aG sudo,docker deploy
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
apt update && apt install -y docker.io docker-compose-plugin git
curl -fsSL https://get.pnpm.io/install.sh | su - deploy -c 'sh -s --'   # or apt nodejs
```

## 2. Deploy

```bash
sudo -iu deploy
git clone <your-repo> sm-live && cd sm-live
cp infra/.env.prod.example infra/.env    # EDIT secrets: JWT, ADMIN_JWT, db password,
                                        # provider key/secret, CORS_ORIGINS=your admin domain
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
docker compose -f infra/docker-compose.yml exec api sh -c "npx prisma migrate deploy && npx tsx prisma/seed.ts"   # first boot only
```

Services: api :4001 (behind nginx/caddy TLS), admin :8081, provider-mock :4100,
postgres + redis + livekit internal. Put Caddy in front for auto-TLS:

```
admin.example.com { reverse_proxy 127.0.0.1:8081 }
api.example.com  { reverse_proxy 127.0.0.1:4001 }
```

LiveKit needs UDP 50000–50100 open (`ufw allow 50000:50100/udp`).

## 3. Verify

```bash
curl -s localhost:4001/health            # {"ok":true,...database:"up","redis":"up"}
curl -s localhost:4001/v1/config/app | head -c 300
curl -s localhost:4100/health
# admin: http://admin.example.com — login superadmin / <your seeded password>
# run the e2e flow against the box:
FLOW_API_BASE=https://api.example.com pnpm -F @sm-live/api test:flow
```

## 4. Backups

Nightly dump via cron (installed by `infra/backup.sh --install`):

```bash
./infra/backup.sh                 # → infra/backups/sm_live_YYYYMMDD_HHMMSS.sql.gz (kept 14 days)
```

Restore:

```bash
docker compose -f infra/docker-compose.yml stop api provider-mock
gunzip -c infra/backups/<file>.sql.gz | docker compose -f infra/docker-compose.yml exec -T postgres psql -U sm_live -d sm_live
docker compose -f infra/docker-compose.yml start api provider-mock
```

Also back up `infra/.env` (secrets) off-box; the database dump contains
everything else (config, wallets, ledger).

## 5. Rollback

```bash
git checkout <previous-tag>
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --build
# migrations are additive; if a migration must be undone:
#   restore last good DB backup (step 4) — never prisma migrate resolve by hand in prod
```

## 6. Monitoring

- `GET /health` — db + redis (wire to uptime-kuma / better-stack, 30s).
- `GET /metrics` — prometheus: http request counters/histograms, default process metrics.
- Admin → API & Security → Server status (uptime, memory, heap).
- Admin → API & Security → API errors (provider call failures, bad signatures).
- Admin → Wallet → integrity must stay **OK** (`SUM(ledger) == wallet balances`).
  If it ever reports mismatches, freeze writes and investigate — it means a code
  path bypassed the ledger.

Log collection: `docker logs` + `docker logrotate` defaults; ship with
`docker plugin loki` or vector if you want centralised pino logs.

## 7. Routine ops

| task | how |
|---|---|
| add admin | Admin → API & Security → Roles → “Create admin user” |
| rotate provider api key | update GameProvider + ApiAccessKey rows (Settings/resources) — provider switches headers on their side |
| toggle a market's real-money flag | Admin → Settings → Markets (default **false**; do not enable without legal sign-off per market) |
| put a game in maintenance | Admin → Games → status; instantly reflected in `/v1/config/app` |
| reconcile a stuck round | Admin → Rounds → “Run stuck-round recovery now”, or force settle/cancel/restart per round |
| monthly settlement | Admin → Providers → “Generate bills”, confirm, record settlement |

## 8. Incident quick hits

- **API 5xx spike** → `docker compose logs api --tail 200`; check ApiErrorLog page.
- **Wallet integrity mismatch** → stop provider traffic (disable ApiAccessKey),
  snapshot DB, diff ledger rows for the mismatched userIds.
- **Redis down** → config cache falls back to DB reads; rate limiting and BullMQ
  degrade — API still serves reads; restart redis.
- **Postgres down** → health goes red, API 5xx on writes; restore from backup
  only if data loss confirmed.
- **Suspected abuse** → Admin → Players → restriction (ban / mute / freeze_wallet)
  — freeze_wallet instantly blocks game launch and ledger movements.
