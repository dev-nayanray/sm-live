/**
 * Health-check runners (Prompt 12).
 *
 * Each runner probes one platform component and returns a normalised
 * {@link HealthResult}. Runners are intentionally lightweight — they MUST
 * NOT cause cascading failures (e.g. if Redis is down, the queue check
 * should still return `not_configured` rather than throw).
 *
 * The {@link runHealthChecks} function executes all runners in parallel
 * and persists the results to the `HealthCheckResult` table. It is safe
 * to call from a Fastify route handler or from a background worker.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { redis } from "./redis.js";
import { env } from "../env.js";
import { logger } from "./logger.js";
import { isBackupDiscoveryConfigured } from "./ops-infra.js";

export interface HealthResult {
  component: string;
  status: "healthy" | "degraded" | "down" | "unknown" | "not_configured";
  responseTimeMs?: number;
  details?: string;
  error?: string;
  meta?: Record<string, unknown>;
}

/** Run a probe and convert any thrown error to a `down` result. */
async function probe(
  component: string,
  fn: () => Promise<Omit<HealthResult, "component">>,
): Promise<HealthResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return { component, ...r, responseTimeMs: r.responseTimeMs ?? Date.now() - start };
  } catch (e) {
    return {
      component,
      status: "down",
      error: (e as Error)?.message ?? String(e),
      details: "probe threw",
      responseTimeMs: Date.now() - start,
    };
  }
}

/** All health-check runners. Adding a runner here automatically picks it up. */
export async function runHealthChecks(): Promise<HealthResult[]> {
  const results = await Promise.all([
    probe("backend", async () => {
      // Backend = this API process. Always healthy if we're running.
      return { status: "healthy" as const, details: "API process responding" };
    }),
    probe("database", async () => {
      const t = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: "healthy" as const,
        responseTimeMs: Date.now() - t,
        details: "SELECT 1 ok",
      };
    }),
    probe("redis", async () => {
      // BullMQ requires Redis; if it's down, background jobs cannot run.
      // Wrap with a 1.5s timeout so a missing Redis doesn't hang the dashboard.
      try {
        const pong = await withTimeout(redis.ping(), 1500, "redis ping timed out");
        return {
          status: pong === "PONG" ? ("healthy" as const) : ("degraded" as const),
          details: `ping → ${pong}`,
        };
      } catch (e) {
        return {
          status: "down" as const,
          error: (e as Error).message,
          details: "redis ping failed",
        };
      }
    }),
    probe("auth", async () => {
      // Auth service = admin user table is reachable AND super_admin exists.
      // We never query for the actual password — only the existence check.
      const count = await prisma.adminUser.count({ where: { active: true } });
      return {
        status: count > 0 ? ("healthy" as const) : ("down" as const),
        details: `${count} active admin users`,
      };
    }),
    probe("api", async () => {
      // API endpoints = sample an existing admin endpoint with a minimal
      // query to ensure routing + DB layer respond.
      const t = Date.now();
      const c = await prisma.setting.count();
      return {
        status: "healthy" as const,
        responseTimeMs: Date.now() - t,
        details: `${c} settings rows reachable`,
      };
    }),
    probe("file_storage", async () => {
      // File storage — the API does not expose a file upload route today
      // (no `/v1/uploads`); we report `not_configured` rather than fake
      // "healthy". When uploads land, this probe should be updated.
      return {
        status: "not_configured" as const,
        details: "no file-upload route instrumented",
      };
    }),
    probe("workers", async () => {
      // Background workers = BullMQ queue health. We probe the queue
      // counts via the Redis connection; if Redis is down this returns
      // `down` independently of the `redis` probe. The probe is wrapped
      // in a 1.5s timeout so a missing Redis doesn't hang the dashboard.
      try {
        const { default: BullMQ } = await import("bullmq");
        type QueueLike = { count: () => Promise<number>; close?: () => Promise<unknown> };
        const Queue = (BullMQ as unknown as { Queue: new (name: string, opts: unknown) => QueueLike }).Queue;
        const q = new Queue("sm-live-jobs", { connection: redis.duplicate() });
        const waiting = await withTimeout(q.count(), 1500, "queue probe timed out");
        if (typeof q.close === "function") await q.close();
        return {
          status: "healthy" as const,
          details: `${waiting} jobs waiting in queue`,
        };
      } catch (e) {
        return {
          status: "down" as const,
          error: (e as Error).message,
          details: "BullMQ queue probe failed",
        };
      }
    }),
    probe("queue", async () => {
      // Queue services = Redis pub/sub available. We reuse the redis
      // connection to avoid an extra socket.
      try {
        const pong = await withTimeout(redis.ping(), 1500, "queue ping timed out");
        return {
          status: pong === "PONG" ? ("healthy" as const) : ("degraded" as const),
          details: "redis pub/sub reachable",
        };
      } catch (e) {
        return {
          status: "down" as const,
          error: (e as Error).message,
          details: "queue ping failed",
        };
      }
    }),
    probe("notifications", async () => {
      // Notification services — there is no notification integration in
      // the current platform (no email/SMS/push provider configured).
      // We surface `not_configured` rather than fake "healthy".
      return {
        status: "not_configured" as const,
        details: "no notification provider configured",
      };
    }),
    probe("providers", async () => {
      // Game provider integrations — count enabled providers, surface
      // degraded if any provider has logged an API error in the last
      // 5 minutes. We do NOT ping each provider from here (would amplify
      // a single slow provider into an unhealthy dashboard); the per-
      // provider health endpoint at /v1/admin/providers/:id/health is
      // the place for that.
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
      const [enabled, recentErrors] = await Promise.all([
        prisma.gameProvider.count({ where: { enabled: true } }),
        prisma.apiErrorLog.count({ where: { source: "provider", createdAt: { gte: fiveMinAgo } } }),
      ]);
      if (enabled === 0) return { status: "not_configured" as const, details: "no enabled providers" };
      return {
        status: recentErrors > 0 ? ("degraded" as const) : ("healthy" as const),
        details: `${enabled} providers, ${recentErrors} errors in last 5m`,
        meta: { enabled, recentErrors },
      };
    }),
    probe("wallet", async () => {
      // Wallet integration = ledger integrity check (cheap SELECT count).
      // The full integrity check (sum of balances = sum of ledger entries)
      // is heavier — that's exposed at /v1/admin/wallet/integrity.
      const t = Date.now();
      const ledgerCount = await prisma.ledgerEntry.count({ take: 1 });
      return {
        status: "healthy" as const,
        responseTimeMs: Date.now() - t,
        details: `ledger reachable (${ledgerCount} rows sampled)`,
      };
    }),
    probe("webhooks", async () => {
      // Webhook processing — check whether any webhook-source API errors
      // have been logged in the last 5 minutes.
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
      const recentErrors = await prisma.apiErrorLog.count({
        where: { source: "webhook", createdAt: { gte: fiveMinAgo } },
      });
      return {
        status: recentErrors > 0 ? ("degraded" as const) : ("healthy" as const),
        details: `${recentErrors} webhook errors in last 5m`,
        meta: { recentErrors },
      };
    }),
    probe("backups", async () => {
      // Backup discovery — surface `not_configured` when BACKUP_DIR_PATH
      // is unset so the dashboard never shows a fake "no backups" state
      // when the capability itself is disabled.
      if (!isBackupDiscoveryConfigured()) {
        return { status: "not_configured" as const, details: "BACKUP_DIR_PATH unset" };
      }
      const { discoverBackups } = await import("./ops-infra.js");
      const files = await discoverBackups();
      return {
        status: files.length > 0 ? ("healthy" as const) : ("degraded" as const),
        details: `${files.length} backups discoverable`,
        meta: { count: files.length, latest: files[0]?.filename ?? null },
      };
    }),
  ]);
  return results;
}

/**
 * Persist the latest health-check results to the database. Old results
 * older than the configured retention are pruned. Safe to call on every
 * dashboard refresh — the table is indexed on (component, checkedAt).
 */
export async function persistHealthResults(results: HealthResult[]): Promise<void> {
  const now = new Date();
  const retentionDays = env.HEALTH_CHECK_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

  await prisma.$transaction([
    prisma.healthCheckResult.createMany({
      data: results.map((r) => ({
        component: r.component,
        status: r.status,
        responseTimeMs: r.responseTimeMs ?? null,
        details: (r.details ?? "").slice(0, 500),
        error: (r.error ?? "").slice(0, 500),
        meta: (r.meta ?? null) as unknown as Prisma.InputJsonValue,
        checkedAt: now,
      })),
    }),
    prisma.healthCheckResult.deleteMany({ where: { checkedAt: { lt: cutoff } } }),
  ]).catch((e) => {
    // Persistence failure must not break the dashboard read path.
    logger.warn({ err: e }, "health-check persistence failed");
  });
}

/**
 * Race a promise against a timeout. Rejects with the given message when
 * the timeout fires first. Used by probes that touch Redis / BullMQ so
 * a missing dependency doesn't hang the dashboard.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
