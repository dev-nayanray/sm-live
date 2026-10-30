import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";

// minimal .env loader (no dependency) — real env vars always win
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  LIVEKIT_URL: z.string().default("ws://localhost:7880"),
  LIVEKIT_API_KEY: z.string().default("devkey"),
  LIVEKIT_API_SECRET: z.string().default("devsecret_that_is_at_least_16_chars"),
  JWT_SECRET: z.string().min(16).default("dev-jwt-secret-not-for-production"),
  ADMIN_JWT_SECRET: z.string().min(16).default("dev-admin-jwt-secret-not-for-prod"),
  SUPER_ADMIN_USERNAME: z.string().default("superadmin"),
  SUPER_ADMIN_PASSWORD: z.string().default("SuperAdmin123!"),
  SUPER_ADMIN_EMAIL: z.string().default("admin@sm-live.local"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:4173"),
  PUBLIC_API_BASE: z.string().default("http://localhost:4000"),
  PAYMENT_ADAPTER: z.enum(["fake"]).default("fake"),
  // --- Platform Operations (Prompt 12) ---------------------------------------
  // Backup discovery — when set, the API scans this directory for verified
  // backup files (sm_live_*.sql.gz). Empty by default → endpoint returns
  // `not_configured` rather than guessing a path.
  BACKUP_DIR_PATH: z.string().default(""),
  // Backup creation — when set to an executable script path (e.g.
  // `./infra/backup.sh`), the API invokes it on POST /v1/admin/operations/
  // backups/run. Empty by default → backup creation is disabled from the
  // admin UI; backups must be created out-of-band (cron / CI).
  BACKUP_SCRIPT_PATH: z.string().default(""),
  // Restore execution — when set to an executable script path (e.g.
  // `./infra/restore.sh`), the API invokes it for staging/sandbox restores.
  // Empty by default → restore workflow is "document-only" from the admin
  // UI; production restores are always manual (see infra/restore.sh).
  RESTORE_SCRIPT_PATH: z.string().default(""),
  // Maintenance banner scope enforcement. When `MAINTENANCE_STRICT` is
  // `true`, the user-facing routes return 503 during an active `platform`
  // maintenance window. Default false in dev so the seed/fixture data
  // remains reachable; production should set this to `true`.
  MAINTENANCE_STRICT: z.enum(["true", "false"]).default("false"),
  // Health check retention (days). Health-check results older than this
  // are pruned by the scheduler to keep the table bounded.
  HEALTH_CHECK_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
});

export const env = envSchema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
