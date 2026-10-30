import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  adminLoginSchema, paginationQuery, LEDGER_KINDS,
  userListQuerySchema, userUpdateSchema, adminNoteSchema,
  maskContact, RESTRICTION_TYPES,
  agencyCreateSchema, agencyUpdateSchema, agencyStatusChangeSchema, agencyListQuerySchema,
  roomReportCreateSchema, roomReportUpdateSchema, roomListQuerySchema,
  gameStatusChangeSchema, gameListQuerySchema, providerListQuerySchema, sessionListQuerySchema,
  ledgerListQuerySchema, walletListQuerySchema, analyticsQuerySchema,
  // Platform Operations (Prompt 12) — type re-exports used by route handlers.
  // The constant arrays (MAINTENANCE_SCOPES etc.) are referenced by the
  // Zod schemas; we re-import them here only for the `typeof X[number]`
  // expressions used as Prisma type parameters.
  maintenanceCreateSchema, maintenanceUpdateSchema, maintenanceActionSchema, maintenanceListQuerySchema,
  backupCreateSchema, backupDeleteSchema, backupVerifySchema, backupListQuerySchema,
  recoveryCreateSchema,
  incidentCreateSchema, incidentUpdateSchema, incidentListQuerySchema,
  alertListQuerySchema, alertAckSchema, alertResolveSchema,
  logListQuerySchema, jobListQuerySchema, jobRetrySchema,
  MAINTENANCE_EVENT_TYPES,
} from "@sm-live/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { unauthorized, notFound, badRequest, forbidden, notConfigured, conflict } from "../../lib/errors.js";
import { validate, bodyOf, paramsOf, queryOf } from "../../lib/validate.js";
import { requireAdmin, signAdminToken, verifyPassword, hashPassword } from "../../lib/auth.js";
import { writeAudit, recordApiError } from "../../lib/audit.js";
import { postLedgerEntries, ledgerIntegrityCheck } from "../../services/ledger.service.js";
import { getPaymentAdapter } from "../../services/payment.adapter.js";
import { emitToRoom } from "../../socket.js";
import { env } from "../../env.js";
import {
  discoverBackups, runBackupScript, runRestoreScript,
  isBackupCreateConfigured, isRestoreConfigured, isBackupDiscoveryConfigured,
} from "../../lib/ops-infra.js";
import { runHealthChecks, persistHealthResults, withTimeout, type HealthResult } from "../../lib/health-checks.js";
import os from "node:os";

/**
 * Dashboard date-range validator.
 *
 * Presets are evaluated server-side (timezone = UTC) so the admin UI and any
 * programmatic caller get the same windows. Custom ranges accept ISO 8601
 * calendar dates only (YYYY-MM-DD) — never raw timestamps — and are clamped
 * to a 90-day maximum to keep the aggregation queries bounded.
 */
const DASHBOARD_PRESETS = ["today", "yesterday", "last7", "last30", "this_month", "prev_month"] as const;
type DashboardPreset = (typeof DASHBOARD_PRESETS)[number];

const dashboardQuerySchema = z.object({
  preset: z.enum(DASHBOARD_PRESETS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Resolve {from, to, prevFrom, prevTo} (UTC, half-open [from, to)) for a preset or custom range. */
function resolveDashboardRange(preset: DashboardPreset | undefined, fromStr?: string, toStr?: string): {
  from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string;
} {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let from: Date;
  let to: Date;
  let label: string;

  if (preset) {
    switch (preset) {
      case "today": {
        from = todayUtc;
        to = new Date(todayUtc.getTime() + 86_400_000);
        label = "Today";
        break;
      }
      case "yesterday": {
        from = new Date(todayUtc.getTime() - 86_400_000);
        to = todayUtc;
        label = "Yesterday";
        break;
      }
      case "last7": {
        from = new Date(todayUtc.getTime() - 6 * 86_400_000);
        to = new Date(todayUtc.getTime() + 86_400_000);
        label = "Last 7 days";
        break;
      }
      case "last30": {
        from = new Date(todayUtc.getTime() - 29 * 86_400_000);
        to = new Date(todayUtc.getTime() + 86_400_000);
        label = "Last 30 days";
        break;
      }
      case "this_month": {
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        label = "This month";
        break;
      }
      case "prev_month": {
        from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        label = "Previous month";
        break;
      }
      default: {
        // exhaustive — TS guarantees this is unreachable
        from = new Date(todayUtc.getTime() - 29 * 86_400_000);
        to = todayUtc;
        label = "Last 30 days";
      }
    }
  } else if (fromStr && toStr) {
    from = new Date(`${fromStr}T00:00:00.000Z`);
    to = new Date(`${toStr}T00:00:00.000Z`);
    // to is exclusive → roll forward one day so the user's "to" day is included
    to = new Date(to.getTime() + 86_400_000);
    label = `${fromStr} → ${toStr}`;
    if (to.getTime() <= from.getTime()) throw badRequest("`to` must be on or after `from`");
    if (to.getTime() - from.getTime() > 90 * 86_400_000) throw badRequest("custom range must be ≤ 90 days");
  } else {
    // Default: last 30 days
    from = new Date(todayUtc.getTime() - 29 * 86_400_000);
    to = new Date(todayUtc.getTime() + 86_400_000);
    label = "Last 30 days";
  }

  // Equivalent previous period (same duration, immediately before `from`).
  const durationMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - durationMs);
  const prevTo = from;
  return { from, to, prevFrom, prevTo, label };
}

/** Percentage delta between two non-negative counts; null when prev === 0 (cannot divide) or either is null. */
function pctDelta(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null) return null;
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

/**
 * Reverse-compatible but greatly enriched dashboard endpoint.
 *
 * Response shape (kept additive so the existing `/v1/admin/dashboard` callers
 * continue to work; new fields are documented below):
 *
 *   totals:            legacy 30-day snapshot (preserved for any old consumer)
 *   range:             { from, to, preset, label }
 *   generatedAt:       ISO timestamp of this response
 *   currency:          "coins" — platform-configured virtual currency
 *   kpis:              { users, agencies, liveRooms, games, walletTx, providers }
 *                       each: { total, currentPeriod, previousPeriod, deltaPct, ... }
 *   financial:         { bets, payouts, gifts, recharges, refunds, netGaming }
 *   series:            [{ day, newUsers, bets, payouts, recharges, gifts }]
 *   activity:          [{ id, kind, label, category, status, actor, ts }]
 *   alerts:            [{ id, severity, title, detail, ts, link }]
 */
export async function adminRoutes(app: FastifyInstance) {
  // --- Auth ---------------------------------------------------------------
  app.post("/v1/admin/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const input = validate(adminLoginSchema, bodyOf(req));
    const admin = await prisma.adminUser.findUnique({
      where: { username: input.username },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!admin || !admin.active || !(await verifyPassword(input.password, admin.passwordHash))) {
      await recordApiError("admin", "/v1/admin/auth/login", `failed login ${input.username}`);
      throw unauthorized("invalid credentials");
    }
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const token = signAdminToken({ sub: admin.id, kind: "admin", role: admin.role.key });
    return {
      ok: true,
      data: {
        accessToken: token,
        admin: { id: admin.id, username: admin.username, displayName: admin.displayName, role: admin.role.key },
        permissions: admin.role.permissions.map((p) => p.permission.key),
      },
    };
  });

  app.get("/v1/admin/auth/me", async (req) => {
    const admin = await requireAdmin(req);
    const role = await prisma.role.findUnique({ where: { id: admin.roleId }, include: { permissions: { include: { permission: true } } } });
    return {
      ok: true,
      data: {
        id: admin.id, username: admin.username, displayName: admin.displayName,
        role: role?.key, permissions: role?.permissions.map((p) => p.permission.key) ?? [],
      },
    };
  });

  // --- Dashboard ------------------------------------------------------------
  app.get("/v1/admin/dashboard", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    await requireAdmin(req, "dashboard.view");
    const q = validate(dashboardQuerySchema, queryOf(req));
    const range = resolveDashboardRange(q.preset, q.from, q.to);
    const { from, to, prevFrom, prevTo } = range;

    // ----------------------------------------------------------------------
    // KPI sources (all aggregates — no full table scans into memory)
    // ----------------------------------------------------------------------
    const [
      totalUsers, newUsersInPeriod, newUsersPrev,
      totalAgencies, newAgenciesInPeriod, newAgenciesPrev,
      activeRooms, totalRooms, roomsOpenedInPeriod, roomsClosedInPeriod,
      gamesTotal, gamesActive, gamesMaintenance, gamesDisabled,
      betsAgg, betsAggPrev, payoutsAgg, payoutsAggPrev,
      giftsAgg, giftsAggPrev,
      rechargesAgg, rechargesAggPrev, rechargesFailed,
      refundsAgg, refundsAggPrev,
      ledgerInPeriod, ledgerPrev,
      providersTotal, providersEnabled, providersWithErrors,
      apiErrorsInPeriod, suspiciousHighInPeriod, complaintsOpen,
      seriesRows,
      recentAudit,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: from, lt: to } } }),
      prisma.user.count({ where: { createdAt: { gte: prevFrom, lt: prevTo } } }),
      prisma.agency.count(),
      prisma.agency.count({ where: { createdAt: { gte: from, lt: to } } }),
      prisma.agency.count({ where: { createdAt: { gte: prevFrom, lt: prevTo } } }),
      prisma.room.count({ where: { closedAt: null } }),
      prisma.room.count(),
      prisma.room.count({ where: { createdAt: { gte: from, lt: to } } }),
      prisma.room.count({ where: { closedAt: { gte: from, lt: to } } }),
      prisma.game.count(),
      prisma.game.count({ where: { status: "active" } }),
      prisma.game.count({ where: { status: "maintenance" } }),
      prisma.game.count({ where: { status: "disabled" } }),
      prisma.bet.aggregate({ where: { createdAt: { gte: from, lt: to } }, _count: true, _sum: { amount: true } }),
      prisma.bet.aggregate({ where: { createdAt: { gte: prevFrom, lt: prevTo } }, _count: true, _sum: { amount: true } }),
      prisma.payout.aggregate({ where: { createdAt: { gte: from, lt: to } }, _count: true, _sum: { amount: true } }),
      prisma.payout.aggregate({ where: { createdAt: { gte: prevFrom, lt: prevTo } }, _count: true, _sum: { amount: true } }),
      prisma.giftTransaction.aggregate({ where: { createdAt: { gte: from, lt: to } }, _count: true, _sum: { totalPrice: true } }),
      prisma.giftTransaction.aggregate({ where: { createdAt: { gte: prevFrom, lt: prevTo } }, _count: true, _sum: { totalPrice: true } }),
      prisma.recharge.aggregate({ where: { createdAt: { gte: from, lt: to }, status: "succeeded" }, _count: true, _sum: { amount: true } }),
      prisma.recharge.aggregate({ where: { createdAt: { gte: prevFrom, lt: prevTo }, status: "succeeded" }, _count: true, _sum: { amount: true } }),
      prisma.recharge.count({ where: { createdAt: { gte: from, lt: to }, status: "failed" } }),
      prisma.refund.aggregate({ where: { createdAt: { gte: from, lt: to } }, _count: true, _sum: { amount: true } }),
      prisma.refund.aggregate({ where: { createdAt: { gte: prevFrom, lt: prevTo } }, _count: true, _sum: { amount: true } }),
      prisma.ledgerEntry.count({ where: { createdAt: { gte: from, lt: to } } }),
      prisma.ledgerEntry.count({ where: { createdAt: { gte: prevFrom, lt: prevTo } } }),
      prisma.gameProvider.count(),
      prisma.gameProvider.count({ where: { enabled: true } }),
      // providers that have produced at least one API error in the last 24h
      prisma.$queryRaw<{ providerId: number | null; cnt: bigint }[]>`
        SELECT NULL::int AS "providerId", COUNT(*)::bigint AS cnt
        FROM "ApiErrorLog" WHERE "createdAt" >= NOW() - INTERVAL '24 hours' AND source = 'provider'`,
      prisma.apiErrorLog.count({ where: { createdAt: { gte: from, lt: to } } }),
      prisma.suspiciousEvent.count({ where: { createdAt: { gte: from, lt: to }, severity: "high" } }),
      prisma.complaint.count({ where: { status: { in: ["open", "in_progress"] } } }),
      // Daily series — one row per day in [from, to)
      prisma.$queryRaw<{ day: Date; newUsers: bigint; bets: bigint; payouts: bigint; recharges: bigint; gifts: bigint; ledger: bigint }[]>`
        WITH days AS (
          SELECT generate_series(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz - INTERVAL '1 second', INTERVAL '1 day')::date AS d
        )
        SELECT d AS day,
          (SELECT COUNT(*) FROM "User" u WHERE u."createdAt"::date = d) AS "newUsers",
          (SELECT COALESCE(SUM(b.amount),0) FROM "Bet" b WHERE b."createdAt"::date = d) AS bets,
          (SELECT COALESCE(SUM(p.amount),0) FROM "Payout" p WHERE p."createdAt"::date = d) AS payouts,
          (SELECT COALESCE(SUM(r.amount),0) FROM "Recharge" r WHERE r."createdAt"::date = d AND r.status = 'succeeded') AS recharges,
          (SELECT COALESCE(SUM(g."totalPrice"),0) FROM "GiftTransaction" g WHERE g."createdAt"::date = d) AS gifts,
          (SELECT COUNT(*) FROM "LedgerEntry" l WHERE l."createdAt"::date = d) AS ledger
        FROM days d ORDER BY d`,
      // Recent activity — bounded fetches (last 10 each), merged + sorted client-side is heavy
      // so we use a UNION ALL bounded to 12 most-recent records overall.
      prisma.$queryRaw<{ id: bigint; ts: Date; category: string; label: string; status: string | null; actor: string | null }[]>`
        (SELECT l.id::bigint, l."createdAt" AS ts, 'audit'::text AS category,
           CONCAT(l.action, ' · ', l.entity) AS label, NULL::text AS status,
           a.username AS actor
         FROM "AuditLog" l LEFT JOIN "AdminUser" a ON a.id = l."adminId"
         ORDER BY l.id DESC LIMIT 6)
        UNION ALL
        (SELECT e.id::bigint, e."createdAt" AS ts, 'security'::text AS category,
           LEFT(e.kind || ' — ' || e.message, 160) AS label, NULL::text AS status,
           NULL::text AS actor
         FROM "SecurityEvent" e ORDER BY e.id DESC LIMIT 3)
        UNION ALL
        (SELECT r.id::bigint, r."createdAt" AS ts, 'recharge'::text AS category,
           CONCAT('Recharge ', r.amount, ' coins') AS label, r.status,
           u."displayName" AS actor
         FROM "Recharge" r LEFT JOIN "User" u ON u.id = r."userId"
         ORDER BY r.id DESC LIMIT 4)
        UNION ALL
        (SELECT b.id::bigint, b."createdAt" AS ts, 'bet'::text AS category,
           CONCAT('Bet ', b.amount, ' · ', g.code) AS label, b.status,
           u."displayName" AS actor
         FROM "Bet" b LEFT JOIN "User" u ON u.id = b."userId" LEFT JOIN "Game" g ON g.id = b."gameKey"
         ORDER BY b.id DESC LIMIT 4)
        ORDER BY ts DESC LIMIT 12`,
    ]);

    // ----------------------------------------------------------------------
    // Compose KPI cards
    // ----------------------------------------------------------------------
    const kpis = {
      users: {
        total: totalUsers,
        newInPeriod: newUsersInPeriod,
        previousPeriod: newUsersPrev,
        deltaPct: pctDelta(newUsersInPeriod, newUsersPrev),
        link: "/users",
        available: true,
      },
      // "Active users" defined as users with at least one ledger entry in the
      // selected period. This is a real, queryable activity metric that does
      // not require online-presence infrastructure (LiveKit presence is not
      // surfaced in the existing schema). The label on the frontend will
      // explain the metric explicitly.
      activeUsers: {
        value: ledgerInPeriod,
        previousPeriod: ledgerPrev,
        deltaPct: pctDelta(ledgerInPeriod, ledgerPrev),
        label: "Users with at least one wallet transaction in the selected period.",
        link: "/wallet",
        available: true,
      },
      agencies: {
        total: totalAgencies,
        newInPeriod: newAgenciesInPeriod,
        previousPeriod: newAgenciesPrev,
        deltaPct: pctDelta(newAgenciesInPeriod, newAgenciesPrev),
        link: "/users",
        available: true,
      },
      liveRooms: {
        activeNow: activeRooms,
        total: totalRooms,
        openedInPeriod: roomsOpenedInPeriod,
        closedInPeriod: roomsClosedInPeriod,
        link: "/live",
        available: true,
      },
      games: {
        total: gamesTotal,
        active: gamesActive,
        maintenance: gamesMaintenance,
        disabled: gamesDisabled,
        link: "/games",
        available: true,
      },
      walletTx: {
        totalInPeriod: ledgerInPeriod,
        previousPeriod: ledgerPrev,
        deltaPct: pctDelta(ledgerInPeriod, ledgerPrev),
        rechargesSucceeded: rechargesAgg._count,
        rechargesFailed: rechargesFailed,
        link: "/wallet",
        available: true,
      },
      providers: {
        total: providersTotal,
        enabled: providersEnabled,
        // We do NOT label a provider healthy just because it's configured.
        // The only operational signal in the schema is "did it emit any
        // API error in the last 24h" — surfaced as `errors24h`.
        errors24h: Number(providersWithErrors[0]?.cnt ?? 0),
        link: "/providers",
        available: true,
      },
    };

    // ----------------------------------------------------------------------
    // Financial summary — canonical records only, no double-counting.
    //
    //  bets     = SUM(Bet.amount) where createdAt in [from,to)  — gross stakes
    //  payouts  = SUM(Payout.amount) where createdAt in [from,to) — game winnings
    //             (Payout is a separate row created on settlement, so a Bet's
    //              lifetime is not double-counted when filtering by createdAt)
    //  gifts    = SUM(GiftTransaction.totalPrice) — gross gift volume
    //  recharges = SUM(Recharge.amount) WHERE status = 'succeeded'
    //              (pending/failed/refunded are excluded from the deposit total)
    //  refunds  = SUM(Refund.amount) — count and amount of refunded recharges
    //  netGaming = bets - payouts (house coin margin, NOT profit)
    //
    // Platform revenue/commission is intentionally NOT computed here — the
    // existing accounting model represents provider commission via
    // ProviderBill (settled in `/v1/admin/settlement/...`), which is a
    // separate workflow. Computing it from raw bets would be misleading.
    // ----------------------------------------------------------------------
    const betsAmount = betsAgg._sum.amount ?? 0;
    const payoutsAmount = payoutsAgg._sum.amount ?? 0;
    const giftsAmount = giftsAgg._sum.totalPrice ?? 0;
    const rechargesAmount = rechargesAgg._sum.amount ?? 0;
    const refundsAmount = refundsAgg._sum.amount ?? 0;
    const betsAmountPrev = betsAggPrev._sum.amount ?? 0;
    const payoutsAmountPrev = payoutsAggPrev._sum.amount ?? 0;
    const giftsAmountPrev = giftsAggPrev._sum.totalPrice ?? 0;
    const rechargesAmountPrev = rechargesAggPrev._sum.amount ?? 0;
    const refundsAmountPrev = refundsAggPrev._sum.amount ?? 0;

    const financial = {
      currency: "coins",
      bets: { count: betsAgg._count, amount: betsAmount, prevAmount: betsAmountPrev, deltaPct: pctDelta(betsAmount, betsAmountPrev) },
      payouts: { count: payoutsAgg._count, amount: payoutsAmount, prevAmount: payoutsAmountPrev, deltaPct: pctDelta(payoutsAmount, payoutsAmountPrev) },
      gifts: { count: giftsAgg._count, amount: giftsAmount, prevAmount: giftsAmountPrev, deltaPct: pctDelta(giftsAmount, giftsAmountPrev) },
      recharges: { count: rechargesAgg._count, amount: rechargesAmount, prevAmount: rechargesAmountPrev, deltaPct: pctDelta(rechargesAmount, rechargesAmountPrev), failed: rechargesFailed },
      refunds: { count: refundsAgg._count, amount: refundsAmount, prevAmount: refundsAmountPrev, deltaPct: pctDelta(refundsAmount, refundsAmountPrev) },
      netGaming: { amount: betsAmount - payoutsAmount, prevAmount: betsAmountPrev - payoutsAmountPrev, note: "Bets minus payouts (house coin margin). Not platform profit." },
    };

    // ----------------------------------------------------------------------
    // Operational alerts — derived from real records only, no fabricated
    // thresholds. Severity is assigned by a small, documented rule set:
    //   Critical: high-severity suspicious events in the period
    //   Warning:  provider API errors in last 24h, unresolved complaints,
    //             failed recharges in the period
    //   Info:     games in maintenance, total security events
    // ----------------------------------------------------------------------
    const alerts: { id: string; severity: "info" | "warning" | "critical"; title: string; detail: string; ts: string; link: string | null }[] = [];
    if (suspiciousHighInPeriod > 0) {
      alerts.push({
        id: `suspicious-high-${range.label}`,
        severity: "critical",
        title: `${suspiciousHighInPeriod} high-severity suspicious event${suspiciousHighInPeriod === 1 ? "" : "s"}`,
        detail: "Logged by the suspicious-event detector during the selected period. Review before dismissing.",
        ts: new Date().toISOString(),
        link: "/security",
      });
    }
    if (Number(providersWithErrors[0]?.cnt ?? 0) > 0) {
      alerts.push({
        id: `provider-errors-24h`,
        severity: "warning",
        title: `Provider API errors in the last 24 hours`,
        detail: `${Number(providersWithErrors[0]?.cnt ?? 0)} provider-source error log entries in the last 24h. Inspect provider integration health.`,
        ts: new Date().toISOString(),
        link: "/providers",
      });
    }
    if (complaintsOpen > 0) {
      alerts.push({
        id: `complaints-open`,
        severity: "warning",
        title: `${complaintsOpen} open complaint${complaintsOpen === 1 ? "" : "s"}`,
        detail: "Complaints awaiting acknowledgement, investigation, or resolution.",
        ts: new Date().toISOString(),
        link: null, // No dedicated complaints page exists yet — link suppressed rather than broken.
      });
    }
    if (rechargesFailed > 0) {
      alerts.push({
        id: `recharges-failed-${range.label}`,
        severity: "warning",
        title: `${rechargesFailed} failed recharge${rechargesFailed === 1 ? "" : "s"} in the selected period`,
        detail: "Recharges whose status is `failed`. Failed recharges are excluded from the financial summary deposit total.",
        ts: new Date().toISOString(),
        link: "/wallet",
      });
    }
    if (gamesMaintenance > 0) {
      alerts.push({
        id: `games-maintenance`,
        severity: "info",
        title: `${gamesMaintenance} game${gamesMaintenance === 1 ? "" : "s"} in maintenance`,
        detail: "Games whose status is `maintenance` are unavailable for play.",
        ts: new Date().toISOString(),
        link: "/games",
      });
    }
    if (apiErrorsInPeriod > 0) {
      alerts.push({
        id: `api-errors-${range.label}`,
        severity: "info",
        title: `${apiErrorsInPeriod} API error${apiErrorsInPeriod === 1 ? "" : "s"} logged in the selected period`,
        detail: "Aggregated across all sources (admin, provider, webhooks).",
        ts: new Date().toISOString(),
        link: "/security",
      });
    }

    // ----------------------------------------------------------------------
    // Series — daily activity, normalised to ISO date strings.
    // ----------------------------------------------------------------------
    const series = seriesRows.map((s) => ({
      day: new Date(s.day).toISOString().slice(0, 10),
      newUsers: Number(s.newUsers),
      bets: Number(s.bets),
      payouts: Number(s.payouts),
      recharges: Number(s.recharges),
      gifts: Number(s.gifts),
      ledger: Number(s.ledger),
    }));

    // ----------------------------------------------------------------------
    // Recent activity — already merged + bounded to 12 rows server-side.
    // ----------------------------------------------------------------------
    const activity = recentAudit.map((r) => ({
      id: String(r.id),
      ts: r.ts.toISOString(),
      category: r.category,
      label: r.label,
      status: r.status,
      actor: r.actor,
    }));

    // ----------------------------------------------------------------------
    // Legacy `totals` shape (preserved for back-compat with any consumer
    // still using the old `/v1/admin/dashboard` contract).
    // ----------------------------------------------------------------------
    const totals = {
      betsCount: betsAgg._count,
      betsAmount,
      winsCount: payoutsAgg._count,
      winsAmount: payoutsAmount,
      revenue: betsAmount - payoutsAmount,
      giftsAmount,
      recharges: rechargesAmount,
      activeRooms,
      newUsers24h: newUsersInPeriod,
      apiErrors24h: apiErrorsInPeriod,
    };

    return {
      ok: true,
      data: {
        totals,
        range: { from: from.toISOString(), to: to.toISOString(), preset: q.preset ?? "last30", label: range.label },
        generatedAt: new Date().toISOString(),
        currency: "coins",
        ledgerKinds: LEDGER_KINDS,
        kpis,
        financial,
        series,
        activity,
        alerts,
      },
    };
  });

  // --- Users ---------------------------------------------------------------
  //
  // The full user-management module (Prompt 03). The list endpoint accepts
  // the same pagination+search contract as before, but adds:
  //   - status filter (active | restricted | banned | muted | frozen)
  //   - country filter
  //   - agency filter
  //   - registration-date range filter (YYYY-MM-DD)
  //   - hasRestriction filter
  //   - safe sort whitelist
  //   - masking of contact info when the admin lacks `players.read`
  //   - account-status derivation from the live PlayerRestriction table
  //
  // Permission model:
  //   - `users.read` is required to call this endpoint at all.
  //   - `wallet.read` gates the `balance` field (returns null otherwise).
  //   - `players.read` gates unmasked phone/email (returns masked otherwise).
  //
  // The endpoint NEVER returns passwordHash, tokens, or full contact info
  // to admins who lack the relevant permission.
  app.get("/v1/admin/users/summary", async (req) => {
    await requireAdmin(req, "users.read");
    const now = new Date();
    const last7d = new Date(now.getTime() - 7 * 86_400_000);
    const last30d = new Date(now.getTime() - 30 * 86_400_000);
    const [totalUsers, newUsers7d, newUsers30d, banned, muted, frozen, restrictedAny] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: last7d } } }),
      prisma.user.count({ where: { createdAt: { gte: last30d } } }),
      prisma.playerRestriction.count({ where: { type: "ban", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.playerRestriction.count({ where: { type: "mute", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.playerRestriction.count({ where: { type: "freeze_wallet", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      prisma.playerRestriction.count({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    ]);
    return {
      ok: true,
      data: {
        totalUsers,
        newUsers7d,
        newUsers30d,
        // "Active" = total minus currently-restricted accounts.
        active: Math.max(0, totalUsers - restrictedAny),
        restricted: restrictedAny,
        banned,
        muted,
        frozen,
      },
    };
  });

  app.get("/v1/admin/users", async (req) => {
    const admin = await requireAdmin(req, "users.read");
    const q = validate(userListQuerySchema, queryOf(req));
    const canViewContact = admin.role.permissions.some((p) => p.permission.key === "players.read");
    const canViewWallet = admin.role.permissions.some((p) => p.permission.key === "wallet.read");

    // Compose the where clause from validated filters.
    const where: Prisma.UserWhereInput = {};
    if (q.search) {
      // Numeric search → by id; otherwise by displayName / phone / email (contains).
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) {
        where.id = asNum;
      } else {
        where.OR = [
          { displayName: { contains: q.search, mode: "insensitive" } },
          { phone: { contains: q.search } },
          { email: { contains: q.search, mode: "insensitive" } },
        ];
      }
    }
    if (q.country) where.country = q.country.toUpperCase();
    if (q.agencyId) where.agencyId = q.agencyId;
    if (q.registeredFrom || q.registeredTo) {
      where.createdAt = {};
      if (q.registeredFrom) where.createdAt.gte = new Date(`${q.registeredFrom}T00:00:00.000Z`);
      // registeredTo is inclusive — roll forward one day so the user's
      // "to" day is included.
      if (q.registeredTo) {
        const t = new Date(`${q.registeredTo}T00:00:00.000Z`);
        t.setUTCDate(t.getUTCDate() + 1);
        where.createdAt.lt = t;
      }
    }

    // Status filter requires a join to PlayerRestriction. We translate the
    // user-facing status enum into a `restrictions.some` predicate.
    if (q.status || q.hasRestriction) {
      const now = new Date();
      const activeWindow = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
      if (q.status === "banned") where.restrictions = { some: { type: "ban", ...activeWindow } };
      else if (q.status === "muted") where.restrictions = { some: { type: "mute", ...activeWindow } };
      else if (q.status === "frozen") where.restrictions = { some: { type: "freeze_wallet", ...activeWindow } };
      else if (q.status === "restricted") where.restrictions = { some: { ...activeWindow } };
      else if (q.status === "active") where.restrictions = { none: { ...activeWindow } };
      if (q.hasRestriction === "true") where.restrictions = { some: { ...activeWindow } };
      else if (q.hasRestriction === "false") where.restrictions = { none: { ...activeWindow } };
    }

    // Safe sort whitelist (prevents arbitrary column sort = info disclosure).
    const sortWhitelist = ["id", "displayName", "country", "createdAt", "vipLevel", "nobleLevel"];
    const sortBy = q.sortBy && sortWhitelist.includes(q.sortBy) ? q.sortBy : "id";
    const orderBy = { [sortBy]: q.sortDir } as const;

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          wallet: { select: { balance: true, frozen: true } },
          agency: { select: { id: true, name: true } },
          restrictions: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { type: true, expiresAt: true, reason: true } },
        },
      }),
    ]);

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((u) => {
          // Derive the account-status label from the live restrictions.
          const activeRestrictions = u.restrictions;
          const status = activeRestrictions.some((r) => r.type === "ban") ? "banned"
            : activeRestrictions.some((r) => r.type === "freeze_wallet") ? "frozen"
            : activeRestrictions.some((r) => r.type === "mute") ? "muted"
            : activeRestrictions.length > 0 ? "restricted"
            : "active";
          return {
            id: u.id,
            displayName: u.displayName,
            avatarUrl: u.avatarUrl || "",
            // Mask contact info unless the admin has players.read.
            phone: canViewContact ? u.phone : maskContact(u.phone),
            email: canViewContact ? u.email : maskContact(u.email),
            marketCode: u.marketCode,
            country: u.country,
            vipLevel: u.vipLevel,
            nobleLevel: u.nobleLevel,
            // Balance is null when wallet.read is missing (frontend shows "—").
            balance: canViewWallet ? (u.wallet?.balance ?? 0) : null,
            walletFrozen: u.wallet?.frozen ?? false,
            agencyId: u.agency?.id ?? null,
            agency: u.agency?.name ?? null,
            status,
            restrictions: activeRestrictions.map((r) => ({ type: r.type, reason: r.reason, expiresAt: r.expiresAt?.toISOString() ?? null })),
            createdAt: u.createdAt.toISOString(),
          };
        }),
      },
    };
  });

  /**
   * Full user profile — the User Detail page data source. All activity
   * sections are fetched with bounded `take` (no full-table scans into
   * memory) and permission-gated per section.
   *
   * Sections:
   *   - profile          — always returned (subject to users.read)
   *   - wallet           — only when caller has wallet.read
   *   - bets / sessions  — only when caller has rounds.read
   *   - live / gifts     — only when caller has rooms.read
   *   - complaints       — only when caller has players.read
   *   - restrictions     — always (subject to users.read)
   *   - adminNotes       — only when caller has users.write
   *   - auditHistory    — only when caller has security.read
   */
  app.get("/v1/admin/users/:id", async (req) => {
    const admin = await requireAdmin(req, "users.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const canViewContact = admin.role.permissions.some((p) => p.permission.key === "players.read");
    const canViewWallet = admin.role.permissions.some((p) => p.permission.key === "wallet.read");
    const canViewRounds = admin.role.permissions.some((p) => p.permission.key === "rounds.read");
    const canViewRooms = admin.role.permissions.some((p) => p.permission.key === "rooms.read");
    const canViewSecurity = admin.role.permissions.some((p) => p.permission.key === "security.read");
    const canViewNotes = admin.role.permissions.some((p) => p.permission.key === "users.write");

    // Always include agency + restrictions + wallet. Wallet fields are
    // masked-out below if the caller lacks wallet.read. (Conditional include
    // would narrow the TS type and lose the wallet relation — so we always
    // fetch and redact.)
    //
    // Note: PlayerRestriction has only `createdBy Int` (no relation to
    // AdminUser in the existing schema), so we don't include a creator
    // join here. If future work adds the relation, re-enable it.
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        wallet: { select: { balance: true, frozen: true, updatedAt: true } },
        agency: { select: { id: true, name: true, code: true } },
        restrictions: { orderBy: { id: "desc" }, take: 50 },
      },
    });
    if (!user) throw notFound("user not found");

    // Parallel bounded fetches — only run the ones the caller is allowed to see.
    const [bets, sessions, ledgerRecent, gifts, complaints, roomParticipations, roomsCreated, adminNotes, auditHistory] = await Promise.all([
      canViewRounds
        ? prisma.bet.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 20, include: { game: { select: { code: true, name: true } }, round: { select: { roundId: true, status: true, startedAt: true, endedAt: true } } } })
        : Promise.resolve([]),
      canViewRounds
        ? prisma.gameSession.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 20, include: { game: { select: { code: true, name: true } } } })
        : Promise.resolve([]),
      canViewWallet
        ? prisma.ledgerEntry.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 15, select: { id: true, kind: true, amount: true, balanceAfter: true, txKey: true, createdAt: true } })
        : Promise.resolve([]),
      canViewRooms
        ? prisma.giftTransaction.findMany({ where: { OR: [{ senderId: id }, { recipientId: id }] }, orderBy: { id: "desc" }, take: 15, include: { gift: { select: { name: true } }, sender: { select: { id: true, displayName: true } }, recipient: { select: { id: true, displayName: true } } } })
        : Promise.resolve([]),
      canViewContact
        ? prisma.complaint.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 20 })
        : Promise.resolve([]),
      canViewRooms
        ? prisma.roomParticipant.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 20, include: { room: { select: { id: true, title: true, type: true, closedAt: true } } } })
        : Promise.resolve([]),
      canViewRooms
        ? prisma.room.findMany({ where: { hostId: id }, orderBy: { id: "desc" }, take: 10, select: { id: true, title: true, type: true, createdAt: true, closedAt: true } })
        : Promise.resolve([]),
      canViewNotes
        ? prisma.adminNote.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 50, include: { admin: { select: { id: true, username: true, displayName: true } } } })
        : Promise.resolve([]),
      canViewSecurity
        ? prisma.auditLog.findMany({ where: { entity: "user", entityId: String(id) }, orderBy: { id: "desc" }, take: 30, include: { admin: { select: { id: true, username: true, displayName: true } } } })
        : Promise.resolve([]),
    ]);

    // Wallet totals — credits are positive ledger amounts, debits are negative.
    // Use Prisma `aggregate` (single-row aggregation) instead of groupBy.
    let credits = 0;
    let debits = 0;
    let ledgerSum = 0;
    if (canViewWallet) {
      const creditsAgg = await prisma.ledgerEntry.aggregate({ where: { userId: id, amount: { gt: 0 } }, _sum: { amount: true } });
      credits = creditsAgg._sum.amount ?? 0;
      const debitsAgg = await prisma.ledgerEntry.aggregate({ where: { userId: id, amount: { lt: 0 } }, _sum: { amount: true } });
      debits = Math.abs(debitsAgg._sum.amount ?? 0);
      const totalAgg = await prisma.ledgerEntry.aggregate({ where: { userId: id }, _sum: { amount: true } });
      ledgerSum = totalAgg._sum.amount ?? 0;
    }

    return {
      ok: true,
      data: {
        profile: {
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl || "",
          phone: canViewContact ? user.phone : maskContact(user.phone),
          email: canViewContact ? user.email : maskContact(user.email),
          marketCode: user.marketCode,
          country: user.country,
          vipLevel: user.vipLevel,
          nobleLevel: user.nobleLevel,
          isBot: user.isBot,
          agency: user.agency ? { id: user.agency.id, name: user.agency.name, code: user.agency.code } : null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
          // Contact-masked flag so the UI can show a "masked" indicator.
          contactMasked: !canViewContact,
        },
        restrictions: user.restrictions.map((r) => ({
          id: r.id,
          type: r.type,
          reason: r.reason,
          expiresAt: r.expiresAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          createdBy: r.createdBy,
          // creator info would require a relation on PlayerRestriction — currently just an int.
          creator: null,
        })),
        wallet: canViewWallet
          ? {
              balance: user.wallet?.balance ?? 0,
              frozen: user.wallet?.frozen ?? false,
              updatedAt: user.wallet?.updatedAt?.toISOString() ?? null,
              totalCredits: credits,
              totalDebits: debits,
              // LedgerEntry.id is BigInt — Fastify's JSON serializer can't
              // stringify BigInt by default, so we map each entry's id to
              // a string before sending. (Matches the existing /wallet/ledger
              // endpoint's `id: e.id.toString()` convention.)
              ledgerRecent: ledgerRecent.map((e) => ({ ...e, id: e.id.toString(), createdAt: e.createdAt.toISOString() })),
            }
          : null,
        bets: canViewRounds ? bets : [],
        sessions: canViewRounds ? sessions : [],
        gifts: canViewRooms ? gifts : [],
        complaints: canViewContact ? complaints : [],
        roomParticipations: canViewRooms ? roomParticipations : [],
        roomsCreated: canViewRooms ? roomsCreated : [],
        adminNotes,
        auditHistory,
        // Permission flags so the frontend can show/hide sections without
        // a second round-trip.
        perms: {
          canViewWallet,
          canViewRounds,
          canViewRooms,
          canViewContact,
          canViewSecurity,
          canViewNotes,
          canEdit: admin.role.permissions.some((p) => p.permission.key === "users.write"),
          canRestrict: admin.role.permissions.some((p) => p.permission.key === "players.write"),
          canWalletWrite: admin.role.permissions.some((p) => p.permission.key === "wallet.write"),
        },
        // sumAmount kept for back-compat; equal to (credits - debits).
        ledgerSum,
      },
    };
  });

  /**
   * Edit safe profile fields. Excludes password/phone/email — those go
   * through the auth flows (registration, OTP, password reset) and must
   * NOT be edited from the admin panel directly.
   */
  app.put("/v1/admin/users/:id", async (req) => {
    const admin = await requireAdmin(req, "users.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(userUpdateSchema, bodyOf(req));
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw notFound("user not found");
    // Validate agency if provided.
    if (input.agencyId) {
      const agency = await prisma.agency.findUnique({ where: { id: input.agencyId } });
      if (!agency) throw badRequest("unknown agency");
    }
    const after = await prisma.user.update({ where: { id }, data: input });
    await writeAudit({ adminId: admin.id, req, action: "update_profile", entity: "user", entityId: id, before: { displayName: before.displayName, country: before.country, agencyId: before.agencyId, vipLevel: before.vipLevel, nobleLevel: before.nobleLevel, avatarUrl: before.avatarUrl }, after: { displayName: after.displayName, country: after.country, agencyId: after.agencyId, vipLevel: after.vipLevel, nobleLevel: after.nobleLevel, avatarUrl: after.avatarUrl } });
    return { ok: true, data: { id: after.id, displayName: after.displayName, country: after.country, agencyId: after.agencyId, vipLevel: after.vipLevel, nobleLevel: after.nobleLevel, avatarUrl: after.avatarUrl } };
  });

  /**
   * Apply (or replace) a restriction. Idempotent: if the user already has an
   * active restriction of the same type, we lift the old one and write a new
   * one with the new expiry/reason — preventing duplicate bans.
   */
  app.post("/v1/admin/users/:id/restrict", async (req) => {
    const admin = await requireAdmin(req, "players.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      type: z.enum(RESTRICTION_TYPES),
      reason: z.string().trim().min(1).max(200),
      durationDays: z.coerce.number().int().min(1).max(3650).optional(),
      note: z.string().trim().max(500).optional(),
    }), bodyOf(req));

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound("user not found");

    // Lift any existing active restriction of the same type (idempotent).
    await prisma.playerRestriction.updateMany({
      where: { userId: id, type: input.type, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      data: { expiresAt: new Date() },
    });

    const expiresAt = input.durationDays
      ? new Date(Date.now() + input.durationDays * 86_400_000)
      : null;

    const restriction = await prisma.playerRestriction.create({
      data: {
        userId: id,
        type: input.type,
        reason: input.reason,
        createdBy: admin.id,
        expiresAt,
      },
    });

    await writeAudit({
      adminId: admin.id, req,
      action: `restrict_${input.type}`,
      entity: "user", entityId: id,
      after: { restrictionId: restriction.id, type: input.type, reason: input.reason, expiresAt: expiresAt?.toISOString() ?? null, note: input.note ?? "" },
    });

    return { ok: true, data: { id: restriction.id, type: restriction.type, reason: restriction.reason, expiresAt: restriction.expiresAt?.toISOString() ?? null } };
  });

  /** Lift (revoke) a specific restriction by id. */
  app.delete("/v1/admin/users/:id/restrictions/:rid", async (req) => {
    const admin = await requireAdmin(req, "players.write");
    const { id, rid } = validate(z.object({ id: z.coerce.number(), rid: z.coerce.number() }), paramsOf(req));
    const before = await prisma.playerRestriction.findUnique({ where: { id: rid } });
    if (!before) throw notFound("restriction not found");
    if (before.userId !== id) throw badRequest("restriction does not belong to this user");
    // Soft-delete by setting expiresAt to now — preserves the audit trail
    // (we never hard-delete restrictions).
    await prisma.playerRestriction.update({ where: { id: rid }, data: { expiresAt: new Date() } });
    await writeAudit({ adminId: admin.id, req, action: `lift_${before.type}`, entity: "user", entityId: id, before: { restrictionId: rid, type: before.type, reason: before.reason } });
    return { ok: true };
  });

  // --- Admin notes --------------------------------------------------------
  app.get("/v1/admin/users/:id/notes", async (req) => {
    await requireAdmin(req, "users.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound("user not found");
    const notes = await prisma.adminNote.findMany({
      where: { userId: id },
      orderBy: { id: "desc" },
      take: 100,
      include: { admin: { select: { id: true, username: true, displayName: true } } },
    });
    return { ok: true, data: notes };
  });

  app.post("/v1/admin/users/:id/notes", async (req) => {
    const admin = await requireAdmin(req, "users.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(adminNoteSchema, bodyOf(req));
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw notFound("user not found");
    const note = await prisma.adminNote.create({
      data: {
        userId: id,
        adminId: admin.id,
        category: input.category,
        body: input.body,
        internal: input.internal,
      },
    });
    await writeAudit({ adminId: admin.id, req, action: "add_note", entity: "user", entityId: id, after: { noteId: note.id, category: note.category } });
    return { ok: true, data: note };
  });

  app.delete("/v1/admin/users/:id/notes/:nid", async (req) => {
    const admin = await requireAdmin(req, "users.write");
    const { id, nid } = validate(z.object({ id: z.coerce.number(), nid: z.coerce.number() }), paramsOf(req));
    const before = await prisma.adminNote.findUnique({ where: { id: nid } });
    if (!before) throw notFound("note not found");
    if (before.userId !== id) throw badRequest("note does not belong to this user");
    await prisma.adminNote.delete({ where: { id: nid } });
    await writeAudit({ adminId: admin.id, req, action: "delete_note", entity: "user", entityId: id, before: { noteId: nid, category: before.category } });
    return { ok: true };
  });

  /**
   * CSV export of the filtered user list. Permission-gated per field:
   *   - balance column omitted unless caller has wallet.read
   *   - phone/email columns masked unless caller has players.read
   *   - hard cap of 5000 rows
   *   - spreadsheet-formula-injection sanitization (=, +, -, @, tab, CR)
   */
  app.get("/v1/admin/users/export", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const admin = await requireAdmin(req, "users.read");
    const q = validate(userListQuerySchema, queryOf(req));
    const canViewContact = admin.role.permissions.some((p) => p.permission.key === "players.read");
    const canViewWallet = admin.role.permissions.some((p) => p.permission.key === "wallet.read");

    // Reuse the same where-clause builder as the list endpoint.
    const where: Prisma.UserWhereInput = {};
    if (q.search) {
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) where.id = asNum;
      else where.OR = [
        { displayName: { contains: q.search, mode: "insensitive" } },
        { phone: { contains: q.search } },
        { email: { contains: q.search, mode: "insensitive" } },
      ];
    }
    if (q.country) where.country = q.country.toUpperCase();
    if (q.agencyId) where.agencyId = q.agencyId;
    if (q.registeredFrom || q.registeredTo) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (q.registeredFrom) createdAtFilter.gte = new Date(`${q.registeredFrom}T00:00:00.000Z`);
      if (q.registeredTo) {
        const t = new Date(`${q.registeredTo}T00:00:00.000Z`);
        t.setUTCDate(t.getUTCDate() + 1);
        createdAtFilter.lt = t;
      }
      where.createdAt = createdAtFilter;
    }
    if (q.status) {
      const now = new Date();
      const w: Prisma.PlayerRestrictionWhereInput = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
      if (q.status === "banned") where.restrictions = { some: { type: "ban", ...w } };
      else if (q.status === "muted") where.restrictions = { some: { type: "mute", ...w } };
      else if (q.status === "frozen") where.restrictions = { some: { type: "freeze_wallet", ...w } };
      else if (q.status === "restricted") where.restrictions = { some: { ...w } };
      else if (q.status === "active") where.restrictions = { none: { ...w } };
    }

    const rows = await prisma.user.findMany({
      where,
      orderBy: { id: "asc" },
      take: 5000,
      include: {
        wallet: canViewWallet ? { select: { balance: true } } : false,
        agency: { select: { name: true } },
      },
    });

    const headers = ["id", "displayName", "country", "marketCode", "agency", "vipLevel", "createdAt"];
    if (canViewContact) headers.push("phone", "email");
    if (canViewWallet) headers.push("balance");

    const escape = (v: unknown): string => {
      let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      // Spreadsheet formula-injection defence: prefix with a single quote
      // if the cell starts with =, +, -, @, tab (0x09), or CR (0x0D).
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      // Quote any cell containing comma, quote, or newline.
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const lines = [
      headers.join(","),
      ...rows.map((u) => headers.map((h) => {
        switch (h) {
          case "id": return escape(u.id);
          case "displayName": return escape(u.displayName);
          case "country": return escape(u.country);
          case "marketCode": return escape(u.marketCode);
          case "agency": return escape(u.agency?.name ?? "");
          case "vipLevel": return escape(u.vipLevel);
          case "createdAt": return escape(u.createdAt.toISOString());
          case "phone": return escape(canViewContact ? (u.phone ?? "") : maskContact(u.phone) ?? "");
          case "email": return escape(canViewContact ? (u.email ?? "") : maskContact(u.email) ?? "");
          case "balance": return escape(u.wallet?.balance ?? 0);
          default: return "";
        }
      }).join(",")),
    ];

    const csv = lines.join("\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="users-${stamp}.csv"`);
    reply.header("x-export-row-count", String(rows.length));
    return csv;
  });

  // --- Agencies ------------------------------------------------------------
  //
  // Full agency-management module (Prompt 04). The existing 3 endpoints
  // (list / create / patch) are preserved on their original paths but the
  // list endpoint now accepts filters + pagination, and the create / patch
  // endpoints use the new shared schemas. New endpoints:
  //   - GET    /v1/admin/agencies/summary        — KPI cards
  //   - GET    /v1/admin/agencies/:id            — full profile (5 sections)
  //   - POST   /v1/admin/agencies/:id/status     — activate / suspend
  //   - GET    /v1/admin/agencies/:id/members     — paginated members
  //   - POST   /v1/admin/agencies/:id/members     — assign user
  //   - DELETE /v1/admin/agencies/:id/members/:userId — remove member
  //   - GET    /v1/admin/agencies/:id/admins      — list agency admins
  //   - POST   /v1/admin/agencies/:id/admins      — assign existing admin
  //   - DELETE /v1/admin/agencies/:id/admins/:adminId — remove admin
  //   - GET    /v1/admin/agencies/export          — CSV export
  //
  // Permissions: every read uses `agencies.read`; every write uses
  // `agencies.write`. Agency-level admins (role `agency_admin`) only have
  // `agencies.read` + `wallet.read` by default — they cannot create, edit,
  // suspend, or assign through these endpoints. Cross-agency access is
  // prevented because these endpoints never filter by the caller's agencyId
  // — they are Super-Admin-only management endpoints.
  app.get("/v1/admin/agencies/summary", async (req) => {
    await requireAdmin(req, "agencies.read");
    const now = new Date();
    const last7d = new Date(now.getTime() - 7 * 86_400_000);
    const last30d = new Date(now.getTime() - 30 * 86_400_000);
    const [totalAgencies, activeAgencies, suspendedAgencies, totalMembers, newAgencies7d, newAgencies30d] = await Promise.all([
      prisma.agency.count(),
      prisma.agency.count({ where: { active: true } }),
      prisma.agency.count({ where: { active: false } }),
      prisma.agencyMember.count(),
      prisma.agency.count({ where: { createdAt: { gte: last7d } } }),
      prisma.agency.count({ where: { createdAt: { gte: last30d } } }),
    ]);
    return {
      ok: true,
      data: {
        totalAgencies,
        activeAgencies,
        suspendedAgencies,
        totalMembers,
        newAgencies7d,
        newAgencies30d,
        // No "pending" — there is no approval workflow in the existing
        // platform. Documented in the API response so the UI doesn't
        // render an empty card.
        hasApprovalWorkflow: false,
      },
    };
  });

  app.get("/v1/admin/agencies", async (req) => {
    await requireAdmin(req, "agencies.read");
    const q = validate(agencyListQuerySchema, queryOf(req));
    const where: Prisma.AgencyWhereInput = {};
    if (q.search) {
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) {
        where.id = asNum;
      } else {
        where.OR = [
          { name: { contains: q.search, mode: "insensitive" } },
          { code: { contains: q.search, mode: "insensitive" } },
        ];
      }
    }
    if (q.status === "active") where.active = true;
    else if (q.status === "suspended") where.active = false;
    if (q.country) where.country = q.country.toUpperCase();
    if (q.createdFrom || q.createdTo) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (q.createdFrom) createdAtFilter.gte = new Date(`${q.createdFrom}T00:00:00.000Z`);
      if (q.createdTo) {
        const t = new Date(`${q.createdTo}T00:00:00.000Z`);
        t.setUTCDate(t.getUTCDate() + 1);
        createdAtFilter.lt = t;
      }
      where.createdAt = createdAtFilter;
    }
    const sortWhitelist = ["id", "name", "code", "createdAt", "commissionRate"];
    const sortBy = q.sortBy && sortWhitelist.includes(q.sortBy) ? q.sortBy : "id";
    const orderBy = { [sortBy]: q.sortDir } as const;
    const [total, items] = await Promise.all([
      prisma.agency.count({ where }),
      prisma.agency.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { users: true, members: true, admins: true, children: true } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((a) => ({
          id: a.id,
          name: a.name,
          code: a.code,
          description: a.description,
          contactEmail: a.contactEmail,
          contactPhone: a.contactPhone,
          country: a.country,
          commissionRate: a.commissionRate,
          parentId: a.parentId,
          parent: a.parent ? { id: a.parent.id, name: a.parent.name } : null,
          active: a.active,
          status: a.active ? "active" : "suspended",
          memberCount: a._count.members,
          userCount: a._count.users,
          adminCount: a._count.admins,
          childCount: a._count.children,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      },
    };
  });

  app.post("/v1/admin/agencies", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const input = validate(agencyCreateSchema, bodyOf(req));
    // Enforce uniqueness of code BEFORE attempting insert (cleaner error).
    const existing = await prisma.agency.findUnique({ where: { code: input.code } });
    if (existing) throw badRequest("agency code already in use");
    if (input.parentId) {
      const parent = await prisma.agency.findUnique({ where: { id: input.parentId } });
      if (!parent) throw badRequest("unknown parent agency");
    }
    const agency = await prisma.agency.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description ?? "",
        contactEmail: input.contactEmail ?? "",
        contactPhone: input.contactPhone ?? "",
        country: (input.country ?? "XX").toUpperCase(),
        commissionRate: input.commissionRate,
        parentId: input.parentId ?? null,
      },
    });
    await writeAudit({ adminId: admin.id, req, action: "create", entity: "agency", entityId: agency.id, after: { name: agency.name, code: agency.code } });
    return { ok: true, data: { id: agency.id, name: agency.name, code: agency.code } };
  });

  app.get("/v1/admin/agencies/:id", async (req) => {
    await requireAdmin(req, "agencies.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const agency = await prisma.agency.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true, code: true } },
        children: { select: { id: true, name: true, code: true, active: true } },
        _count: { select: { users: true, members: true, admins: true, children: true, withdrawals: true } },
      },
    });
    if (!agency) throw notFound("agency not found");

    // Performance summary — only the metrics supported by the existing
    // schema. We do NOT invent revenue or commission totals; the only
    // agency-attributed financial records are `AgencyWithdrawal` rows.
    const last30d = new Date(Date.now() - 30 * 86_400_000);
    const [newMembers30d, activeAdmins, pendingWithdrawals, recentWithdrawals, auditHistory] = await Promise.all([
      prisma.agencyMember.count({ where: { agencyId: id, joinedAt: { gte: last30d } } }),
      prisma.adminUser.count({ where: { agencyId: id, active: true } }),
      prisma.agencyWithdrawal.count({ where: { agencyId: id, status: "pending" } }),
      prisma.agencyWithdrawal.findMany({ where: { agencyId: id }, orderBy: { id: "desc" }, take: 10 }),
      prisma.auditLog.findMany({ where: { entity: "agency", entityId: String(id) }, orderBy: { id: "desc" }, take: 30, include: { admin: { select: { id: true, username: true, displayName: true } } } }),
    ]);

    return {
      ok: true,
      data: {
        profile: {
          id: agency.id,
          name: agency.name,
          code: agency.code,
          description: agency.description,
          contactEmail: agency.contactEmail,
          contactPhone: agency.contactPhone,
          country: agency.country,
          commissionRate: agency.commissionRate,
          parentId: agency.parentId,
          parent: agency.parent,
          children: agency.children,
          active: agency.active,
          status: agency.active ? "active" : "suspended",
          createdAt: agency.createdAt.toISOString(),
          updatedAt: agency.updatedAt.toISOString(),
        },
        counts: {
          users: agency._count.users,
          members: agency._count.members,
          admins: agency._count.admins,
          children: agency._count.children,
          withdrawals: agency._count.withdrawals,
        },
        performance: {
          // Documented definitions — no invented revenue.
          newMembers30d,
          activeAdmins,
          pendingWithdrawals,
          commissionRate: agency.commissionRate,
          commissionNote: "Configured rate. Actual settlement happens via the ProviderBill workflow — not recomputed here.",
        },
        recentWithdrawals: recentWithdrawals.map((w) => ({
          id: w.id,
          amount: w.amount,
          status: w.status,
          note: w.note,
          createdAt: w.createdAt.toISOString(),
        })),
        auditHistory: auditHistory.map((a) => ({
          id: a.id,
          action: a.action,
          admin: a.admin ? { id: a.admin.id, username: a.admin.username, displayName: a.admin.displayName } : null,
          ip: a.ip,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    };
  });

  app.patch("/v1/admin/agencies/:id", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(agencyUpdateSchema, bodyOf(req));
    const before = await prisma.agency.findUnique({ where: { id } });
    if (!before) throw notFound("agency not found");
    if (input.parentId) {
      const parent = await prisma.agency.findUnique({ where: { id: input.parentId } });
      if (!parent) throw badRequest("unknown parent agency");
      if (input.parentId === id) throw badRequest("agency cannot be its own parent");
    }
    const agency = await prisma.agency.update({ where: { id }, data: input });
    await writeAudit({ adminId: admin.id, req, action: "update", entity: "agency", entityId: id, before: { name: before.name, description: before.description, contactEmail: before.contactEmail, contactPhone: before.contactPhone, country: before.country, commissionRate: before.commissionRate, parentId: before.parentId }, after: { name: agency.name, description: agency.description, contactEmail: agency.contactEmail, contactPhone: agency.contactPhone, country: agency.country, commissionRate: agency.commissionRate, parentId: agency.parentId } });
    return { ok: true, data: { id: agency.id, name: agency.name } };
  });

  /**
   * Status change (activate / suspend). Implemented as a dedicated endpoint
   * (not part of PATCH) so we can require a reason and produce a clean
   * audit trail entry with action=activate_agency / suspend_agency.
   *
   * Enforcement: the existing `Agency.active` boolean is the source of
   * truth. Agency-admin role permissions (`agencies.read` + `wallet.read`)
   * are unaffected — a suspended agency's admin can still log in and read,
   * but cannot create / edit / assign through these endpoints because
   * they all require `agencies.write`. The suspended state is a signal to
   * operators that the agency should not onboard new members; full
   * enforcement across mobile-app flows is documented as a future task.
   */
  app.post("/v1/admin/agencies/:id/status", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(agencyStatusChangeSchema, bodyOf(req));
    const before = await prisma.agency.findUnique({ where: { id } });
    if (!before) throw notFound("agency not found");
    const newActive = input.action === "activate";
    if (before.active === newActive) throw badRequest(`agency is already ${input.action === "activate" ? "active" : "suspended"}`);
    const after = await prisma.agency.update({ where: { id }, data: { active: newActive } });
    await writeAudit({
      adminId: admin.id, req,
      action: input.action === "activate" ? "activate_agency" : "suspend_agency",
      entity: "agency", entityId: id,
      before: { active: before.active },
      after: { active: after.active, reason: input.reason },
    });
    return { ok: true, data: { id: after.id, active: after.active, status: after.active ? "active" : "suspended" } };
  });

  // --- Agency members ----------------------------------------------------
  app.get("/v1/admin/agencies/:id/members", async (req) => {
    await requireAdmin(req, "agencies.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const q = validate(paginationQuery, queryOf(req));
    const agency = await prisma.agency.findUnique({ where: { id }, select: { id: true } });
    if (!agency) throw notFound("agency not found");
    const where: Prisma.AgencyMemberWhereInput = { agencyId: id };
    if (q.search) {
      // Numeric search → by userId; otherwise by displayName via the user relation.
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) {
        where.userId = asNum;
      } else {
        where.user = { displayName: { contains: q.search, mode: "insensitive" } };
      }
    }
    const [total, items] = await Promise.all([
      prisma.agencyMember.count({ where }),
      prisma.agencyMember.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: {
            select: {
              id: true, displayName: true, avatarUrl: true, country: true,
              createdAt: true,
              wallet: { select: { balance: true, frozen: true } },
              restrictions: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { type: true } },
            },
          },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((m) => ({
          id: m.id,
          userId: m.user.id,
          displayName: m.user.displayName,
          avatarUrl: m.user.avatarUrl,
          country: m.user.country,
          joinedAt: m.joinedAt.toISOString(),
          userCreatedAt: m.user.createdAt.toISOString(),
          balance: m.user.wallet?.balance ?? null,
          walletFrozen: m.user.wallet?.frozen ?? false,
          status: m.user.restrictions.some((r) => r.type === "ban") ? "banned"
            : m.user.restrictions.some((r) => r.type === "freeze_wallet") ? "frozen"
            : m.user.restrictions.length > 0 ? "restricted" : "active",
        })),
      },
    };
  });

  /**
   * Assign a user to an agency. Creates an AgencyMember row; if the user
   * already has a `User.agencyId`, this does NOT change it — the two
   * relations are independent in the existing schema (User.agencyId is
   * the "primary agency"; AgencyMember is the membership roster). The
   * unique constraint (agencyId, userId) prevents duplicates.
   */
  app.post("/v1/admin/agencies/:id/members", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ userId: z.coerce.number().int().positive() }), bodyOf(req));
    const [agency, user] = await Promise.all([
      prisma.agency.findUnique({ where: { id }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, displayName: true, agencyId: true } }),
    ]);
    if (!agency) throw notFound("agency not found");
    if (!user) throw notFound("user not found");
    try {
      const member = await prisma.agencyMember.create({ data: { agencyId: id, userId: input.userId } });
      await writeAudit({ adminId: admin.id, req, action: "assign_member", entity: "agency", entityId: id, after: { userId: input.userId, memberId: member.id, userDisplayName: user.displayName } });
      return { ok: true, data: { id: member.id, agencyId: id, userId: input.userId, joinedAt: member.joinedAt.toISOString() } };
    } catch (e) {
      // P2002 = unique constraint violation → duplicate assignment.
      if ((e as { code?: string }).code === "P2002") throw badRequest("user is already a member of this agency");
      throw e;
    }
  });

  app.delete("/v1/admin/agencies/:id/members/:userId", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const { id, userId } = validate(z.object({ id: z.coerce.number(), userId: z.coerce.number() }), paramsOf(req));
    const before = await prisma.agencyMember.findUnique({ where: { agencyId_userId: { agencyId: id, userId } } });
    if (!before) throw notFound("membership not found");
    await prisma.agencyMember.delete({ where: { agencyId_userId: { agencyId: id, userId } } });
    await writeAudit({ adminId: admin.id, req, action: "remove_member", entity: "agency", entityId: id, before: { userId } });
    return { ok: true };
  });

  // --- Agency administrators ---------------------------------------------
  app.get("/v1/admin/agencies/:id/admins", async (req) => {
    await requireAdmin(req, "agencies.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const agency = await prisma.agency.findUnique({ where: { id }, select: { id: true } });
    if (!agency) throw notFound("agency not found");
    const admins = await prisma.adminUser.findMany({
      where: { agencyId: id },
      orderBy: { id: "asc" },
      include: { role: { select: { key: true, name: true } } },
    });
    return {
      ok: true,
      data: admins.map((a) => ({
        id: a.id,
        username: a.username,
        displayName: a.displayName,
        role: { key: a.role.key, name: a.role.name },
        active: a.active,
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });

  /**
   * Assign an EXISTING admin user to an agency. We do NOT create new admin
   * accounts here — admin creation goes through `POST /v1/admin/admin-users`
   * (existing endpoint, security.write gated) which now accepts an optional
   * `agencyId`. This endpoint just sets `AdminUser.agencyId`.
   *
   * Role boundary: we refuse to assign an admin whose role is `super_admin`
   * to an agency — super admins are platform-wide, not agency-scoped.
   */
  app.post("/v1/admin/agencies/:id/admins", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ adminId: z.coerce.number().int().positive() }), bodyOf(req));
    const [agency, target] = await Promise.all([
      prisma.agency.findUnique({ where: { id }, select: { id: true, name: true } }),
      prisma.adminUser.findUnique({ where: { id: input.adminId }, include: { role: { select: { key: true } } } }),
    ]);
    if (!agency) throw notFound("agency not found");
    if (!target) throw notFound("admin user not found");
    if (target.role.key === "super_admin") throw badRequest("super_admin cannot be assigned to a single agency");
    if (target.agencyId === id) throw badRequest("admin is already assigned to this agency");
    const before = { agencyId: target.agencyId };
    const after = await prisma.adminUser.update({ where: { id: input.adminId }, data: { agencyId: id } });
    await writeAudit({ adminId: admin.id, req, action: "assign_agency_admin", entity: "agency", entityId: id, before: { adminId: input.adminId, ...before }, after: { adminId: input.adminId, agencyId: after.agencyId } });
    return { ok: true, data: { adminId: input.adminId, agencyId: id } };
  });

  app.delete("/v1/admin/agencies/:id/admins/:adminId", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const { id, adminId } = validate(z.object({ id: z.coerce.number(), adminId: z.coerce.number() }), paramsOf(req));
    const target = await prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!target) throw notFound("admin user not found");
    if (target.agencyId !== id) throw badRequest("admin is not assigned to this agency");
    await prisma.adminUser.update({ where: { id: adminId }, data: { agencyId: null } });
    await writeAudit({ adminId: admin.id, req, action: "remove_agency_admin", entity: "agency", entityId: id, before: { adminId, agencyId: id }, after: { adminId, agencyId: null } });
    return { ok: true };
  });

  // --- Agency CSV export -------------------------------------------------
  app.get("/v1/admin/agencies/export", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const admin = await requireAdmin(req, "agencies.read");
    void admin;
    const q = validate(agencyListQuerySchema, queryOf(req));
    const where: Prisma.AgencyWhereInput = {};
    if (q.search) {
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) where.id = asNum;
      else where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { code: { contains: q.search, mode: "insensitive" } },
      ];
    }
    if (q.status === "active") where.active = true;
    else if (q.status === "suspended") where.active = false;
    if (q.country) where.country = q.country.toUpperCase();
    if (q.createdFrom || q.createdTo) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (q.createdFrom) createdAtFilter.gte = new Date(`${q.createdFrom}T00:00:00.000Z`);
      if (q.createdTo) {
        const t = new Date(`${q.createdTo}T00:00:00.000Z`);
        t.setUTCDate(t.getUTCDate() + 1);
        createdAtFilter.lt = t;
      }
      where.createdAt = createdAtFilter;
    }
    const rows = await prisma.agency.findMany({
      where,
      orderBy: { id: "asc" },
      take: 5000,
      include: { _count: { select: { users: true, members: true, admins: true } } },
    });
    const headers = ["id", "name", "code", "country", "commissionRate", "status", "memberCount", "adminCount", "createdAt"];
    const escape = (v: unknown): string => {
      let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      headers.join(","),
      ...rows.map((a) => headers.map((h) => {
        switch (h) {
          case "id": return escape(a.id);
          case "name": return escape(a.name);
          case "code": return escape(a.code);
          case "country": return escape(a.country);
          case "commissionRate": return escape(a.commissionRate);
          case "status": return escape(a.active ? "active" : "suspended");
          case "memberCount": return escape(a._count.members);
          case "adminCount": return escape(a._count.admins);
          case "createdAt": return escape(a.createdAt.toISOString());
          default: return "";
        }
      }).join(",")),
    ];
    const csv = lines.join("\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="agencies-${stamp}.csv"`);
    reply.header("x-export-row-count", String(rows.length));
    return csv;
  });

  /** Admin recharges a user's wallet on their behalf (agency panel action). */
  app.post("/v1/admin/users/:id/recharge", async (req) => {
    const admin = await requireAdmin(req, "wallet.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ amount: z.coerce.number().int().min(1), reason: z.string().max(200).optional() }), bodyOf(req));
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound("user not found");
    const adapter = getPaymentAdapter("fake");
    const charge = await adapter.createCharge({ userId: id, amount: input.amount });
    const recharge = await prisma.recharge.create({
      data: { userId: id, amount: input.amount, provider: "fake", externalId: charge.externalId, createdById: admin.id, meta: { reason: input.reason ?? "admin recharge" } as never },
    });
    const res = await postLedgerEntries([{ userId: id, kind: "recharge", amount: input.amount, txKey: `recharge:${recharge.id}`, refType: "recharge", refId: recharge.id, meta: { by: admin.username } }]);
    await writeAudit({ adminId: admin.id, req, action: "recharge", entity: "user", entityId: id, after: { amount: input.amount, rechargeId: recharge.id } });
    return { ok: true, data: { rechargeId: recharge.id, balance: res.balances[id] ?? 0 } };
  });

  /** Manual balance adjustment through the ledger (never a direct wallet write). */
  app.post("/v1/admin/users/:id/adjust", async (req) => {
    const admin = await requireAdmin(req, "wallet.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ amount: z.coerce.number().int().refine((v) => v !== 0), reason: z.string().min(3).max(200) }), bodyOf(req));
    const txKey = `adjust:${admin.id}:${crypto.randomUUID()}`;
    const res = await postLedgerEntries([{ userId: id, kind: "admin_adjust", amount: input.amount, txKey, meta: { by: admin.username, reason: input.reason } }]);
    await writeAudit({ adminId: admin.id, req, action: "adjust_balance", entity: "user", entityId: id, after: { amount: input.amount, reason: input.reason } });
    return { ok: true, data: { balance: res.balances[id] ?? 0 } };
  });

  // --- Rooms ---------------------------------------------------------------
  //
  // Live Room Monitoring & Moderation module (Prompt 05).
  //
  // Replaces the existing minimal room list + close endpoints with a full
  // monitoring system: summary KPIs, filtered/paginated room list, room
  // detail with participants + reports + event timeline, admin participant
  // moderation (kick / mute), room reports CRUD, room close with reason.
  //
  // Permissions:
  //   - rooms.read  — view room lists, details, participants, reports, events
  //   - rooms.write — close rooms, kick/mute participants, manage reports
  //
  // Real-time approach: polling with manual refresh (15s default). The
  // existing socket.io uses user JWT auth (not admin JWT), so adding admin
  // socket subscriptions would require a separate auth path — documented as
  // a future enhancement. Admin kick/mute actions DO emit socket.io events
  // to notify connected room participants in real time.
  app.get("/v1/admin/rooms/summary", async (req) => {
    await requireAdmin(req, "rooms.read");
    const [activeLive, activeVoice, activeParty, totalParticipants, openReports] = await Promise.all([
      prisma.room.count({ where: { closedAt: null, type: "live" } }),
      prisma.room.count({ where: { closedAt: null, type: "voice" } }),
      prisma.room.count({ where: { closedAt: null, type: "party" } }),
      prisma.roomParticipant.count({ where: { leftAt: null, kickedAt: null } }),
      prisma.roomReport.count({ where: { status: { in: ["open", "in_review"] } } }),
    ]);
    return {
      ok: true,
      data: {
        activeLiveRooms: activeLive,
        activeVoiceRooms: activeVoice,
        activePartyRooms: activeParty,
        totalActiveRooms: activeLive + activeVoice + activeParty,
        totalParticipants,
        openReports,
        // Documented gap: no real-time presence / heartbeat / stream-quality
        // metrics exist in the current schema.
        hasRealtimePresence: false,
        hasStreamHealthMetrics: false,
      },
    };
  });

  app.get("/v1/admin/rooms", async (req) => {
    await requireAdmin(req, "rooms.read");
    const q = validate(roomListQuerySchema, queryOf(req));
    const where: Prisma.RoomWhereInput = {};
    if (q.search) {
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) {
        where.id = asNum;
      } else {
        where.OR = [
          { title: { contains: q.search, mode: "insensitive" } },
          { host: { displayName: { contains: q.search, mode: "insensitive" } } },
        ];
      }
    }
    if (q.type) where.type = q.type;
    if (q.status === "active") where.closedAt = null;
    else if (q.status === "closed") where.closedAt = { not: null };
    if (q.hostId) where.hostId = q.hostId;
    if (q.createdFrom || q.createdTo) {
      const f: Prisma.DateTimeFilter = {};
      if (q.createdFrom) f.gte = new Date(`${q.createdFrom}T00:00:00.000Z`);
      if (q.createdTo) {
        const t = new Date(`${q.createdTo}T00:00:00.000Z`);
        t.setUTCDate(t.getUTCDate() + 1);
        f.lt = t;
      }
      where.createdAt = f;
    }
    if (q.hasReports === "true") where.reports = { some: { status: { in: ["open", "in_review"] } } };
    else if (q.hasReports === "false") where.reports = { none: { status: { in: ["open", "in_review"] } } };

    const sortWhitelist = ["id", "title", "type", "createdAt", "closedAt"];
    const sortBy = q.sortBy && sortWhitelist.includes(q.sortBy) ? q.sortBy : "id";
    const orderBy = { [sortBy]: q.sortDir } as const;

    const [total, items] = await Promise.all([
      prisma.room.count({ where }),
      prisma.room.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          host: { select: { id: true, displayName: true, avatarUrl: true } },
          _count: {
            select: {
              participants: { where: { leftAt: null, kickedAt: null } },
              reports: { where: { status: { in: ["open", "in_review"] } } },
            },
          },
        },
      }),
    ]);

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          slots: r.slots,
          country: r.country,
          hostId: r.hostId,
          host: r.host,
          isLocked: r.isLocked,
          closedAt: r.closedAt?.toISOString() ?? null,
          status: r.closedAt ? "closed" : "active",
          participantCount: r._count.participants,
          openReportCount: r._count.reports,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/admin/rooms/:id", async (req) => {
    await requireAdmin(req, "rooms.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        host: { select: { id: true, displayName: true, avatarUrl: true, country: true, vipLevel: true } },
        participants: {
          where: { leftAt: null, kickedAt: null },
          orderBy: { id: "asc" },
          include: {
            user: {
              select: {
                id: true, displayName: true, avatarUrl: true, country: true, vipLevel: true,
                restrictions: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { type: true, expiresAt: true } },
              },
            },
          },
        },
        _count: { select: { reports: true, events: true } },
      },
    });
    if (!room) throw notFound("room not found");

    const [openReports, recentEvents] = await Promise.all([
      prisma.roomReport.findMany({
        where: { roomId: id, status: { in: ["open", "in_review"] } },
        orderBy: { id: "desc" },
        take: 20,
        include: { room: { select: { id: true, title: true } } },
      }),
      prisma.roomEvent.findMany({
        where: { roomId: id },
        orderBy: { id: "desc" },
        take: 30,
      }),
    ]);

    return {
      ok: true,
      data: {
        profile: {
          id: room.id,
          title: room.title,
          type: room.type,
          slots: room.slots,
          country: room.country,
          hostId: room.hostId,
          host: room.host,
          isLocked: room.isLocked,
          livekitRoom: room.livekitRoom,
          status: room.closedAt ? "closed" : "active",
          closedAt: room.closedAt?.toISOString() ?? null,
          createdAt: room.createdAt.toISOString(),
        },
        participants: room.participants.map((p) => ({
          id: p.id,
          userId: p.user.id,
          displayName: p.user.displayName,
          avatarUrl: p.user.avatarUrl,
          country: p.user.country,
          vipLevel: p.user.vipLevel,
          role: p.role,
          slotIndex: p.slotIndex,
          muted: p.muted,
          joinedAt: p.joinedAt.toISOString(),
          restrictions: p.user.restrictions.map((r) => ({ type: r.type, expiresAt: r.expiresAt?.toISOString() ?? null })),
          userStatus: p.user.restrictions.some((r) => r.type === "ban") ? "banned"
            : p.user.restrictions.some((r) => r.type === "mute") ? "muted"
            : p.user.restrictions.some((r) => r.type === "freeze_wallet") ? "frozen"
            : p.user.restrictions.length > 0 ? "restricted" : "active",
        })),
        participantCount: room.participants.length,
        openReports: openReports.map((rp) => ({
          id: rp.id,
          category: rp.category,
          description: rp.description,
          status: rp.status,
          reporterId: rp.reporterId,
          reportedUserId: rp.reportedUserId,
          reviewNote: rp.reviewNote,
          createdAt: rp.createdAt.toISOString(),
        })),
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          type: e.type,
          userId: e.userId,
          adminId: e.adminId,
          details: e.details,
          createdAt: e.createdAt.toISOString(),
        })),
        counts: {
          reports: room._count.reports,
          events: room._count.events,
        },
      },
    };
  });

  app.post("/v1/admin/rooms/:id/close", async (req) => {
    const admin = await requireAdmin(req, "rooms.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ reason: z.string().trim().min(1).max(300) }), bodyOf(req));
    const before = await prisma.room.findUnique({ where: { id } });
    if (!before) throw notFound("room not found");
    if (before.closedAt) throw badRequest("room is already closed");
    const room = await prisma.room.update({ where: { id }, data: { closedAt: new Date() } });
    // Record room event + audit.
    await prisma.roomEvent.create({ data: { roomId: id, type: "closed", adminId: admin.id, details: { reason: input.reason } as never } });
    await writeAudit({ adminId: admin.id, req, action: "close_room", entity: "room", entityId: id, after: { closedAt: room.closedAt, reason: input.reason } });
    // Notify connected room participants via socket.io.
    emitToRoom(id, "room:closed", { roomId: id, reason: input.reason });
    return { ok: true, data: { id, closedAt: room.closedAt?.toISOString() } };
  });

  // --- Participant moderation ---------------------------------------------
  /**
   * Admin kick — removes a participant from the room by setting kickedAt.
   * This is the SAME mechanism the host uses via socket.io (room:kick),
   * but invoked from the admin API. Emits a socket event so connected
   * participants see the kick in real time.
   */
  app.post("/v1/admin/rooms/:id/participants/:userId/kick", async (req) => {
    const admin = await requireAdmin(req, "rooms.write");
    const { id, userId } = validate(z.object({ id: z.coerce.number(), userId: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ reason: z.string().trim().min(1).max(300) }), bodyOf(req));
    const participant = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: id, userId } } });
    if (!participant) throw notFound("participant not found in this room");
    if (participant.leftAt || participant.kickedAt) throw badRequest("participant has already left or been kicked");
    await prisma.roomParticipant.update({
      where: { id: participant.id },
      data: { kickedAt: new Date(), slotIndex: null },
    });
    await prisma.roomEvent.create({ data: { roomId: id, type: "participant_kicked", userId, adminId: admin.id, details: { reason: input.reason } as never } });
    await writeAudit({ adminId: admin.id, req, action: "kick_participant", entity: "room", entityId: id, after: { userId, reason: input.reason } });
    emitToRoom(id, "room:kicked", { roomId: id, userId });
    return { ok: true };
  });

  /**
   * Admin mute / unmute — toggles the RoomParticipant.muted flag.
   * Same mechanism as the host's socket.io room:mute event. Emits a socket
   * event so the participant's client updates the mic state.
   */
  app.post("/v1/admin/rooms/:id/participants/:userId/mute", async (req) => {
    const admin = await requireAdmin(req, "rooms.write");
    const { id, userId } = validate(z.object({ id: z.coerce.number(), userId: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ muted: z.boolean(), reason: z.string().trim().max(300).optional() }), bodyOf(req));
    const participant = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: id, userId } } });
    if (!participant) throw notFound("participant not found in this room");
    if (participant.leftAt || participant.kickedAt) throw badRequest("participant has already left or been kicked");
    await prisma.roomParticipant.update({
      where: { id: participant.id },
      data: { muted: input.muted },
    });
    await prisma.roomEvent.create({ data: { roomId: id, type: input.muted ? "participant_muted" : "participant_unmuted", userId, adminId: admin.id, details: { reason: input.reason ?? "" } as never } });
    await writeAudit({ adminId: admin.id, req, action: input.muted ? "mute_participant" : "unmute_participant", entity: "room", entityId: id, after: { userId, muted: input.muted, reason: input.reason ?? "" } });
    emitToRoom(id, "room:muted", { roomId: id, userId, muted: input.muted });
    return { ok: true };
  });

  // --- Room reports -------------------------------------------------------
  app.get("/v1/admin/rooms/:id/reports", async (req) => {
    await requireAdmin(req, "rooms.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const room = await prisma.room.findUnique({ where: { id }, select: { id: true } });
    if (!room) throw notFound("room not found");
    const reports = await prisma.roomReport.findMany({
      where: { roomId: id },
      orderBy: { id: "desc" },
      take: 100,
    });
    return { ok: true, data: reports };
  });

  app.post("/v1/admin/rooms/:id/reports", async (req) => {
    const admin = await requireAdmin(req, "rooms.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(roomReportCreateSchema, bodyOf(req));
    const room = await prisma.room.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!room) throw notFound("room not found");
    const report = await prisma.roomReport.create({
      data: {
        roomId: id,
        reporterId: input.reporterId ?? null,
        reportedUserId: input.reportedUserId ?? null,
        category: input.category,
        description: input.description,
        reviewerId: admin.id,
      },
    });
    await prisma.roomEvent.create({ data: { roomId: id, type: "report_filed", adminId: admin.id, details: { reportId: report.id, category: input.category } as never } });
    await writeAudit({ adminId: admin.id, req, action: "file_room_report", entity: "room", entityId: id, after: { reportId: report.id, category: input.category } });
    return { ok: true, data: { id: report.id, roomId: id, status: report.status } };
  });

  app.patch("/v1/admin/rooms/:id/reports/:rid", async (req) => {
    const admin = await requireAdmin(req, "rooms.write");
    const { id, rid } = validate(z.object({ id: z.coerce.number(), rid: z.coerce.number() }), paramsOf(req));
    const input = validate(roomReportUpdateSchema, bodyOf(req));
    const before = await prisma.roomReport.findUnique({ where: { id: rid } });
    if (!before) throw notFound("report not found");
    if (before.roomId !== id) throw badRequest("report does not belong to this room");
    const data: Record<string, unknown> = {};
    if (input.status) data.status = input.status;
    if (input.reviewNote !== undefined) data.reviewNote = input.reviewNote;
    data.reviewerId = admin.id;
    const after = await prisma.roomReport.update({ where: { id: rid }, data });
    await prisma.roomEvent.create({ data: { roomId: id, type: "report_resolved", adminId: admin.id, details: { reportId: rid, status: after.status } as never } });
    await writeAudit({ adminId: admin.id, req, action: "update_room_report", entity: "room", entityId: id, before: { reportId: rid, status: before.status }, after: { reportId: rid, status: after.status, reviewNote: after.reviewNote } });
    return { ok: true, data: { id: after.id, status: after.status } };
  });

  // --- Room events --------------------------------------------------------
  app.get("/v1/admin/rooms/:id/events", async (req) => {
    await requireAdmin(req, "rooms.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const q = validate(paginationQuery, queryOf(req));
    const room = await prisma.room.findUnique({ where: { id }, select: { id: true } });
    if (!room) throw notFound("room not found");
    const [total, items] = await Promise.all([
      prisma.roomEvent.count({ where: { roomId: id } }),
      prisma.roomEvent.findMany({
        where: { roomId: id },
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((e) => ({
          id: e.id,
          type: e.type,
          userId: e.userId,
          adminId: e.adminId,
          details: e.details,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  });

  // --- Room CSV export ----------------------------------------------------
  app.get("/v1/admin/rooms/export", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    await requireAdmin(req, "rooms.read");
    const q = validate(roomListQuerySchema, queryOf(req));
    const where: Prisma.RoomWhereInput = {};
    if (q.search) {
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) where.id = asNum;
      else where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { host: { displayName: { contains: q.search, mode: "insensitive" } } },
      ];
    }
    if (q.type) where.type = q.type;
    if (q.status === "active") where.closedAt = null;
    else if (q.status === "closed") where.closedAt = { not: null };
    if (q.hostId) where.hostId = q.hostId;
    const rows = await prisma.room.findMany({
      where,
      orderBy: { id: "asc" },
      take: 5000,
      include: { host: { select: { displayName: true } }, _count: { select: { participants: true, reports: true } } },
    });
    const headers = ["id", "title", "type", "country", "status", "host", "slots", "participantCount", "reportCount", "createdAt", "closedAt"];
    const escape = (v: unknown): string => {
      let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => {
        switch (h) {
          case "id": return escape(r.id);
          case "title": return escape(r.title);
          case "type": return escape(r.type);
          case "country": return escape(r.country);
          case "status": return escape(r.closedAt ? "closed" : "active");
          case "host": return escape(r.host?.displayName ?? "");
          case "slots": return escape(r.slots);
          case "participantCount": return escape(r._count.participants);
          case "reportCount": return escape(r._count.reports);
          case "createdAt": return escape(r.createdAt.toISOString());
          case "closedAt": return escape(r.closedAt?.toISOString() ?? "");
          default: return "";
        }
      }).join(",")),
    ];
    const csv = lines.join("\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="rooms-${stamp}.csv"`);
    reply.header("x-export-row-count", String(rows.length));
    return csv;
  });

  // --- Rounds & bets -------------------------------------------------------
  app.get("/v1/admin/rounds", async (req) => {
    await requireAdmin(req, "rounds.read");
    const q = validate(paginationQuery, queryOf(req));
    const where = q.search ? { roundId: { contains: q.search } } : {};
    const [total, items] = await Promise.all([
      prisma.gameRound.count({ where }),
      prisma.gameRound.findMany({
        where, orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { game: { select: { code: true, name: true } }, bets: { include: { user: { select: { displayName: true } } } } },
      }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.get("/v1/admin/bets", async (req) => {
    await requireAdmin(req, "rounds.read");
    const q = validate(paginationQuery, queryOf(req));
    const where = q.search ? { providerTxId: { contains: q.search } } : {};
    const [total, items] = await Promise.all([
      prisma.bet.count({ where }),
      prisma.bet.findMany({
        where, orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { user: { select: { id: true, displayName: true } }, game: { select: { code: true } } },
      }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.post("/v1/admin/bets/:id/cancel", async (req) => {
    const admin = await requireAdmin(req, "rounds.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const bet = await prisma.bet.findUnique({ where: { id } });
    if (!bet) throw notFound("bet not found");
    if (bet.status !== "placed") throw badRequest(`bet already ${bet.status}`);
    await postLedgerEntries([{ userId: bet.userId, kind: "bet_refund", amount: bet.amount, txKey: `betrefund:admin:${bet.id}:${admin.id}`, refType: "bet", refId: bet.id, meta: { by: admin.username } }]);
    const updated = await prisma.bet.update({ where: { id }, data: { status: "cancelled", settledAt: new Date() } });
    await writeAudit({ adminId: admin.id, req, action: "cancel_bet", entity: "bet", entityId: id, before: bet, after: updated });
    return { ok: true, data: updated };
  });

  app.post("/v1/admin/rounds/:id/force", async (req) => {
    const admin = await requireAdmin(req, "rounds.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ action: z.enum(["settle", "cancel", "restart"]) }), bodyOf(req));
    const round = await prisma.gameRound.findUnique({ where: { id }, include: { bets: true } });
    if (!round) throw notFound("round not found");
    if (input.action === "restart") {
      if (round.status === "open") throw badRequest("round still open");
      const restarted = await prisma.gameRound.update({ where: { id }, data: { status: "open", startedAt: new Date(), endedAt: null, settleSource: "admin" } });
      await writeAudit({ adminId: admin.id, req, action: "restart_round", entity: "round", entityId: id, before: round, after: restarted });
      return { ok: true, data: restarted };
    }
    if (round.status !== "open") throw badRequest(`round already ${round.status}`);
    if (input.action === "cancel") {
      await prisma.$transaction(async (tx) => {
        for (const bet of round.bets.filter((b) => b.status === "placed")) {
          await postLedgerEntries([{ userId: bet.userId, kind: "bet_refund", amount: bet.amount, txKey: `betrefund:admin:round:${round.id}:${bet.id}`, refType: "bet", refId: bet.id }], tx);
          await tx.bet.update({ where: { id: bet.id }, data: { status: "cancelled", settledAt: new Date() } });
        }
        await tx.gameRound.update({ where: { id }, data: { status: "cancelled", endedAt: new Date(), settleSource: "admin" } });
      });
    } else {
      await prisma.bet.updateMany({ where: { roundId: id, status: "placed" }, data: { status: "lost", settledAt: new Date() } });
      await prisma.gameRound.update({ where: { id }, data: { status: "settled", endedAt: new Date(), settleSource: "admin" } });
    }
    await writeAudit({ adminId: admin.id, req, action: `${input.action}_round`, entity: "round", entityId: id });
    return { ok: true };
  });

  /** Trigger the 12-hour stuck-round recovery scan on demand. */
  app.post("/v1/admin/rounds/recover-stuck", async (req) => {
    const admin = await requireAdmin(req, "rounds.write");
    const { recoverStuckRounds } = await import("../../workers/rounds.recovery.js");
    const result = await recoverStuckRounds();
    await writeAudit({ adminId: admin.id, req, action: "recover_stuck_rounds", entity: "round", after: result });
    return { ok: true, data: result };
  });

  // --- Wallet admin --------------------------------------------------------
  app.get("/v1/admin/wallet/ledger", async (req) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(paginationQuery, queryOf(req));
    const filters: Record<string, unknown> = {};
    if (q.search) {
      const n = Number(q.search);
      if (!Number.isNaN(n)) filters.userId = n;
      else filters.txKey = { contains: q.search };
    }
    const kind = (req.query as { kind?: string }).kind;
    if (kind) filters.kind = kind;
    const [total, items] = await Promise.all([
      prisma.ledgerEntry.count({ where: filters }),
      prisma.ledgerEntry.findMany({
        where: filters, orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items: items.map((e) => ({ ...e, id: e.id.toString() })) } };
  });

  app.get("/v1/admin/wallet/recharges", async (req) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.recharge.count(),
      prisma.recharge.findMany({ orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: { displayName: true } } } }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.post("/v1/admin/wallet/refund", async (req) => {
    const admin = await requireAdmin(req, "wallet.write");
    const input = validate(z.object({ rechargeId: z.coerce.number(), reason: z.string().max(200).optional() }), bodyOf(req));
    const recharge = await prisma.recharge.findUnique({ where: { id: input.rechargeId } });
    if (!recharge) throw notFound("recharge not found");
    if (recharge.status !== "succeeded") throw badRequest("only succeeded recharges can be refunded");
    const existing = await prisma.refund.findUnique({ where: { rechargeId: recharge.id } });
    if (existing) throw badRequest("already refunded");
    await postLedgerEntries([{ userId: recharge.userId, kind: "refund", amount: -recharge.amount, txKey: `refund:${recharge.id}`, refType: "recharge", refId: recharge.id, meta: { by: admin.username, reason: input.reason ?? "" } }]);
    await prisma.refund.create({ data: { rechargeId: recharge.id, amount: recharge.amount, reason: input.reason ?? "", adminId: admin.id } });
    await prisma.recharge.update({ where: { id: recharge.id }, data: { status: "refunded" } });
    await writeAudit({ adminId: admin.id, req, action: "refund_recharge", entity: "recharge", entityId: recharge.id, after: { amount: recharge.amount } });
    return { ok: true };
  });

  app.get("/v1/admin/wallet/integrity", async (req) => {
    await requireAdmin(req, "wallet.read");
    return { ok: true, data: await ledgerIntegrityCheck() };
  });

  app.get("/v1/admin/wallet/rtp", async (req) => {
    await requireAdmin(req, "wallet.read");
    const rows = await prisma.rtpSnapshot.findMany({
      orderBy: { windowEnd: "desc" },
      take: 100,
      include: { game: { select: { code: true, name: true } } },
    });
    return { ok: true, data: rows };
  });

  // --- Wallet management (Prompt 07) --------------------------------------
  //
  // Extends the existing wallet routes with:
  //   - Wallet summary KPIs (total wallets, total balance, credits/debits,
  //     recharges, refunds, pending/failed transactions)
  //   - Filtered + paginated wallet list with frozen/balance filters
  //   - Wallet detail with recent ledger entries + integrity check
  //   - Filtered + paginated ledger (by kind, user, date, amount range)
  //   - Recharges list (with status filter)
  //   - Refunds list
  //   - Agency withdrawals list
  //   - Reconciliation (ledger integrity check + recharge/ledger mismatch)
  //   - CSV export for ledger entries
  //
  // All financial data is READ-ONLY through these endpoints. Wallet
  // mutations (recharge, adjust, refund) go through the existing dedicated
  // endpoints that use the ledger service with idempotency + row locking.
  app.get("/v1/admin/wallet/summary", async (req) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), queryOf(req));

    // Build date filter for ledger queries.
    const dateFilter: Prisma.LedgerEntryWhereInput = {};
    if (q.from) dateFilter.createdAt = { gte: new Date(`${q.from}T00:00:00.000Z`) };
    if (q.to) {
      const t = new Date(`${q.to}T00:00:00.000Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      const existing: Prisma.DateTimeFilter = dateFilter.createdAt as Prisma.DateTimeFilter ?? {};
      dateFilter.createdAt = { ...existing, lt: t };
    }

    const [
      totalWallets, totalBalance, frozenWallets,
      totalCredits, totalDebits,
      rechargeAmount, rechargeCount,
      refundAmount, refundCount,
      betDebitAmount, winCreditAmount,
      giftDebitAmount, giftCreditAmount,
      adminAdjustAmount,
      pendingRecharges, failedRecharges,
      pendingWithdrawals, approvedWithdrawals,
    ] = await Promise.all([
      prisma.wallet.count(),
      prisma.wallet.aggregate({ _sum: { balance: true } }),
      prisma.wallet.count({ where: { frozen: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, amount: { lt: 0 } }, _sum: { amount: true }, _count: true }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, kind: "recharge" }, _sum: { amount: true } }),
      prisma.ledgerEntry.count({ where: { ...dateFilter, kind: "recharge" } }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, kind: "refund" }, _sum: { amount: true } }),
      prisma.ledgerEntry.count({ where: { ...dateFilter, kind: "refund" } }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, kind: "bet_debit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, kind: "win_credit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, kind: "gift_debit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, kind: "gift_credit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...dateFilter, kind: "admin_adjust" }, _sum: { amount: true } }),
      prisma.recharge.count({ where: { status: "pending" } }),
      prisma.recharge.count({ where: { status: "failed" } }),
      prisma.agencyWithdrawal.count({ where: { status: "pending" } }),
      prisma.agencyWithdrawal.count({ where: { status: "approved" } }),
    ]);

    return {
      ok: true,
      data: {
        currency: "coins",
        totalWallets,
        totalBalance: totalBalance._sum.balance ?? 0,
        frozenWallets,
        totalCredits: totalCredits._sum.amount ?? 0,
        totalCreditCount: totalCredits._count,
        totalDebits: Math.abs(totalDebits._sum.amount ?? 0),
        totalDebitCount: totalDebits._count,
        rechargeAmount: rechargeAmount._sum.amount ?? 0,
        rechargeCount,
        refundAmount: Math.abs(refundAmount._sum.amount ?? 0),
        refundCount,
        betDebitAmount: Math.abs(betDebitAmount._sum.amount ?? 0),
        winCreditAmount: winCreditAmount._sum.amount ?? 0,
        giftDebitAmount: Math.abs(giftDebitAmount._sum.amount ?? 0),
        giftCreditAmount: giftCreditAmount._sum.amount ?? 0,
        adminAdjustAmount: adminAdjustAmount._sum.amount ?? 0,
        pendingRecharges,
        failedRecharges,
        pendingWithdrawals,
        approvedWithdrawals,
        // Net gaming margin = bets - wins (house coin margin, NOT profit)
        netGamingMargin: Math.abs(betDebitAmount._sum.amount ?? 0) - (winCreditAmount._sum.amount ?? 0),
        note: "Net gaming margin = bet debits - win credits. NOT platform profit — commission is settled separately via ProviderBill.",
      },
    };
  });

  app.get("/v1/admin/wallet/wallets", async (req) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(walletListQuerySchema, queryOf(req));
    const where: Prisma.WalletWhereInput = {};
    if (q.search) {
      const n = Number(q.search);
      if (!Number.isNaN(n) && Number.isInteger(n)) where.userId = n;
    }
    if (q.frozen === "true") where.frozen = true;
    else if (q.frozen === "false") where.frozen = false;
    if (q.minBalance != null || q.maxBalance != null) {
      where.balance = {};
      if (q.minBalance != null) where.balance.gte = q.minBalance;
      if (q.maxBalance != null) where.balance.lte = q.maxBalance;
    }
    const [total, items] = await Promise.all([
      prisma.wallet.count({ where }),
      prisma.wallet.findMany({
        where,
        orderBy: { balance: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { id: true, displayName: true, phone: true, email: true, createdAt: true } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((w) => ({
          id: w.id,
          userId: w.userId,
          displayName: w.user?.displayName ?? "—",
          phone: w.user?.phone ?? null,
          email: w.user?.email ?? null,
          balance: w.balance,
          frozen: w.frozen,
          status: w.frozen ? "frozen" : "active",
          updatedAt: w.updatedAt.toISOString(),
          userCreatedAt: w.user?.createdAt.toISOString() ?? null,
        })),
      },
    };
  });

  app.get("/v1/admin/wallet/wallets/:userId", async (req) => {
    await requireAdmin(req, "wallet.read");
    const { userId } = validate(z.object({ userId: z.coerce.number() }), paramsOf(req));
    const [wallet, recentEntries, rechargeCount, refundCount, betCount] = await Promise.all([
      prisma.wallet.findUnique({
        where: { userId },
        include: { user: { select: { id: true, displayName: true, phone: true, email: true, createdAt: true } } },
      }),
      prisma.ledgerEntry.findMany({
        where: { userId },
        orderBy: { id: "desc" },
        take: 20,
      }),
      prisma.ledgerEntry.count({ where: { userId, kind: "recharge" } }),
      prisma.ledgerEntry.count({ where: { userId, kind: "refund" } }),
      prisma.bet.count({ where: { userId } }),
    ]);
    if (!wallet) throw notFound("wallet not found");

    // Run integrity check for this user.
    const integrity = await ledgerIntegrityCheck([userId]);

    return {
      ok: true,
      data: {
        wallet: {
          id: wallet.id,
          userId: wallet.userId,
          balance: wallet.balance,
          frozen: wallet.frozen,
          status: wallet.frozen ? "frozen" : "active",
          updatedAt: wallet.updatedAt.toISOString(),
          user: wallet.user ? {
            id: wallet.user.id,
            displayName: wallet.user.displayName,
            createdAt: wallet.user.createdAt.toISOString(),
          } : null,
        },
        recentEntries: recentEntries.map((e) => ({
          id: e.id.toString(),
          kind: e.kind,
          amount: e.amount,
          balanceAfter: e.balanceAfter,
          txKey: e.txKey,
          refType: e.refType,
          refId: e.refId,
          createdAt: e.createdAt.toISOString(),
        })),
        counts: {
          recharges: rechargeCount,
          refunds: refundCount,
          bets: betCount,
        },
        integrity: integrity.mismatches.length === 0
          ? { ok: true }
          : { ok: false, mismatch: integrity.mismatches[0] },
      },
    };
  });

  app.get("/v1/admin/wallet/transactions", async (req) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(ledgerListQuerySchema, queryOf(req));
    const where: Prisma.LedgerEntryWhereInput = {};
    if (q.search) {
      const n = Number(q.search);
      if (!Number.isNaN(n) && Number.isInteger(n)) where.userId = n;
      else where.txKey = { contains: q.search };
    }
    if (q.kind) where.kind = q.kind;
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) {
      const f: Prisma.DateTimeFilter = {};
      if (q.from) f.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) {
        const t = new Date(`${q.to}T00:00:00.000Z`);
        t.setUTCDate(t.getUTCDate() + 1);
        f.lt = t;
      }
      where.createdAt = f;
    }
    if (q.minAmount != null || q.maxAmount != null) {
      where.amount = {};
      if (q.minAmount != null) where.amount.gte = q.minAmount;
      if (q.maxAmount != null) where.amount.lte = q.maxAmount;
    }

    const [total, items] = await Promise.all([
      prisma.ledgerEntry.count({ where }),
      prisma.ledgerEntry.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        // BigInt id → string; never return meta (may contain admin context).
        items: items.map((e) => ({
          id: e.id.toString(),
          userId: e.userId,
          kind: e.kind,
          amount: e.amount,
          balanceAfter: e.balanceAfter,
          txKey: e.txKey,
          refType: e.refType,
          refId: e.refId,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/admin/wallet/refunds", async (req) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.refund.count(),
      prisma.refund.findMany({
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          recharge: { select: { id: true, userId: true, amount: true, status: true, createdAt: true } },
          admin: { select: { id: true, username: true, displayName: true } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((r) => ({
          id: r.id,
          rechargeId: r.rechargeId,
          amount: r.amount,
          reason: r.reason,
          adminId: r.adminId,
          admin: r.admin ? { id: r.admin.id, username: r.admin.username, displayName: r.admin.displayName } : null,
          recharge: r.recharge ? {
            id: r.recharge.id,
            userId: r.recharge.userId,
            originalAmount: r.recharge.amount,
            status: r.recharge.status,
            createdAt: r.recharge.createdAt.toISOString(),
          } : null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/admin/wallet/withdrawals", async (req) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(paginationQuery.extend({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }), queryOf(req));
    const where: Prisma.AgencyWithdrawalWhereInput = {};
    if (q.status) where.status = q.status;
    const [total, items] = await Promise.all([
      prisma.agencyWithdrawal.count({ where }),
      prisma.agencyWithdrawal.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { agency: { select: { id: true, name: true, code: true } } },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((w) => ({
          id: w.id,
          agencyId: w.agencyId,
          agencyName: w.agency?.name ?? "—",
          agencyCode: w.agency?.code ?? "—",
          amount: w.amount,
          status: w.status,
          note: w.note,
          createdAt: w.createdAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/admin/wallet/reconciliation", async (req) => {
    await requireAdmin(req, "wallet.read");
    // 1. Ledger integrity: SUM(ledgerEntry.amount) == wallet.balance for every user.
    const integrity = await ledgerIntegrityCheck();
    // 2. Pending recharges that should have a ledger entry but might not.
    const pendingRecharges = await prisma.recharge.findMany({
      where: { status: "succeeded" },
      take: 100,
      select: { id: true, userId: true, amount: true, createdAt: true },
    });
    // Check each succeeded recharge has a matching ledger entry.
    const unmatchedRecharges: { rechargeId: number; userId: number; amount: number }[] = [];
    for (const r of pendingRecharges.slice(0, 50)) {
      const entry = await prisma.ledgerEntry.findUnique({ where: { txKey: `recharge:${r.id}` } });
      if (!entry) unmatchedRecharges.push({ rechargeId: r.id, userId: r.userId, amount: r.amount });
    }
    // 3. Duplicate detection: check for duplicate txKeys (should be impossible due to unique constraint).
    const duplicateTxKeys = await prisma.$queryRaw<{ txKey: string; cnt: bigint }[]>`
      SELECT "txKey", COUNT(*) as cnt FROM "LedgerEntry" GROUP BY "txKey" HAVING COUNT(*) > 1 LIMIT 10`;
    return {
      ok: true,
      data: {
        integrity: {
          ok: integrity.ok,
          mismatchCount: integrity.mismatches.length,
          mismatches: integrity.mismatches.slice(0, 20),
        },
        unmatchedRecharges,
        unmatchedCount: unmatchedRecharges.length,
        duplicateTxKeys: duplicateTxKeys.map((d) => ({ txKey: d.txKey, count: Number(d.cnt) })),
        duplicateCount: duplicateTxKeys.length,
        note: "Diagnostic only — no automatic corrections. Any discrepancy requires an authorized financial workflow to resolve.",
      },
    };
  });

  app.get("/v1/admin/wallet/export", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    await requireAdmin(req, "wallet.read");
    const q = validate(ledgerListQuerySchema, queryOf(req));
    const where: Prisma.LedgerEntryWhereInput = {};
    if (q.kind) where.kind = q.kind;
    if (q.userId) where.userId = q.userId;
    if (q.from) where.createdAt = { gte: new Date(`${q.from}T00:00:00.000Z`) };
    if (q.to) {
      const t = new Date(`${q.to}T00:00:00.000Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      const existing: Prisma.DateTimeFilter = where.createdAt as Prisma.DateTimeFilter ?? {};
      where.createdAt = { ...existing, lt: t };
    }
    const rows = await prisma.ledgerEntry.findMany({
      where,
      orderBy: { id: "asc" },
      take: 5000,
    });
    const headers = ["id", "userId", "kind", "amount", "balanceAfter", "txKey", "refType", "refId", "createdAt"];
    const escape = (v: unknown): string => {
      let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      headers.join(","),
      ...rows.map((e) => headers.map((h) => {
        switch (h) {
          case "id": return escape(e.id.toString());
          case "userId": return escape(e.userId);
          case "kind": return escape(e.kind);
          case "amount": return escape(e.amount);
          case "balanceAfter": return escape(e.balanceAfter);
          case "txKey": return escape(e.txKey);
          case "refType": return escape(e.refType ?? "");
          case "refId": return escape(e.refId ?? "");
          case "createdAt": return escape(e.createdAt.toISOString());
          default: return "";
        }
      }).join(",")),
    ];
    const csv = lines.join("\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="ledger-${stamp}.csv"`);
    reply.header("x-export-row-count", String(rows.length));
    return csv;
  });

  // --- Players -------------------------------------------------------------
  app.get("/v1/admin/players/:id/detail", async (req) => {
    await requireAdmin(req, "players.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const [user, restrictions, sessions, bets, complaints, suspicious] = await Promise.all([
      prisma.user.findUnique({ where: { id }, include: { wallet: true, agency: true } }),
      prisma.playerRestriction.findMany({ where: { userId: id }, orderBy: { id: "desc" } }),
      prisma.session.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 20 }),
      prisma.bet.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 50, include: { game: { select: { code: true } } } }),
      prisma.complaint.findMany({ where: { userId: id } }),
      prisma.suspiciousEvent.findMany({ where: { userId: id }, orderBy: { id: "desc" }, take: 20 }),
    ]);
    if (!user) throw notFound("user not found");
    return { ok: true, data: { user, restrictions, sessions, bets, complaints, suspicious } };
  });

  app.get("/v1/admin/complaints", async (req) => {
    await requireAdmin(req, "players.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.complaint.count(),
      prisma.complaint.findMany({ orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: { displayName: true } } } }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.patch("/v1/admin/complaints/:id", async (req) => {
    const admin = await requireAdmin(req, "players.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ status: z.enum(["open", "in_progress", "resolved", "rejected"]).optional(), assigneeNote: z.string().max(500).optional() }), bodyOf(req));
    const before = await prisma.complaint.findUnique({ where: { id } });
    if (!before) throw notFound();
    const after = await prisma.complaint.update({ where: { id }, data: input });
    await writeAudit({ adminId: admin.id, req, action: "update_complaint", entity: "complaint", entityId: id, before, after });
    return { ok: true, data: after };
  });

  // --- Support Tickets (Prompt 11) ---------------------------------------
  //
  // Full ticket management: list, create, detail, update (status/priority/
  // assignee), conversation (messages + internal notes).
  //
  // Permissions:
  //   - players.read  — view tickets + complaints
  //   - players.write — create/update tickets, reply, add internal notes

  app.get("/v1/admin/support/summary", async (req) => {
    await requireAdmin(req, "players.read");
    const [totalTickets, newTickets, openTickets, inProgressTickets, waitingTickets, resolvedTickets, closedTickets, escalatedTickets, unassignedTickets, totalComplaints, openComplaints, resolvedComplaints, rejectedComplaints] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: "new" } }),
      prisma.supportTicket.count({ where: { status: "open" } }),
      prisma.supportTicket.count({ where: { status: "in_progress" } }),
      prisma.supportTicket.count({ where: { status: { in: ["waiting_user", "waiting_internal"] } } }),
      prisma.supportTicket.count({ where: { status: "resolved" } }),
      prisma.supportTicket.count({ where: { status: "closed" } }),
      prisma.supportTicket.count({ where: { status: "escalated" } }),
      prisma.supportTicket.count({ where: { assigneeId: null, status: { notIn: ["resolved", "closed"] } } }),
      prisma.complaint.count(),
      prisma.complaint.count({ where: { status: "open" } }),
      prisma.complaint.count({ where: { status: "resolved" } }),
      prisma.complaint.count({ where: { status: "rejected" } }),
    ]);
    return {
      ok: true,
      data: {
        tickets: { total: totalTickets, new: newTickets, open: openTickets, inProgress: inProgressTickets, waiting: waitingTickets, resolved: resolvedTickets, closed: closedTickets, escalated: escalatedTickets, unassigned: unassignedTickets },
        complaints: { total: totalComplaints, open: openComplaints, resolved: resolvedComplaints, rejected: rejectedComplaints },
        // No SLA tracking table exists.
        hasSLA: false,
        // No customer satisfaction collection.
        hasSatisfaction: false,
        // No notification delivery infrastructure.
        hasNotificationService: false,
      },
    };
  });

  app.get("/v1/admin/support/tickets", async (req) => {
    await requireAdmin(req, "players.read");
    const q = validate(paginationQuery.extend({
      status: z.string().trim().max(30).optional(),
      priority: z.string().trim().max(20).optional(),
      category: z.string().trim().max(40).optional(),
      assigneeId: z.coerce.number().int().optional(),
    }), queryOf(req));
    const where: Prisma.SupportTicketWhereInput = {};
    if (q.search) {
      const n = Number(q.search);
      if (!Number.isNaN(n) && Number.isInteger(n)) where.userId = n;
      else where.subject = { contains: q.search, mode: "insensitive" };
    }
    if (q.status) where.status = q.status;
    if (q.priority) where.priority = q.priority;
    if (q.category) where.category = q.category;
    if (q.assigneeId) where.assigneeId = q.assigneeId;
    const [total, items] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { id: true, displayName: true } },
          assignee: { select: { id: true, displayName: true } },
          _count: { select: { messages: true } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((t) => ({
          id: t.id,
          userId: t.userId,
          username: t.user?.displayName ?? "—",
          subject: t.subject,
          category: t.category,
          priority: t.priority,
          status: t.status,
          assigneeId: t.assigneeId,
          assignee: t.assignee?.displayName ?? null,
          messageCount: t._count.messages,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/admin/support/tickets/:id", async (req) => {
    await requireAdmin(req, "players.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, displayName: true, phone: true, email: true, country: true, createdAt: true } },
        assignee: { select: { id: true, displayName: true, username: true } },
        messages: { orderBy: { id: "asc" }, include: { author: { select: { id: true, displayName: true, username: true } } } },
      },
    });
    if (!ticket) throw notFound("ticket not found");
    return {
      ok: true,
      data: {
        ticket: {
          id: ticket.id,
          userId: ticket.userId,
          subject: ticket.subject,
          description: ticket.description,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          assigneeId: ticket.assigneeId,
          assignee: ticket.assignee ? { id: ticket.assignee.id, displayName: ticket.assignee.displayName, username: ticket.assignee.username } : null,
          createdAt: ticket.createdAt.toISOString(),
          updatedAt: ticket.updatedAt.toISOString(),
        },
        user: ticket.user ? {
          id: ticket.user.id,
          displayName: ticket.user.displayName,
          phone: ticket.user.phone,
          email: ticket.user.email,
          country: ticket.user.country,
          createdAt: ticket.user.createdAt.toISOString(),
        } : null,
        messages: ticket.messages.map((m) => ({
          id: m.id,
          authorType: m.authorType,
          authorId: m.authorId,
          authorName: m.author?.displayName ?? "User",
          body: m.body,
          isInternal: m.isInternal,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    };
  });

  app.post("/v1/admin/support/tickets", async (req) => {
    const admin = await requireAdmin(req, "players.write");
    const input = validate(z.object({
      userId: z.coerce.number().int().positive(),
      subject: z.string().trim().min(2).max(200),
      description: z.string().trim().max(5000).default(""),
      category: z.string().trim().max(40).default("other"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    }), bodyOf(req));
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) throw notFound("user not found");
    const ticket = await prisma.supportTicket.create({ data: input });
    await writeAudit({ adminId: admin.id, req, action: "create_ticket", entity: "support_ticket", entityId: ticket.id, after: { subject: ticket.subject, userId: input.userId } });
    return { ok: true, data: { id: ticket.id, subject: ticket.subject } };
  });

  app.patch("/v1/admin/support/tickets/:id", async (req) => {
    const admin = await requireAdmin(req, "players.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      status: z.enum(["new", "open", "in_progress", "waiting_user", "waiting_internal", "escalated", "resolved", "closed"]).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      assigneeId: z.coerce.number().int().nullable().optional(),
      category: z.string().trim().max(40).optional(),
    }), bodyOf(req));
    const before = await prisma.supportTicket.findUnique({ where: { id } });
    if (!before) throw notFound("ticket not found");
    if (input.assigneeId) {
      const assignee = await prisma.adminUser.findUnique({ where: { id: input.assigneeId }, select: { id: true, active: true } });
      if (!assignee) throw badRequest("unknown admin user");
      if (!assignee.active) throw badRequest("admin user is inactive");
    }
    const after = await prisma.supportTicket.update({ where: { id }, data: input });
    await writeAudit({
      adminId: admin.id, req,
      action: "update_ticket",
      entity: "support_ticket", entityId: id,
      before: { status: before.status, priority: before.priority, assigneeId: before.assigneeId },
      after: { status: after.status, priority: after.priority, assigneeId: after.assigneeId },
    });
    return { ok: true, data: { id: after.id, status: after.status, priority: after.priority, assigneeId: after.assigneeId } };
  });

  app.post("/v1/admin/support/tickets/:id/messages", async (req) => {
    const admin = await requireAdmin(req, "players.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      body: z.string().trim().min(1).max(5000),
      isInternal: z.boolean().default(false),
    }), bodyOf(req));
    const ticket = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!ticket) throw notFound("ticket not found");
    const message = await prisma.ticketMessage.create({
      data: { ticketId: id, authorId: admin.id, authorType: "admin", body: input.body, isInternal: input.isInternal },
    });
    // If it's a customer-facing reply, move ticket to waiting_user.
    if (!input.isInternal && ticket.status === "open") {
      await prisma.supportTicket.update({ where: { id }, data: { status: "waiting_user" } });
    }
    await writeAudit({ adminId: admin.id, req, action: input.isInternal ? "add_internal_note" : "reply_ticket", entity: "support_ticket", entityId: id, after: { messageId: message.id, isInternal: input.isInternal } });
    return { ok: true, data: { id: message.id, isInternal: input.isInternal } };
  });

  app.get("/v1/admin/suspicious", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.suspiciousEvent.count(),
      prisma.suspiciousEvent.findMany({ orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  // --- Reports ---------------------------------------------------------------
  app.get("/v1/admin/reports/revenue", async (req) => {
    await requireAdmin(req, "reports.read");
    const granularity = ((req.query as { granularity?: string }).granularity ?? "daily") as "daily" | "weekly" | "monthly";
    const unit = granularity === "weekly" ? "week" : granularity === "monthly" ? "month" : "day";
    const rows = await prisma.$queryRaw<{ bucket: Date; bets: bigint; wins: bigint; rounds: bigint; revenue: bigint }[]>`
      SELECT date_trunc(${Prisma.raw(`'${unit}'`)}, b."createdAt") AS bucket,
             COALESCE(SUM(b.amount),0) AS bets,
             0 AS wins,
             COUNT(DISTINCT b."roundId") AS rounds,
             COALESCE(SUM(b.amount),0) AS revenue
      FROM "Bet" b GROUP BY bucket ORDER BY bucket DESC LIMIT 90`;
    // wins per bucket
    const wins = await prisma.$queryRaw<{ bucket: Date; wins: bigint }[]>`
      SELECT date_trunc(${Prisma.raw(`'${unit}'`)}, p."createdAt") AS bucket, COALESCE(SUM(p.amount),0) AS wins
      FROM "Payout" p GROUP BY bucket`;
    const winsMap = new Map(wins.map((w) => [new Date(w.bucket).toISOString().slice(0, 13), Number(w.wins)]));
    const data = rows.map((r) => {
      const bucket = new Date(r.bucket);
      const winsAmt = winsMap.get(bucket.toISOString().slice(0, 13)) ?? 0;
      return { bucket: bucket.toISOString(), bets: Number(r.bets), wins: winsAmt, rounds: Number(r.rounds), revenue: Number(r.bets) - winsAmt };
    });
    return { ok: true, data };
  });

  // --- Game management (Prompt 06) ----------------------------------------
  //
  // Extends the existing game-providers/games/game-configs resource CRUD
  // with dedicated endpoints for:
  //   - Game summary KPIs (total, active, maintenance, disabled, Pro, errors)
  //   - Filtered + paginated game list with provider join
  //   - Game detail with configs + provider info
  //   - Game status change (activate / disable / maintenance) with reason +
  //     audit + enforcement (launchGame already checks game.status)
  //   - Provider summary KPIs
  //   - Filtered + paginated provider list (secrets NEVER returned)
  //   - Provider detail with games + API error count
  //   - Game session list with filters
  //   - API error logs with provider filter
  //
  // Permissions:
  //   - games.read / games.write — game management
  //   - providers.read / providers.write — provider management
  //   - rounds.read — session + history viewing
  //   - security.read — API error logs

  app.get("/v1/admin/games/summary", async (req) => {
    await requireAdmin(req, "games.read");
    const [total, active, maintenance, disabled, isPro, errorGames24h] = await Promise.all([
      prisma.game.count(),
      prisma.game.count({ where: { status: "active" } }),
      prisma.game.count({ where: { status: "maintenance" } }),
      prisma.game.count({ where: { status: "disabled" } }),
      prisma.game.count({ where: { isPro: true } }),
      // Games with API errors in last 24h — derived from ApiErrorLog.source='provider'
      prisma.apiErrorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, source: "provider" } }),
    ]);
    return {
      ok: true,
      data: { total, active, maintenance, disabled, isPro, errorGames24h,
        // No separate game-category model exists in the current schema.
        hasGameCategories: false,
      },
    };
  });

  app.get("/v1/admin/games", async (req) => {
    await requireAdmin(req, "games.read");
    const q = validate(gameListQuerySchema, queryOf(req));
    const where: Prisma.GameWhereInput = {};
    if (q.search) {
      const asNum = Number(q.search);
      if (!Number.isNaN(asNum) && Number.isInteger(asNum)) {
        where.id = asNum;
      } else {
        where.OR = [
          { name: { contains: q.search, mode: "insensitive" } },
          { code: { contains: q.search, mode: "insensitive" } },
        ];
      }
    }
    if (q.status) where.status = q.status;
    if (q.providerId) where.providerId = q.providerId;
    if (q.isPro === "true") where.isPro = true;
    else if (q.isPro === "false") where.isPro = false;

    const sortWhitelist = ["id", "code", "name", "status", "sortOrder"];
    const sortBy = q.sortBy && sortWhitelist.includes(q.sortBy) ? q.sortBy : "id";
    const orderBy = { [sortBy]: q.sortDir } as const;

    const [total, items] = await Promise.all([
      prisma.game.count({ where }),
      prisma.game.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          provider: { select: { id: true, name: true, code: true, enabled: true } },
          _count: { select: { configs: true, sessions: true } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((g) => ({
          id: g.id,
          code: g.code,
          name: g.name,
          version: g.version,
          status: g.status,
          isPro: g.isPro,
          thumbnailUrl: g.thumbnailUrl,
          sortOrder: g.sortOrder,
          providerId: g.providerId,
          provider: g.provider ? { id: g.provider.id, name: g.provider.name, code: g.provider.code, enabled: g.provider.enabled } : null,
          configCount: g._count.configs,
          sessionCount: g._count.sessions,
        })),
      },
    };
  });

  app.get("/v1/admin/games/:id", async (req) => {
    await requireAdmin(req, "games.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const game = await prisma.game.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true, code: true, apiBase: true, enabled: true, commissionPct: true } },
        configs: { include: { market: { select: { id: true, code: true, name: true } } } },
        _count: { select: { sessions: true, rounds: true, bets: true } },
      },
    });
    if (!game) throw notFound("game not found");
    return {
      ok: true,
      data: {
        profile: {
          id: game.id, code: game.code, name: game.name, version: game.version,
          status: game.status, isPro: game.isPro, thumbnailUrl: game.thumbnailUrl, sortOrder: game.sortOrder,
          providerId: game.providerId,
          provider: game.provider,
        },
        configs: game.configs.map((c) => ({
          id: c.id, gameId: c.gameId, marketId: c.marketId, market: c.market,
          minBet: c.minBet, maxBet: c.maxBet, bettingSeconds: c.bettingSeconds,
          timeoutSeconds: c.timeoutSeconds, stuckPolicy: c.stuckPolicy,
        })),
        counts: { sessions: game._count.sessions, rounds: game._count.rounds, bets: game._count.bets },
      },
    };
  });

  app.post("/v1/admin/games/:id/status", async (req) => {
    const admin = await requireAdmin(req, "games.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(gameStatusChangeSchema, bodyOf(req));
    const before = await prisma.game.findUnique({ where: { id } });
    if (!before) throw notFound("game not found");
    const statusMap = { activate: "active", disable: "disabled", maintenance: "maintenance" } as const;
    const newStatus = statusMap[input.action];
    if (before.status === newStatus) throw badRequest(`game is already ${newStatus}`);
    const after = await prisma.game.update({ where: { id }, data: { status: newStatus } });
    await writeAudit({
      adminId: admin.id, req,
      action: `game_${input.action}`,
      entity: "game", entityId: id,
      before: { status: before.status },
      after: { status: after.status, reason: input.reason },
    });
    return { ok: true, data: { id: after.id, status: after.status } };
  });

  // --- Provider management -------------------------------------------------
  app.get("/v1/admin/providers/summary", async (req) => {
    await requireAdmin(req, "providers.read");
    const [total, enabled, disabled, withErrors24h, totalGames] = await Promise.all([
      prisma.gameProvider.count(),
      prisma.gameProvider.count({ where: { enabled: true } }),
      prisma.gameProvider.count({ where: { enabled: false } }),
      prisma.apiErrorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, source: "provider" } }),
      prisma.game.count({ where: { providerId: { not: null } } }),
    ]);
    return {
      ok: true,
      data: {
        total, enabled, disabled, withErrors24h, totalGames,
        // No separate sandbox/production environment model exists.
        hasEnvironments: false,
        // No dedicated health-check endpoint configured.
        hasHealthChecks: false,
      },
    };
  });

  app.get("/v1/admin/providers", async (req) => {
    await requireAdmin(req, "providers.read");
    const q = validate(providerListQuerySchema, queryOf(req));
    const where: Prisma.GameProviderWhereInput = {};
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { code: { contains: q.search, mode: "insensitive" } },
      ];
    }
    if (q.enabled === "true") where.enabled = true;
    else if (q.enabled === "false") where.enabled = false;

    const sortWhitelist = ["id", "name", "code", "commissionPct"];
    const sortBy = q.sortBy && sortWhitelist.includes(q.sortBy) ? q.sortBy : "id";
    const orderBy = { [sortBy]: q.sortDir } as const;

    const [total, items] = await Promise.all([
      prisma.gameProvider.count({ where }),
      prisma.gameProvider.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { _count: { select: { games: true } } },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        // NEVER return apiKey or apiSecret.
        items: items.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          apiBase: p.apiBase,
          commissionPct: p.commissionPct,
          enabled: p.enabled,
          gameCount: p._count.games,
          // Mask the key so admins can verify it's set without seeing the value.
          apiKeyMasked: p.apiKey ? p.apiKey.slice(0, 4) + "…" + p.apiKey.slice(-2) : "",
          apiSecretSet: !!p.apiSecret,
        })),
      },
    };
  });

  app.get("/v1/admin/providers/:id", async (req) => {
    await requireAdmin(req, "providers.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const provider = await prisma.gameProvider.findUnique({
      where: { id },
      include: {
        games: { select: { id: true, code: true, name: true, status: true, isPro: true, sortOrder: true } },
        _count: { select: { games: true, apiKeys: true, bills: true } },
      },
    });
    if (!provider) throw notFound("provider not found");

    const [recentErrors, totalErrors24h] = await Promise.all([
      prisma.apiErrorLog.findMany({
        where: { source: "provider" },
        orderBy: { id: "desc" },
        take: 20,
      }),
      prisma.apiErrorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, source: "provider" } }),
    ]);

    return {
      ok: true,
      data: {
        profile: {
          id: provider.id,
          name: provider.name,
          code: provider.code,
          apiBase: provider.apiBase,
          commissionPct: provider.commissionPct,
          enabled: provider.enabled,
          // Secrets NEVER returned.
          apiKeyMasked: provider.apiKey ? provider.apiKey.slice(0, 4) + "…" + provider.apiKey.slice(-2) : "",
          apiSecretSet: !!provider.apiSecret,
        },
        games: provider.games.map((g) => ({
          id: g.id, code: g.code, name: g.name, status: g.status, isPro: g.isPro, sortOrder: g.sortOrder,
        })),
        counts: { games: provider._count.games, apiKeys: provider._count.apiKeys, bills: provider._count.bills },
        recentErrors: recentErrors.map((e) => ({
          id: e.id, route: e.route, message: e.message, createdAt: e.createdAt.toISOString(),
        })),
        errorCount24h: totalErrors24h,
      },
    };
  });

  // --- Game sessions ------------------------------------------------------
  app.get("/v1/admin/sessions", async (req) => {
    await requireAdmin(req, "rounds.read");
    const q = validate(sessionListQuerySchema, queryOf(req));
    const where: Prisma.GameSessionWhereInput = {};
    if (q.search) {
      where.sessionKey = { contains: q.search };
    }
    if (q.gameId) where.gameId = q.gameId;
    if (q.userId) where.userId = q.userId;
    if (q.status === "open") where.closedAt = null;
    else if (q.status === "closed") where.closedAt = { not: null };
    if (q.providerId) where.game = { providerId: q.providerId };

    const [total, items] = await Promise.all([
      prisma.gameSession.count({ where }),
      prisma.gameSession.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { id: true, displayName: true } },
          game: { select: { id: true, code: true, name: true, providerId: true, provider: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((s) => ({
          id: s.id,
          sessionKey: s.sessionKey,
          userId: s.userId,
          displayName: s.user?.displayName ?? "—",
          gameId: s.gameId,
          gameCode: s.game?.code ?? "—",
          gameName: s.game?.name ?? "—",
          providerId: s.game?.providerId ?? null,
          providerName: s.game?.provider?.name ?? null,
          marketCode: s.marketCode,
          status: s.closedAt ? "closed" : "open",
          openedAt: s.openedAt.toISOString(),
          closedAt: s.closedAt?.toISOString() ?? null,
        })),
      },
    };
  });

  // --- API error logs (provider filter) -----------------------------------
  app.get("/v1/admin/api-errors", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(paginationQuery.extend({
      source: z.string().trim().max(60).optional(),
    }), queryOf(req));
    const where: Prisma.ApiErrorLogWhereInput = {};
    if (q.search) where.route = { contains: q.search };
    if (q.source) where.source = q.source;
    const [total, items] = await Promise.all([
      prisma.apiErrorLog.count({ where }),
      prisma.apiErrorLog.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        // Payload may contain sensitive data — never return it. Only return
        // the safe fields: id, source, route, message, createdAt.
        items: items.map((e) => ({
          id: e.id,
          source: e.source,
          route: e.route,
          message: e.message,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/admin/reports/games", async (req) => {
    await requireAdmin(req, "reports.read");
    const rows = await prisma.$queryRaw<{ code: string; name: string; bets: bigint; amount: bigint; payouts: bigint; rounds: bigint }[]>`
      SELECT g.code, g.name, COUNT(b.id) AS bets, COALESCE(SUM(b.amount),0) AS amount,
             COALESCE((SELECT SUM(p.amount) FROM "Payout" p JOIN "Bet" b2 ON b2.id = p."betId" WHERE b2."gameKey" = g.id),0) AS payouts,
             COUNT(DISTINCT b."roundId") AS rounds
      FROM "Game" g LEFT JOIN "Bet" b ON b."gameKey" = g.id
      GROUP BY g.id, g.code, g.name ORDER BY amount DESC`;
    return { ok: true, data: rows.map((r) => ({ ...r, bets: Number(r.bets), amount: Number(r.amount), payouts: Number(r.payouts), rounds: Number(r.rounds), rtp: Number(r.amount) > 0 ? Number(r.payouts) / Number(r.amount) : null })) };
  });

  app.get("/v1/admin/reports/daily-rollup", async (req) => {
    await requireAdmin(req, "reports.read");
    const rows = await prisma.dailyRevenue.findMany({ orderBy: { day: "desc" }, take: 90 });
    return { ok: true, data: rows };
  });

  // --- Analytics module (Prompt 08) --------------------------------------
  //
  // Centralized analytics endpoints that aggregate real data from existing
  // models. All endpoints use `reports.read` permission and accept date
  // range filters (from/to as YYYY-MM-DD, UTC half-open [from, to)).
  //
  // Design principles:
  //   - Every metric comes from a real Prisma aggregate query.
  //   - No fabricated data, no mock metrics, no invented calculations.
  //   - Transaction volume ≠ revenue ≠ profit (clearly labelled).
  //   - Server status comes from process.* — no fabricated CPU/disk metrics.
  //   - CSV export has formula-injection sanitization + 5000-row cap.

  /** Helper: resolve a date range from the analytics query params. */
  function resolveAnalyticsRange(q: { from?: string; to?: string }): { from: Date | undefined; to: Date | undefined } {
    let from: Date | undefined;
    let to: Date | undefined;
    if (q.from) from = new Date(`${q.from}T00:00:00.000Z`);
    if (q.to) {
      const t = new Date(`${q.to}T00:00:00.000Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      to = t;
    }
    return { from, to };
  }

  /** Helper: build a Prisma DateTimeFilter from the range. */
  function dateFilter(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;
    const f: Prisma.DateTimeFilter = {};
    if (from) f.gte = from;
    if (to) f.lt = to;
    return f;
  }

  app.get("/v1/admin/analytics/overview", async (req) => {
    await requireAdmin(req, "reports.read");
    const q = validate(analyticsQuerySchema, queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);
    const df = dateFilter(from, to);

    const [
      totalUsers, newUsers, totalAgencies, activeAgencies,
      activeRooms, totalRooms,
      activeSessions, totalSessions,
      totalBets, wonBets, lostBets,
      totalRecharges, succeededRecharges, failedRecharges,
      totalLedgerEntries, creditEntries, debitEntries,
      totalPayouts, totalRefunds,
      openRoomReports, totalRoomReports,
      activeGames, maintenanceGames, disabledGames,
      totalProviders, enabledProviders,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: df ? { createdAt: df } : {} }),
      prisma.agency.count(),
      prisma.agency.count({ where: { active: true } }),
      prisma.room.count({ where: { closedAt: null } }),
      prisma.room.count(),
      prisma.gameSession.count({ where: { closedAt: null } }),
      prisma.gameSession.count(df ? { where: { openedAt: df } } : undefined),
      prisma.bet.count(df ? { where: { createdAt: df } } : undefined),
      prisma.bet.count({ where: { ...(df ? { createdAt: df } : undefined), status: "won" } }),
      prisma.bet.count({ where: { ...(df ? { createdAt: df } : undefined), status: "lost" } }),
      prisma.recharge.count(df ? { where: { createdAt: df } } : undefined),
      prisma.recharge.count({ where: { ...(df ? { createdAt: df } : undefined), status: "succeeded" } }),
      prisma.recharge.count({ where: { ...(df ? { createdAt: df } : undefined), status: "failed" } }),
      prisma.ledgerEntry.count(df ? { where: { createdAt: df } } : undefined),
      prisma.ledgerEntry.count({ where: { ...(df ? { createdAt: df } : undefined), amount: { gt: 0 } } }),
      prisma.ledgerEntry.count({ where: { ...(df ? { createdAt: df } : undefined), amount: { lt: 0 } } }),
      prisma.payout.count(df ? { where: { createdAt: df } } : undefined),
      prisma.refund.count(df ? { where: { createdAt: df } } : undefined),
      prisma.roomReport.count({ where: { status: { in: ["open", "in_review"] } } }),
      prisma.roomReport.count(),
      prisma.game.count({ where: { status: "active" } }),
      prisma.game.count({ where: { status: "maintenance" } }),
      prisma.game.count({ where: { status: "disabled" } }),
      prisma.gameProvider.count(),
      prisma.gameProvider.count({ where: { enabled: true } }),
    ]);

    return {
      ok: true,
      data: {
        users: { total: totalUsers, new: newUsers },
        agencies: { total: totalAgencies, active: activeAgencies },
        rooms: { total: totalRooms, active: activeRooms },
        sessions: { total: totalSessions, active: activeSessions },
        bets: { total: totalBets, won: wonBets, lost: lostBets },
        recharges: { total: totalRecharges, succeeded: succeededRecharges, failed: failedRecharges },
        ledger: { total: totalLedgerEntries, credits: creditEntries, debits: debitEntries },
        payouts: { total: totalPayouts },
        refunds: { total: totalRefunds },
        reports: { total: totalRoomReports, open: openRoomReports },
        games: { active: activeGames, maintenance: maintenanceGames, disabled: disabledGames },
        providers: { total: totalProviders, enabled: enabledProviders },
        // DAU/WAU/MAU not available — no daily active-user tracking table exists.
        hasActiveUserTracking: false,
        note: "All metrics are derived from real database records. DAU/WAU/MAU not available — no daily active-user tracking table exists.",
      },
    };
  });

  app.get("/v1/admin/analytics/financial", async (req) => {
    await requireAdmin(req, "reports.read");
    const q = validate(analyticsQuerySchema, queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);
    const df = dateFilter(from, to);

    const [
      rechargeVolume, betDebitVolume, winCreditVolume,
      giftDebitVolume, giftCreditVolume, refundVolume,
      adminAdjustVolume, agencyCommissionVolume,
      pendingRecharges, failedRecharges,
      pendingWithdrawals, approvedWithdrawals,
    ] = await Promise.all([
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "recharge" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "bet_debit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "win_credit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "gift_debit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "gift_credit" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "refund" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "admin_adjust" }, _sum: { amount: true } }),
      prisma.ledgerEntry.aggregate({ where: { ...(df ? { createdAt: df } : undefined), kind: "agency_commission" }, _sum: { amount: true } }),
      prisma.recharge.count({ where: { status: "pending" } }),
      prisma.recharge.count({ where: { status: "failed" } }),
      prisma.agencyWithdrawal.count({ where: { status: "pending" } }),
      prisma.agencyWithdrawal.count({ where: { status: "approved" } }),
    ]);

    return {
      ok: true,
      data: {
        currency: "coins",
        rechargeVolume: rechargeVolume._sum.amount ?? 0,
        betDebitVolume: Math.abs(betDebitVolume._sum.amount ?? 0),
        winCreditVolume: winCreditVolume._sum.amount ?? 0,
        giftDebitVolume: Math.abs(giftDebitVolume._sum.amount ?? 0),
        giftCreditVolume: giftCreditVolume._sum.amount ?? 0,
        refundVolume: Math.abs(refundVolume._sum.amount ?? 0),
        adminAdjustVolume: adminAdjustVolume._sum.amount ?? 0,
        agencyCommissionVolume: agencyCommissionVolume._sum.amount ?? 0,
        pendingRecharges, failedRecharges,
        pendingWithdrawals, approvedWithdrawals,
        netGamingMargin: Math.abs(betDebitVolume._sum.amount ?? 0) - (winCreditVolume._sum.amount ?? 0),
        note: "Net gaming margin = bet debits - win credits. NOT platform profit. Commission is settled separately via ProviderBill.",
      },
    };
  });

  app.get("/v1/admin/analytics/users", async (req) => {
    await requireAdmin(req, "reports.read");
    const q = validate(analyticsQuerySchema, queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);

    // Daily registration series.
    const series = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT d::date AS day, COUNT(u.id) AS count
      FROM generate_series(
        ${from ? from.toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString()}::timestamptz,
        ${to ? to.toISOString() : new Date().toISOString()}::timestamptz,
        INTERVAL '1 day'
      ) d
      LEFT JOIN "User" u ON u."createdAt"::date = d::date
      GROUP BY d ORDER BY d`;

    // Country distribution.
    const countryDist = await prisma.$queryRaw<{ country: string; count: bigint }[]>`
      SELECT country, COUNT(*) as count FROM "User" GROUP BY country ORDER BY count DESC LIMIT 20`;

    // Account status distribution (from PlayerRestriction).
    const [banned, muted, frozen, totalUsers] = await Promise.all([
      prisma.playerRestriction.count({ where: { type: "ban", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      prisma.playerRestriction.count({ where: { type: "mute", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      prisma.playerRestriction.count({ where: { type: "freeze_wallet", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      prisma.user.count(),
    ]);

    return {
      ok: true,
      data: {
        registrationSeries: series.map((s) => ({ day: new Date(s.day).toISOString().slice(0, 10), count: Number(s.count) })),
        countryDistribution: countryDist.map((c) => ({ country: c.country, count: Number(c.count) })),
        statusDistribution: {
          total: totalUsers,
          active: Math.max(0, totalUsers - banned - muted - frozen),
          banned, muted, frozen,
        },
        hasRetentionData: false,
        note: "Registration series uses real User.createdAt. Retention/cohort analysis not available — no daily login tracking table exists.",
      },
    };
  });

  app.get("/v1/admin/analytics/live", async (req) => {
    await requireAdmin(req, "reports.read");
    const q = validate(analyticsQuerySchema, queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);

    const df = dateFilter(from, to);

    const [
      totalRooms, activeRooms, closedRooms,
      liveRooms, voiceRooms, partyRooms,
      totalParticipants, totalRoomReports,
      roomSeries,
    ] = await Promise.all([
      prisma.room.count(df ? { where: { createdAt: df } } : undefined),
      prisma.room.count({ where: { closedAt: null } }),
      prisma.room.count({ where: { closedAt: { not: null } } }),
      prisma.room.count({ where: { type: "live", ...(df ? { createdAt: df } : undefined) } }),
      prisma.room.count({ where: { type: "voice", ...(df ? { createdAt: df } : undefined) } }),
      prisma.room.count({ where: { type: "party", ...(df ? { createdAt: df } : undefined) } }),
      prisma.roomParticipant.count(df ? { where: { joinedAt: df } } : undefined),
      prisma.roomReport.count(df ? { where: { createdAt: df } } : undefined),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT d::date AS day, COUNT(r.id) AS count
        FROM generate_series(
          ${from ? from.toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString()}::timestamptz,
          ${to ? to.toISOString() : new Date().toISOString()}::timestamptz,
          INTERVAL '1 day'
        ) d
        LEFT JOIN "Room" r ON r."createdAt"::date = d::date
        GROUP BY d ORDER BY d`,
    ]);

    return {
      ok: true,
      data: {
        totalRooms, activeRooms, closedRooms,
        byType: { live: liveRooms, voice: voiceRooms, party: partyRooms },
        totalParticipants, totalRoomReports,
        roomCreationSeries: roomSeries.map((s) => ({ day: new Date(s.day).toISOString().slice(0, 10), count: Number(s.count) })),
        // Average room duration not available — no room-endedAt tracking on
        // closed rooms in a way that's reliably populated.
        hasDurationData: false,
        note: "Room counts are real. Average room duration not available — closedAt is not consistently populated.",
      },
    };
  });

  app.get("/v1/admin/analytics/games", async (req) => {
    await requireAdmin(req, "reports.read");
    const q = validate(analyticsQuerySchema, queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);
    const df = dateFilter(from, to);

    const [
      totalGames, activeGames, maintenanceGames,
      totalSessions, activeSessions,
      totalBets, placedBets, wonBets, lostBets,
      totalBetVolume, totalPayoutVolume,
      sessionSeries,
    ] = await Promise.all([
      prisma.game.count(),
      prisma.game.count({ where: { status: "active" } }),
      prisma.game.count({ where: { status: "maintenance" } }),
      prisma.gameSession.count(df ? { where: { openedAt: df } } : undefined),
      prisma.gameSession.count({ where: { closedAt: null } }),
      prisma.bet.count(df ? { where: { createdAt: df } } : undefined),
      prisma.bet.count({ where: { ...(df ? { createdAt: df } : undefined), status: "placed" } }),
      prisma.bet.count({ where: { ...(df ? { createdAt: df } : undefined), status: "won" } }),
      prisma.bet.count({ where: { ...(df ? { createdAt: df } : undefined), status: "lost" } }),
      prisma.bet.aggregate({ where: df ? { createdAt: df } : undefined, _sum: { amount: true } }),
      prisma.payout.aggregate({ where: df ? { createdAt: df } : undefined, _sum: { amount: true } }),
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT d::date AS day, COUNT(gs.id) AS count
        FROM generate_series(
          ${from ? from.toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString()}::timestamptz,
          ${to ? to.toISOString() : new Date().toISOString()}::timestamptz,
          INTERVAL '1 day'
        ) d
        LEFT JOIN "GameSession" gs ON gs."openedAt"::date = d::date
        GROUP BY d ORDER BY d`,
    ]);

    return {
      ok: true,
      data: {
        totalGames, activeGames, maintenanceGames,
        totalSessions, activeSessions,
        totalBets, placedBets, wonBets, lostBets,
        totalBetVolume: totalBetVolume._sum.amount ?? 0,
        totalPayoutVolume: totalPayoutVolume._sum.amount ?? 0,
        netGamingMargin: (totalBetVolume._sum.amount ?? 0) - (totalPayoutVolume._sum.amount ?? 0),
        sessionSeries: sessionSeries.map((s) => ({ day: new Date(s.day).toISOString().slice(0, 10), count: Number(s.count) })),
        note: "Net gaming margin = bet volume - payout volume. NOT platform profit.",
      },
    };
  });

  app.get("/v1/admin/analytics/providers", async (req) => {
    await requireAdmin(req, "reports.read");
    const q = validate(analyticsQuerySchema, queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);
    const df = dateFilter(from, to);

    const [
      totalProviders, enabledProviders, disabledProviders,
      totalApiErrors, providerErrors,
    ] = await Promise.all([
      prisma.gameProvider.count(),
      prisma.gameProvider.count({ where: { enabled: true } }),
      prisma.gameProvider.count({ where: { enabled: false } }),
      prisma.apiErrorLog.count(df ? { where: { createdAt: df } } : undefined),
      prisma.apiErrorLog.count({ where: { ...(df ? { createdAt: df } : undefined), source: "provider" } }),
    ]);

    // Per-provider game count + error count.
    const providers = await prisma.gameProvider.findMany({
      select: {
        id: true, name: true, code: true, enabled: true,
        _count: { select: { games: true } },
      },
    });

    return {
      ok: true,
      data: {
        totalProviders, enabledProviders, disabledProviders,
        totalApiErrors, providerErrors,
        providers: providers.map((p) => ({
          id: p.id, name: p.name, code: p.code, enabled: p.enabled,
          gameCount: p._count.games,
        })),
        hasResponseTimeData: false,
        note: "Provider error counts are from ApiErrorLog. No API response-time tracking — not instrumented.",
      },
    };
  });

  app.get("/v1/admin/analytics/system", async (req) => {
    await requireAdmin(req, "security.read");
    const mem = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    return {
      ok: true,
      data: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        memory: {
          rssMb: Math.round(mem.rss / 1024 / 1024),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
          externalMb: Math.round(mem.external / 1024 / 1024),
        },
        cpu: {
          userMicros: cpuUsage.user,
          systemMicros: cpuUsage.system,
        },
        pid: process.pid,
        time: new Date().toISOString(),
        // No external monitoring integration (Prometheus, Datadog, etc.)
        hasExternalMonitoring: false,
        hasDatabaseMetrics: false,
        hasCacheMetrics: false,
        note: "System metrics from process.* — real Node.js runtime data. No external monitoring (Prometheus/Datadog) integration. Database/cache metrics not instrumented.",
      },
    };
  });

  app.get("/v1/admin/analytics/errors", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(analyticsQuerySchema.extend({
      source: z.string().trim().max(60).optional(),
    }), queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);
    const df = dateFilter(from, to);

    const where: Prisma.ApiErrorLogWhereInput = {};
    if (df) where.createdAt = df;
    if (q.source) where.source = q.source;

    const [total, bySource] = await Promise.all([
      prisma.apiErrorLog.count({ where }),
      prisma.apiErrorLog.groupBy({
        by: ["source"],
        where,
        _count: true,
        orderBy: { _count: { source: "desc" } },
      }),
    ]);

    return {
      ok: true,
      data: {
        total,
        bySource: bySource.map((s) => ({ source: s.source, count: s._count })),
      },
    };
  });

  app.get("/v1/admin/analytics/export", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    await requireAdmin(req, "reports.read");
    const q = validate(analyticsQuerySchema.extend({
      category: z.enum(["users", "rooms", "sessions", "bets", "recharges", "ledger"]),
    }), queryOf(req));
    const { from, to } = resolveAnalyticsRange(q);
    const df = dateFilter(from, to);

    const headers: string[] = [];
    const rows: Record<string, unknown>[] = [];

    if (q.category === "users") {
      headers.push("id", "displayName", "country", "marketCode", "vipLevel", "createdAt");
      const items = await prisma.user.findMany({
        where: df ? { createdAt: df } : {},
        orderBy: { id: "asc" },
        take: 5000,
        select: { id: true, displayName: true, country: true, marketCode: true, vipLevel: true, createdAt: true },
      });
      items.forEach((u) => rows.push({
        id: u.id, displayName: u.displayName, country: u.country, marketCode: u.marketCode,
        vipLevel: u.vipLevel, createdAt: u.createdAt.toISOString(),
      }));
    } else if (q.category === "rooms") {
      headers.push("id", "title", "type", "country", "status", "createdAt", "closedAt");
      const items = await prisma.room.findMany({
        where: df ? { createdAt: df } : {},
        orderBy: { id: "asc" },
        take: 5000,
        select: { id: true, title: true, type: true, country: true, closedAt: true, createdAt: true },
      });
      items.forEach((r) => rows.push({
        id: r.id, title: r.title, type: r.type, country: r.country,
        status: r.closedAt ? "closed" : "active",
        createdAt: r.createdAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? "",
      }));
    } else if (q.category === "sessions") {
      headers.push("id", "sessionKey", "userId", "gameId", "marketCode", "openedAt", "closedAt");
      const items = await prisma.gameSession.findMany({
        where: df ? { openedAt: df } : {},
        orderBy: { id: "asc" },
        take: 5000,
      });
      items.forEach((s) => rows.push({
        id: s.id, sessionKey: s.sessionKey, userId: s.userId, gameId: s.gameId,
        marketCode: s.marketCode, openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? "",
      }));
    } else if (q.category === "bets") {
      headers.push("id", "userId", "amount", "status", "payout", "providerTxId", "createdAt", "settledAt");
      const items = await prisma.bet.findMany({
        where: df ? { createdAt: df } : {},
        orderBy: { id: "asc" },
        take: 5000,
      });
      items.forEach((b) => rows.push({
        id: b.id, userId: b.userId, amount: b.amount, status: b.status, payout: b.payout,
        providerTxId: b.providerTxId, createdAt: b.createdAt.toISOString(),
        settledAt: b.settledAt?.toISOString() ?? "",
      }));
    } else if (q.category === "recharges") {
      headers.push("id", "userId", "amount", "provider", "status", "externalId", "createdAt");
      const items = await prisma.recharge.findMany({
        where: df ? { createdAt: df } : {},
        orderBy: { id: "asc" },
        take: 5000,
      });
      items.forEach((r) => rows.push({
        id: r.id, userId: r.userId, amount: r.amount, provider: r.provider,
        status: r.status, externalId: r.externalId, createdAt: r.createdAt.toISOString(),
      }));
    } else if (q.category === "ledger") {
      headers.push("id", "userId", "kind", "amount", "balanceAfter", "txKey", "createdAt");
      const items = await prisma.ledgerEntry.findMany({
        where: df ? { createdAt: df } : {},
        orderBy: { id: "asc" },
        take: 5000,
      });
      items.forEach((e) => rows.push({
        id: e.id.toString(), userId: e.userId, kind: e.kind, amount: e.amount,
        balanceAfter: e.balanceAfter, txKey: e.txKey, createdAt: e.createdAt.toISOString(),
      }));
    }

    const escape = (v: unknown): string => {
      let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const lines = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ];
    const csv = lines.join("\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${q.category}-${stamp}.csv"`);
    reply.header("x-export-row-count", String(rows.length));
    return csv;
  });

  // --- Providers & settlement -------------------------------------------------
  app.get("/v1/admin/settlement/bills", async (req) => {
    await requireAdmin(req, "providers.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.providerBill.count(),
      prisma.providerBill.findMany({ orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { provider: { select: { name: true, code: true } } } }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.post("/v1/admin/settlement/generate-bills", async (req) => {
    const admin = await requireAdmin(req, "providers.write");
    const { generateProviderBills } = await import("../../workers/bills.js");
    const result = await generateProviderBills(new Date());
    await writeAudit({ adminId: admin.id, req, action: "generate_bills", entity: "provider_bill", after: result });
    return { ok: true, data: result };
  });

  app.get("/v1/admin/settlement/records", async (req) => {
    await requireAdmin(req, "providers.read");
    const items = await prisma.settlementRecord.findMany({ orderBy: { id: "desc" }, take: 200, include: { provider: { select: { name: true } } } });
    return { ok: true, data: items };
  });

  // --- Security ---------------------------------------------------------------
  // --- System Settings, Security, Admin Roles & Audit Logs (Prompt 09) ------
  //
  // Extends existing security/settings routes with:
  //   - Admin user list (filtered, paginated, with role + agency join)
  //   - Admin user detail (with audit history + security events)
  //   - Admin user activation/deactivation (with last-super-admin protection)
  //   - Admin user role change (with super_admin protection)
  //   - All permissions list (organized by module)
  //   - Audit log with filters (admin, entity, action, date range)
  //   - Security events with filters (kind, date range)
  //   - System settings overview (all Setting + FeatureFlag records)
  //   - System settings update (single key → value, audited)
  //
  // Permissions:
  //   - security.read — view admin users, roles, permissions, audit, events
  //   - security.write — manage admin users, roles, permissions
  //   - settings.read — view system settings
  //   - settings.write — modify system settings

  // --- Admin user management ----------------------------------------------
  app.get("/v1/admin/admin-users", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(paginationQuery, queryOf(req));
    const where: Prisma.AdminUserWhereInput = {};
    if (q.search) {
      where.OR = [
        { username: { contains: q.search, mode: "insensitive" } },
        { displayName: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search, mode: "insensitive" } },
      ];
    }
    const roleKey = (req.query as { roleKey?: string }).roleKey;
    if (roleKey) where.role = { key: roleKey };
    const [total, items] = await Promise.all([
      prisma.adminUser.count({ where }),
      prisma.adminUser.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          role: { select: { id: true, key: true, name: true } },
          agency: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((a) => ({
          id: a.id,
          username: a.username,
          email: a.email,
          displayName: a.displayName,
          role: a.role,
          agency: a.agency,
          active: a.active,
          lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    };
  });

  app.get("/v1/admin/admin-users/:id", async (req) => {
    await requireAdmin(req, "security.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const [admin, auditLogs, securityEvents] = await Promise.all([
      prisma.adminUser.findUnique({
        where: { id },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          agency: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.auditLog.findMany({ where: { adminId: id }, orderBy: { id: "desc" }, take: 30 }),
      prisma.securityEvent.findMany({ where: { meta: { path: ["adminId"], equals: id } }, orderBy: { id: "desc" }, take: 20 } as never),
    ]);
    if (!admin) throw notFound("admin user not found");
    return {
      ok: true,
      data: {
        profile: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          displayName: admin.displayName,
          active: admin.active,
          lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
          createdAt: admin.createdAt.toISOString(),
          updatedAt: admin.updatedAt.toISOString(),
          role: admin.role ? {
            id: admin.role.id, key: admin.role.key, name: admin.role.name,
            permissions: admin.role.permissions.map((p) => p.permission.key),
          } : null,
          agency: admin.agency,
        },
        recentAudit: auditLogs.map((a) => ({
          id: a.id, action: a.action, entity: a.entity, entityId: a.entityId,
          ip: a.ip, createdAt: a.createdAt.toISOString(),
        })),
        // Security events may not have adminId in meta — this is best-effort.
        recentSecurityEvents: securityEvents.map((e) => ({
          id: e.id, kind: e.kind, message: e.message, ip: e.ip, createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  });

  app.patch("/v1/admin/admin-users/:id", async (req) => {
    const admin = await requireAdmin(req, "security.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      active: z.boolean().optional(),
      roleKey: z.string().optional(),
      displayName: z.string().min(2).max(60).optional(),
    }), bodyOf(req));

    const target = await prisma.adminUser.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw notFound("admin user not found");

    // Last super_admin protection: if deactivating or changing role away from
    // super_admin, verify at least one other active super_admin remains.
    if (target.role.key === "super_admin") {
      if (input.active === false || (input.roleKey && input.roleKey !== "super_admin")) {
        const otherSuperAdmins = await prisma.adminUser.count({
          where: {
            active: true,
            id: { not: id },
            role: { key: "super_admin" },
          },
        });
        if (otherSuperAdmins === 0) {
          throw badRequest("Cannot deactivate or demote the last active super_admin");
        }
      }
    }

    const before: Record<string, unknown> = {
      active: target.active,
      displayName: target.displayName,
      role: target.role.key,
    };

    const updateData: Record<string, unknown> = {};
    if (input.active !== undefined) updateData.active = input.active;
    if (input.displayName !== undefined) updateData.displayName = input.displayName;
    if (input.roleKey) {
      const role = await prisma.role.findUnique({ where: { key: input.roleKey } });
      if (!role) throw badRequest("unknown role");
      updateData.roleId = role.id;
    }

    const after = await prisma.adminUser.update({ where: { id }, data: updateData, include: { role: true } });
    await writeAudit({
      adminId: admin.id, req,
      action: "update_admin_user",
      entity: "admin_user", entityId: id,
      before,
      after: { active: after.active, displayName: after.displayName, role: after.role.key },
    });
    return { ok: true, data: { id: after.id, active: after.active, role: after.role.key } };
  });

  // --- All permissions list ------------------------------------------------
  app.get("/v1/admin/permissions", async (req) => {
    await requireAdmin(req, "security.read");
    const perms = await prisma.permission.findMany({ orderBy: { key: "asc" } });
    return { ok: true, data: perms.map((p) => ({ id: p.id, key: p.key, description: p.description })) };
  });

  // --- Enhanced audit log with filters -------------------------------------
  app.get("/v1/admin/security/audit", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(paginationQuery.extend({
      adminId: z.coerce.number().int().positive().optional(),
      entity: z.string().trim().max(60).optional(),
      action: z.string().trim().max(60).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), queryOf(req));
    const where: Prisma.AuditLogWhereInput = {};
    if (q.search) where.OR = [{ action: { contains: q.search } }, { entity: { contains: q.search } }];
    if (q.adminId) where.adminId = q.adminId;
    if (q.entity) where.entity = q.entity;
    if (q.action) where.action = { contains: q.action };
    if (q.from || q.to) {
      const f: Prisma.DateTimeFilter = {};
      if (q.from) f.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) {
        const t = new Date(`${q.to}T00:00:00.000Z`);
        t.setUTCDate(t.getUTCDate() + 1);
        f.lt = t;
      }
      where.createdAt = f;
    }
    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { admin: { select: { id: true, username: true, displayName: true } } },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        // Never expose before/after that might contain secrets — only safe fields.
        items: items.map((a) => ({
          id: a.id,
          adminId: a.adminId,
          admin: a.admin ? { id: a.admin.id, username: a.admin.username, displayName: a.admin.displayName } : null,
          action: a.action,
          entity: a.entity,
          entityId: a.entityId,
          ip: a.ip,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    };
  });

  // --- Audit log CSV export ------------------------------------------------
  app.get("/v1/admin/security/audit/export", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    await requireAdmin(req, "security.read");
    const rows = await prisma.auditLog.findMany({
      orderBy: { id: "desc" },
      take: 5000,
      include: { admin: { select: { username: true, displayName: true } } },
    });
    const headers = ["id", "adminId", "adminUsername", "action", "entity", "entityId", "ip", "createdAt"];
    const escape = (v: unknown): string => {
      let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      headers.join(","),
      ...rows.map((a) => headers.map((h) => {
        switch (h) {
          case "id": return escape(a.id);
          case "adminId": return escape(a.adminId ?? "");
          case "adminUsername": return escape(a.admin?.username ?? "");
          case "action": return escape(a.action);
          case "entity": return escape(a.entity);
          case "entityId": return escape(a.entityId ?? "");
          case "ip": return escape(a.ip);
          case "createdAt": return escape(a.createdAt.toISOString());
          default: return "";
        }
      }).join(",")),
    ];
    const csv = lines.join("\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="audit-${stamp}.csv"`);
    reply.header("x-export-row-count", String(rows.length));
    return csv;
  });

  // --- System settings overview --------------------------------------------
  app.get("/v1/admin/settings/overview", async (req) => {
    await requireAdmin(req, "settings.read");
    const [settings, featureFlags, adminCount, roleCount, permCount, recentAudit] = await Promise.all([
      prisma.setting.findMany({ orderBy: { key: "asc" } }),
      prisma.featureFlag.findMany({ orderBy: { key: "asc" } }),
      prisma.adminUser.count(),
      prisma.role.count(),
      prisma.permission.count(),
      prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: 5, include: { admin: { select: { username: true, displayName: true } } } }),
    ]);
    return {
      ok: true,
      data: {
        platform: {
          name: "SM Live",
          version: "0.1.0",
          environment: process.env.NODE_ENV ?? "development",
          timezone: "UTC",
          nodeVersion: process.version,
          uptimeSeconds: Math.floor(process.uptime()),
        },
        settings: settings.map((s) => ({
          key: s.key, value: s.value, description: s.description,
          updatedAt: s.updatedAt.toISOString(),
        })),
        featureFlags: featureFlags.map((f) => ({
          id: f.id, key: f.key, description: f.description,
          enabled: f.enabled, rolloutPct: f.rolloutPct,
        })),
        counts: {
          admins: adminCount,
          roles: roleCount,
          permissions: permCount,
        },
        recentAudit: recentAudit.map((a) => ({
          id: a.id,
          action: a.action,
          entity: a.entity,
          admin: a.admin?.displayName ?? "system",
          createdAt: a.createdAt.toISOString(),
        })),
        // No maintenance-mode backend mechanism exists.
        hasMaintenanceMode: false,
        // No email/notification infrastructure.
        hasNotificationService: false,
        // No IP allow/block list beyond provider API keys.
        hasIPRestrictions: false,
        // No MFA infrastructure.
        hasMFA: false,
        // No session management table for admin sessions.
        hasAdminSessionManagement: false,
      },
    };
  });

  // --- System setting update -----------------------------------------------
  app.patch("/v1/admin/settings/:key", async (req) => {
    const admin = await requireAdmin(req, "settings.write");
    const { key } = validate(z.object({ key: z.string().min(1).max(80) }), paramsOf(req));
    const input = validate(z.object({
      value: z.string().trim().min(1).max(2000),
      description: z.string().trim().max(200).optional(),
    }), bodyOf(req));

    const before = await prisma.setting.findUnique({ where: { key } });
    // Setting might not exist yet — upsert.
    const after = await prisma.setting.upsert({
      where: { key },
      update: { value: input.value, ...(input.description ? { description: input.description } : {}) },
      create: { key, value: input.value, description: input.description ?? "" },
    });
    await writeAudit({
      adminId: admin.id, req,
      action: "update_setting",
      entity: "setting", entityId: key,
      before: before ? { value: before.value } : null,
      after: { value: after.value },
    });
    return { ok: true, data: { key: after.key, value: after.value } };
  });

  // --- Feature flag update -------------------------------------------------
  app.patch("/v1/admin/feature-flags/:id", async (req) => {
    const admin = await requireAdmin(req, "settings.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      enabled: z.boolean().optional(),
      rolloutPct: z.coerce.number().int().min(0).max(100).optional(),
      description: z.string().trim().max(200).optional(),
    }), bodyOf(req));
    const before = await prisma.featureFlag.findUnique({ where: { id } });
    if (!before) throw notFound("feature flag not found");
    const after = await prisma.featureFlag.update({ where: { id }, data: input });
    await writeAudit({
      adminId: admin.id, req,
      action: "update_feature_flag",
      entity: "feature_flag", entityId: String(id),
      before: { enabled: before.enabled, rolloutPct: before.rolloutPct },
      after: { enabled: after.enabled, rolloutPct: after.rolloutPct },
    });
    return { ok: true, data: { id: after.id, key: after.key, enabled: after.enabled, rolloutPct: after.rolloutPct } };
  });

  app.get("/v1/admin/security/events", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.securityEvent.count(),
      prisma.securityEvent.findMany({ orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  // --- API Integration & Webhook Management (Prompt 10) -------------------
  //
  // Extends the existing provider management with:
  //   - API access key management (CRUD for ApiAccessKey, secrets masked)
  //   - Provider integration summary (API errors, webhook events, health)
  //   - Webhook event log (read-only — derived from GameRound settlements)
  //   - Provider health check (simple — checks enabled + apiBase reachable)
  //   - API error logs with provider filter (enhanced)
  //
  // All credential data is masked — apiKey and apiSecret are NEVER returned.
  // Permissions: providers.read for viewing, providers.write for managing.

  // --- API access key management ------------------------------------------
  app.get("/v1/admin/providers/:id/api-keys", async (req) => {
    await requireAdmin(req, "providers.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const provider = await prisma.gameProvider.findUnique({ where: { id }, select: { id: true } });
    if (!provider) throw notFound("provider not found");
    const keys = await prisma.apiAccessKey.findMany({ where: { providerId: id } });
    return {
      ok: true,
      data: keys.map((k) => ({
        id: k.id,
        label: k.label,
        providerId: k.providerId,
        // Key is NEVER returned in full — only first 4 + last 2 chars.
        keyMasked: k.key ? k.key.slice(0, 4) + "…" + k.key.slice(-2) : "",
        ipAllowList: k.ipAllowList,
        enabled: k.enabled,
      })),
    };
  });

  app.post("/v1/admin/providers/:id/api-keys", async (req) => {
    const admin = await requireAdmin(req, "providers.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      label: z.string().trim().min(1).max(60),
      key: z.string().trim().min(8).max(80),
      ipAllowList: z.string().trim().max(500).default("127.0.0.1,::1"),
      enabled: z.boolean().default(true),
    }), bodyOf(req));
    const provider = await prisma.gameProvider.findUnique({ where: { id }, select: { id: true } });
    if (!provider) throw notFound("provider not found");
    try {
      const created = await prisma.apiAccessKey.create({ data: { ...input, providerId: id } });
      await writeAudit({ adminId: admin.id, req, action: "create_api_key", entity: "provider", entityId: id, after: { keyId: created.id, label: created.label } });
      return { ok: true, data: { id: created.id, label: created.label, keyMasked: created.key.slice(0, 4) + "…" + created.key.slice(-2) } };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw badRequest("API key already exists");
      throw e;
    }
  });

  app.patch("/v1/admin/providers/:id/api-keys/:keyId", async (req) => {
    const admin = await requireAdmin(req, "providers.write");
    const { id, keyId } = validate(z.object({ id: z.coerce.number(), keyId: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      label: z.string().trim().min(1).max(60).optional(),
      key: z.string().trim().min(8).max(80).optional(),
      ipAllowList: z.string().trim().max(500).optional(),
      enabled: z.boolean().optional(),
    }), bodyOf(req));
    const before = await prisma.apiAccessKey.findUnique({ where: { id: keyId } });
    if (!before) throw notFound("API key not found");
    if (before.providerId !== id) throw badRequest("API key does not belong to this provider");
    const after = await prisma.apiAccessKey.update({ where: { id: keyId }, data: input });
    await writeAudit({ adminId: admin.id, req, action: "update_api_key", entity: "provider", entityId: id, before: { label: before.label, enabled: before.enabled }, after: { label: after.label, enabled: after.enabled } });
    return { ok: true, data: { id: after.id, label: after.label, keyMasked: after.key ? after.key.slice(0, 4) + "…" + after.key.slice(-2) : "", enabled: after.enabled } };
  });

  app.delete("/v1/admin/providers/:id/api-keys/:keyId", async (req) => {
    const admin = await requireAdmin(req, "providers.write");
    const { id, keyId } = validate(z.object({ id: z.coerce.number(), keyId: z.coerce.number() }), paramsOf(req));
    const before = await prisma.apiAccessKey.findUnique({ where: { id: keyId } });
    if (!before) throw notFound("API key not found");
    if (before.providerId !== id) throw badRequest("API key does not belong to this provider");
    await prisma.apiAccessKey.delete({ where: { id: keyId } });
    await writeAudit({ adminId: admin.id, req, action: "delete_api_key", entity: "provider", entityId: id, before: { label: before.label } });
    return { ok: true };
  });

  // --- Provider credential rotation (apiKey/apiSecret) --------------------
  app.post("/v1/admin/providers/:id/rotate-credentials", async (req) => {
    const admin = await requireAdmin(req, "providers.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({
      apiKey: z.string().trim().min(8).max(120),
      apiSecret: z.string().trim().min(8).max(200),
    }), bodyOf(req));
    const before = await prisma.gameProvider.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!before) throw notFound("provider not found");
    await prisma.gameProvider.update({ where: { id }, data: { apiKey: input.apiKey, apiSecret: input.apiSecret } });
    await writeAudit({ adminId: admin.id, req, action: "rotate_provider_credentials", entity: "provider", entityId: id, after: { rotated: true } });
    return { ok: true, data: { id, rotated: true } };
  });

  // --- Integration summary -------------------------------------------------
  app.get("/v1/admin/integration/summary", async (req) => {
    await requireAdmin(req, "providers.read");
    const [totalProviders, enabledProviders, disabledProviders, totalApiKeys, enabledApiKeys, totalApiErrors24h, providerErrors24h, totalGameSessions, activeGameSessions, totalWebhookSettlements] = await Promise.all([
      prisma.gameProvider.count(),
      prisma.gameProvider.count({ where: { enabled: true } }),
      prisma.gameProvider.count({ where: { enabled: false } }),
      prisma.apiAccessKey.count(),
      prisma.apiAccessKey.count({ where: { enabled: true } }),
      prisma.apiErrorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      prisma.apiErrorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, source: "provider" } }),
      prisma.gameSession.count(),
      prisma.gameSession.count({ where: { closedAt: null } }),
      prisma.gameRound.count({ where: { settleSource: "webhook" } }),
    ]);
    return {
      ok: true,
      data: {
        providers: { total: totalProviders, enabled: enabledProviders, disabled: disabledProviders },
        apiKeys: { total: totalApiKeys, enabled: enabledApiKeys },
        apiErrors24h: totalApiErrors24h,
        providerErrors24h: providerErrors24h,
        gameSessions: { total: totalGameSessions, active: activeGameSessions },
        webhookSettlements: totalWebhookSettlements,
        // No dedicated health-check endpoint configured.
        hasHealthChecks: false,
        // No separate sandbox/production environment model.
        hasEnvironments: false,
        // No dedicated webhook event log table — webhook events are tracked
        // via GameRound.settleSource = "webhook".
        hasWebhookEventLog: false,
        note: "Webhook settlements tracked via GameRound.settleSource='webhook'. No dedicated webhook event log table. No sandbox/production environment separation.",
      },
    };
  });

  // --- Webhook event log (derived from GameRound settlements) -------------
  app.get("/v1/admin/integration/webhooks", async (req) => {
    await requireAdmin(req, "providers.read");
    const q = validate(paginationQuery, queryOf(req));
    const where: Prisma.GameRoundWhereInput = { settleSource: "webhook" };
    if (q.search) where.roundId = { contains: q.search };
    const [total, items] = await Promise.all([
      prisma.gameRound.count({ where }),
      prisma.gameRound.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          game: { select: { code: true, name: true, provider: { select: { id: true, name: true } } } },
          bets: { select: { id: true, userId: true, amount: true, status: true, providerTxId: true } },
        },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((r) => ({
          id: r.id,
          roundId: r.roundId,
          gameId: r.gameId,
          gameCode: r.game.code,
          gameName: r.game.name,
          providerId: r.game.provider?.id ?? null,
          providerName: r.game.provider?.name ?? null,
          status: r.status,
          settleSource: r.settleSource,
          startedAt: r.startedAt.toISOString(),
          endedAt: r.endedAt?.toISOString() ?? null,
          betCount: r.bets.length,
          bets: r.bets.map((b) => ({ id: b.id, userId: b.userId, amount: b.amount, status: b.status, providerTxId: b.providerTxId })),
        })),
      },
    };
  });

  // --- Provider health check (simple — no external requests) -------------
  app.get("/v1/admin/providers/:id/health", async (req) => {
    await requireAdmin(req, "providers.read");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const provider = await prisma.gameProvider.findUnique({
      where: { id },
      select: { id: true, name: true, enabled: true, apiBase: true, _count: { select: { games: true, apiKeys: true } } },
    });
    if (!provider) throw notFound("provider not found");
    const [errors24h, lastError, recentSessions] = await Promise.all([
      prisma.apiErrorLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) }, source: "provider" } }),
      prisma.apiErrorLog.findFirst({ where: { source: "provider" }, orderBy: { id: "desc" }, select: { id: true, route: true, message: true, createdAt: true } }),
      prisma.gameSession.count({ where: { game: { providerId: id }, openedAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    const status = !provider.enabled ? "disabled" : errors24h > 5 ? "degraded" : "operational";
    return {
      ok: true,
      data: {
        providerId: provider.id,
        providerName: provider.name,
        enabled: provider.enabled,
        apiBase: provider.apiBase,
        gameCount: provider._count.games,
        apiKeyCount: provider._count.apiKeys,
        status,
        errors24h,
        lastError: lastError ? { id: lastError.id, route: lastError.route, message: lastError.message, createdAt: lastError.createdAt.toISOString() } : null,
        recentSessions24h: recentSessions,
        // No external health-check endpoint — status is inferred from enabled
        // flag + API error activity.
        healthCheckMethod: "inferred",
        note: "Status inferred from enabled flag + API error log activity in last 24h. No external health-check endpoint configured.",
      },
    };
  });

  app.get("/v1/admin/security/api-errors", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.apiErrorLog.count(),
      prisma.apiErrorLog.findMany({ orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.get("/v1/admin/security/status", async (req) => {
    await requireAdmin(req, "security.read");
    const mem = process.memoryUsage();
    return {
      ok: true,
      data: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        memoryMb: Math.round(mem.rss / 1024 / 1024),
        heapMb: Math.round(mem.heapUsed / 1024 / 1024),
        pid: process.pid,
        time: new Date().toISOString(),
      },
    };
  });

  // --- Roles & permissions editor ---------------------------------------------
  app.get("/v1/admin/roles", async (req) => {
    await requireAdmin(req, "security.read");
    const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { permissions: true } } } });
    return { ok: true, data: roles };
  });

  app.patch("/v1/admin/roles/:id/permissions", async (req) => {
    const admin = await requireAdmin(req, "security.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ permissions: z.array(z.string()).max(200) }), bodyOf(req));
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) throw notFound();
    if (role.key === "super_admin") throw forbidden("super_admin permissions are fixed");
    const perms = await prisma.permission.findMany({ where: { key: { in: input.permissions } } });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) }),
    ]);
    await writeAudit({ adminId: admin.id, req, action: "update_role_permissions", entity: "role", entityId: id, after: { permissions: input.permissions } });
    return { ok: true };
  });

  app.post("/v1/admin/admin-users", async (req) => {
    const admin = await requireAdmin(req, "security.write");
    const input = validate(z.object({
      username: z.string().min(3).max(60),
      email: z.string().email(),
      password: z.string().min(8),
      displayName: z.string().min(2),
      roleKey: z.string(),
      // Optional agency association — used by Prompt 04 to provision an
      // agency-scoped admin in one step. Refused for `super_admin` (a
      // super admin is platform-wide, never agency-scoped).
      agencyId: z.coerce.number().int().positive().nullable().optional(),
    }), bodyOf(req));
    const role = await prisma.role.findUnique({ where: { key: input.roleKey } });
    if (!role) throw badRequest("unknown role");
    if (role.key === "super_admin" && input.agencyId) throw badRequest("super_admin cannot be assigned to a single agency");
    if (input.agencyId) {
      const agency = await prisma.agency.findUnique({ where: { id: input.agencyId }, select: { id: true } });
      if (!agency) throw badRequest("unknown agency");
    }
    const created = await prisma.adminUser.create({
      data: {
        username: input.username, email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName, roleId: role.id,
        agencyId: input.agencyId ?? null,
      },
    });
    await writeAudit({ adminId: admin.id, req, action: "create_admin_user", entity: "admin_user", entityId: created.id, after: { username: created.username, role: input.roleKey, agencyId: input.agencyId ?? null } });
    return { ok: true, data: { id: created.id, username: created.username } };
  });

  // =========================================================================
  // Platform Operations, Monitoring, Maintenance & Backup (Prompt 12)
  // =========================================================================
  //
  // Routes are organised in 10 groups, mirroring the admin UI tabs:
  //   1. Operations dashboard
  //   2. Health checks
  //   3. Maintenance scheduling + activation
  //   4. Backup management (discover / run / verify / delete)
  //   5. Recovery (restore workflow, history)
  //   6. Incident management
  //   7. Operational alerts
  //   8. System logs (read-only, redacted)
  //   9. Background jobs / scheduled tasks
  //  10. Operational reports (CSV export)
  //
  // All write operations land in the audit log. Every endpoint enforces
  // a permission key (ops.*) on top of the existing auth check.

  // --- 1. Operations dashboard ---------------------------------------------
  app.get("/v1/admin/operations/dashboard", async (req) => {
    await requireAdmin(req, "ops.view");
    const now = new Date();
    const last24h = new Date(now.getTime() - 86_400_000);

    const [
      activeMaintenance,
      upcomingMaintenance,
      openIncidents,
      openAlerts,
      latestBackups,
      latestFailedBackups,
      recentRecoveries,
      apiErrors24h,
      securityEvents24h,
      auditActions24h,
      healthSummary,
    ] = await Promise.all([
      prisma.maintenanceSchedule.findFirst({
        where: { status: "active" },
        orderBy: { activatedAt: "desc" },
      }),
      prisma.maintenanceSchedule.findMany({
        where: { status: "scheduled", startAt: { gte: now } },
        orderBy: { startAt: "asc" },
        take: 5,
      }),
      prisma.operationalIncident.findMany({
        where: { status: { in: ["open", "investigating", "identified", "monitoring"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.systemAlert.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.backupRecord.findMany({
        where: { status: { in: ["succeeded", "verified"] } },
        orderBy: { completedAt: "desc" },
        take: 5,
      }),
      prisma.backupRecord.findFirst({
        where: { status: "failed" },
        orderBy: { completedAt: "desc" },
      }),
      prisma.recoveryRecord.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.apiErrorLog.count({ where: { createdAt: { gte: last24h } } }),
      prisma.securityEvent.count({ where: { createdAt: { gte: last24h } } }),
      prisma.auditLog.count({ where: { createdAt: { gte: last24h } } }),
      // Latest health-check result per component
      prisma.healthCheckResult.findMany({
        where: { checkedAt: { gte: new Date(now.getTime() - 15 * 60_000) } },
        orderBy: { checkedAt: "desc" },
        take: 100,
      }),
    ]);

    // Collapse health results to one row per component (latest only).
    const latestByComponent = new Map<string, typeof healthSummary[number]>();
    for (const h of healthSummary) {
      if (!latestByComponent.has(h.component)) latestByComponent.set(h.component, h);
    }
    const health = [...latestByComponent.values()].map((h) => ({
      component: h.component,
      status: h.status,
      responseTimeMs: h.responseTimeMs,
      details: h.details,
      checkedAt: h.checkedAt,
    }));
    const degraded = health.filter((h) => h.status === "degraded").length;
    const down = health.filter((h) => h.status === "down").length;

    // Determine overall platform health.
    let platformHealth: "healthy" | "warning" | "critical" | "unknown" = "healthy";
    if (down > 0 || openIncidents.some((i) => i.severity === "critical")) platformHealth = "critical";
    else if (degraded > 0 || openIncidents.length > 0 || openAlerts.length > 0) platformHealth = "warning";
    else if (health.length === 0) platformHealth = "unknown";

    // Infrastructure status from process.* — real Node.js runtime data,
    // NOT a fake uptime number.
    const mem = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const infra = {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      hostname: os.hostname(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        externalMb: Math.round(mem.external / 1024 / 1024),
      },
      cpu: { userMicros: cpuUsage.user, systemMicros: cpuUsage.system },
      pid: process.pid,
      loadAvg: os.loadavg(),
      time: now.toISOString(),
    };

    // Active user sessions / rooms / game sessions — real counts from DB.
    const [activeSessions, activeRooms, activeGameSessions] = await Promise.all([
      prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
      prisma.room.count({ where: { closedAt: null } }),
      prisma.gameSession.count({ where: { closedAt: null } }),
    ]);

    return {
      ok: true,
      data: {
        platformHealth,
        generatedAt: now.toISOString(),
        infra,
        activeSessions,
        activeRooms,
        activeGameSessions,
        apiErrors24h,
        securityEvents24h,
        auditActions24h,
        activeMaintenance,
        upcomingMaintenance,
        openIncidents,
        openAlerts,
        latestBackups: latestBackups.map((b) => ({
          id: b.id, kind: b.kind, status: b.status, completedAt: b.completedAt, sizeBytes: b.sizeBytes,
        })),
        latestFailedBackup: latestFailedBackups ? {
          id: latestFailedBackups.id, kind: latestFailedBackups.kind, completedAt: latestFailedBackups.completedAt, error: latestFailedBackups.error,
        } : null,
        recentRecoveries: recentRecoveries.map((r) => ({
          id: r.id, status: r.status, targetEnvironment: r.targetEnvironment, completedAt: r.completedAt,
        })),
        health,
        backupCapabilities: {
          discoveryConfigured: isBackupDiscoveryConfigured(),
          createConfigured: isBackupCreateConfigured(),
          restoreConfigured: isRestoreConfigured(),
        },
        maintenanceStrict: env.MAINTENANCE_STRICT === "true",
      },
    };
  });

  // --- 2. Health checks ----------------------------------------------------
  app.get("/v1/admin/operations/health", async (req) => {
    await requireAdmin(req, "ops.view");
    // Return the latest persisted result per component. We do NOT re-run
    // probes on every read — they would amplify load on Redis / DB.
    const cutoff = new Date(Date.now() - 15 * 60_000);
    const rows = await prisma.healthCheckResult.findMany({
      where: { checkedAt: { gte: cutoff } },
      orderBy: { checkedAt: "desc" },
      take: 200,
    });
    const latestByComponent = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      if (!latestByComponent.has(r.component)) latestByComponent.set(r.component, r);
    }
    return {
      ok: true,
      data: {
        checks: [...latestByComponent.values()],
        generatedAt: new Date().toISOString(),
        lastRefresh: rows[0]?.checkedAt ?? null,
      },
    };
  });

  /** Run all probes and persist the results. Heavy-ish endpoint (calls
   *  Redis, BullMQ, Prisma); rate-limited to 10/min per admin. */
  app.post("/v1/admin/operations/health/run", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const admin = await requireAdmin(req, "ops.view");
    const results: HealthResult[] = await runHealthChecks();
    await persistHealthResults(results);
    await writeAudit({
      adminId: admin.id, req,
      action: "run_health_checks", entity: "operations", entityId: "health",
      after: { count: results.length, down: results.filter((r) => r.status === "down").length },
    });
    return { ok: true, data: { checks: results, generatedAt: new Date().toISOString() } };
  });

  // --- 3. Maintenance ------------------------------------------------------
  app.get("/v1/admin/operations/maintenance", async (req) => {
    await requireAdmin(req, "ops.view");
    const q = validate(maintenanceListQuerySchema, queryOf(req));
    const where: Prisma.MaintenanceScheduleWhereInput = {};
    if (q.scope) where.scope = q.scope;
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.startAt = {};
      if (q.from) where.startAt.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) where.startAt.lte = new Date(`${q.to}T23:59:59.999Z`);
    }
    const [total, items] = await Promise.all([
      prisma.maintenanceSchedule.count({ where }),
      prisma.maintenanceSchedule.findMany({
        where,
        include: {
          events: { orderBy: { createdAt: "desc" }, take: 5 },
          createdBy: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { startAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { ok: true, data: { total, items } };
  });

  app.get("/v1/admin/operations/maintenance/:id", async (req) => {
    await requireAdmin(req, "ops.view");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const schedule = await prisma.maintenanceSchedule.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: "asc" } },
        createdBy: { select: { id: true, username: true, displayName: true } },
        scheduledBy: { select: { id: true, username: true, displayName: true } },
      },
    });
    if (!schedule) throw notFound();
    return { ok: true, data: schedule };
  });

  app.post("/v1/admin/operations/maintenance", async (req) => {
    const admin = await requireAdmin(req, "ops.maintenance");
    const input = validate(maintenanceCreateSchema, bodyOf(req));
    if (input.endAt <= input.startAt) throw badRequest("`endAt` must be after `startAt`");
    // Reject conflicting schedules for the same scope — only one active at a time per scope.
    const conflicting = await prisma.maintenanceSchedule.findFirst({
      where: {
        scope: input.scope,
        status: { in: ["scheduled", "active"] },
        OR: [
          { startAt: { lt: input.endAt }, endAt: { gt: input.startAt } },
        ],
      },
    });
    if (conflicting) throw conflict(`a ${conflicting.status} ${input.scope} maintenance window already covers part of the requested range`);

    const schedule = await prisma.maintenanceSchedule.create({
      data: {
        scope: input.scope,
        title: input.title,
        message: input.message,
        status: "scheduled",
        startAt: input.startAt,
        endAt: input.endAt,
        internalNotes: input.internalNotes,
        createdById: admin.id,
        scheduledById: admin.id,
      },
    });
    await prisma.maintenanceEvent.create({
      data: { maintenanceId: schedule.id, type: "created", note: input.reason, adminId: admin.id },
    });
    await writeAudit({
      adminId: admin.id, req,
      action: "create_maintenance", entity: "maintenance_schedule", entityId: schedule.id,
      after: { scope: schedule.scope, title: schedule.title, startAt: schedule.startAt, endAt: schedule.endAt, reason: input.reason },
    });
    return { ok: true, data: schedule };
  });

  app.patch("/v1/admin/operations/maintenance/:id", async (req) => {
    const admin = await requireAdmin(req, "ops.maintenance");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const input = validate(maintenanceUpdateSchema, bodyOf(req));
    const existing = await prisma.maintenanceSchedule.findUnique({ where: { id } });
    if (!existing) throw notFound();
    if (existing.status === "completed" || existing.status === "cancelled") {
      throw badRequest(`cannot edit a ${existing.status} maintenance window`);
    }
    if (input.startAt && input.endAt && input.endAt <= input.startAt) throw badRequest("`endAt` must be after `startAt`");
    const updated = await prisma.maintenanceSchedule.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.message !== undefined && { message: input.message }),
        ...(input.startAt !== undefined && { startAt: input.startAt }),
        ...(input.endAt !== undefined && { endAt: input.endAt }),
        ...(input.internalNotes !== undefined && { internalNotes: input.internalNotes }),
      },
    });
    await prisma.maintenanceEvent.create({
      data: { maintenanceId: id, type: "updated", note: "schedule fields updated", adminId: admin.id },
    });
    await writeAudit({
      adminId: admin.id, req,
      action: "update_maintenance", entity: "maintenance_schedule", entityId: id,
      before: { title: existing.title, startAt: existing.startAt, endAt: existing.endAt },
      after: input,
    });
    return { ok: true, data: updated };
  });

  app.post("/v1/admin/operations/maintenance/:id/action", async (req) => {
    const admin = await requireAdmin(req, "ops.maintenance");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const input = validate(maintenanceActionSchema, bodyOf(req));
    const existing = await prisma.maintenanceSchedule.findUnique({ where: { id } });
    if (!existing) throw notFound();

    let newStatus = existing.status;
    let eventType: typeof MAINTENANCE_EVENT_TYPES[number] | null = null;
    if (input.action === "activate") {
      if (existing.status !== "scheduled") throw badRequest(`can only activate from 'scheduled' (currently '${existing.status}')`);
      // Deactivate any other active maintenance for the same scope first.
      await prisma.maintenanceSchedule.updateMany({
        where: { scope: existing.scope, status: "active", id: { not: id } },
        data: { status: "completed", completedAt: new Date() },
      });
      newStatus = "active";
      eventType = "started";
    } else if (input.action === "deactivate") {
      if (existing.status !== "active") throw badRequest(`can only deactivate from 'active' (currently '${existing.status}')`);
      newStatus = "completed";
      eventType = "ended";
    } else if (input.action === "cancel") {
      if (existing.status === "completed" || existing.status === "cancelled") {
        throw badRequest(`cannot cancel a ${existing.status} maintenance window`);
      }
      newStatus = "cancelled";
      eventType = "cancelled";
    }

    const updates: Prisma.MaintenanceScheduleUpdateInput = { status: newStatus };
    if (input.action === "activate") updates.activatedAt = new Date();
    if (input.action === "deactivate") updates.completedAt = new Date();
    if (input.action === "cancel") updates.cancelledAt = new Date();

    const updated = await prisma.maintenanceSchedule.update({ where: { id }, data: updates });
    if (eventType) {
      await prisma.maintenanceEvent.create({
        data: { maintenanceId: id, type: eventType, note: input.reason, adminId: admin.id },
      });
    }
    await writeAudit({
      adminId: admin.id, req,
      action: `${input.action}_maintenance`, entity: "maintenance_schedule", entityId: id,
      before: { status: existing.status },
      after: { status: newStatus, reason: input.reason },
    });
    return { ok: true, data: updated };
  });

  // --- 4. Backups ----------------------------------------------------------
  app.get("/v1/admin/operations/backups", async (req) => {
    await requireAdmin(req, "ops.backups");
    const q = validate(backupListQuerySchema, queryOf(req));
    const where: Prisma.BackupRecordWhereInput = {};
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) where.createdAt.lte = new Date(`${q.to}T23:59:59.999Z`);
    }
    const [total, items] = await Promise.all([
      prisma.backupRecord.count({ where }),
      prisma.backupRecord.findMany({
        where,
        include: { createdBy: { select: { id: true, username: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total,
        items,
        capabilities: {
          discoveryConfigured: isBackupDiscoveryConfigured(),
          createConfigured: isBackupCreateConfigured(),
        },
      },
    };
  });

  /**
   * Discover existing backup files on disk and reconcile them with the
   * `BackupRecord` table. Files that match `sm_live_*.sql.gz` inside
   * `BACKUP_DIR_PATH` are upserted (matched on checksum). Files that
   * exist on disk but not in DB get a new `succeeded` row. The endpoint
   * is read-only relative to the filesystem — no files are created or
   * deleted here.
   */
  app.post("/v1/admin/operations/backups/discover", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => {
    const admin = await requireAdmin(req, "ops.backups");
    if (!isBackupDiscoveryConfigured()) throw notConfigured("backup discovery not configured (BACKUP_DIR_PATH unset)");
    const discovered = await discoverBackups();
    let created = 0, updated = 0, unchanged = 0;
    for (const d of discovered) {
      const existing = await prisma.backupRecord.findFirst({
        where: { OR: [{ checksum: d.checksum }, { location: d.location }] },
      });
      if (existing) {
        if (existing.status !== "succeeded" && existing.status !== "verified") {
          await prisma.backupRecord.update({
            where: { id: existing.id },
            data: {
              status: "succeeded",
              sizeBytes: d.sizeBytes,
              checksum: d.checksum,
              completedAt: d.modifiedAt,
              startedAt: d.modifiedAt,
              location: d.location,
              error: "",
            },
          });
          updated++;
        } else {
          unchanged++;
        }
      } else {
        await prisma.backupRecord.create({
          data: {
            kind: "database",
            scope: "platform",
            status: "succeeded",
            location: d.location,
            sizeBytes: d.sizeBytes,
            checksum: d.checksum,
            startedAt: d.modifiedAt,
            completedAt: d.modifiedAt,
            note: "auto-discovered from filesystem",
            meta: { filename: d.filename, discoveredAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
          },
        });
        created++;
      }
    }
    await writeAudit({
      adminId: admin.id, req,
      action: "discover_backups", entity: "backup_record", entityId: null,
      after: { discovered: discovered.length, created, updated, unchanged },
    });
    return { ok: true, data: { discovered: discovered.length, created, updated, unchanged } };
  });

  /**
   * Trigger a backup by invoking `BACKUP_SCRIPT_PATH`. Records the run as
   * a `pending` → `running` → `succeeded` / `failed` row. The script
   * must produce exactly one new file in `BACKUP_DIR_PATH` matching the
   * canonical pattern; otherwise we surface `succeeded` with a warning
   * that no new file was detected.
   */
  app.post("/v1/admin/operations/backups/run", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req) => {
    const admin = await requireAdmin(req, "ops.backups.write");
    const input = validate(backupCreateSchema, bodyOf(req));
    if (!isBackupCreateConfigured()) throw notConfigured("backup creation not configured (BACKUP_SCRIPT_PATH unset)");

    // Snapshot the existing backup files BEFORE the run so we can detect
    // the new file even if the script doesn't print its path.
    const before = await discoverBackups();
    const beforeSet = new Set(before.map((b) => b.checksum));

    const record = await prisma.backupRecord.create({
      data: {
        kind: input.kind, scope: "platform", status: "running",
        startedAt: new Date(), createdById: admin.id, note: input.note,
      },
    });

    try {
      const result = await runBackupScript();
      const after = await discoverBackups();
      const newFiles = after.filter((b) => !beforeSet.has(b.checksum));
      if (newFiles.length === 0) {
        // Script exited 0 but we couldn't find a new file — surface as
        // a degraded success so the admin can investigate.
        const updated = await prisma.backupRecord.update({
          where: { id: record.id },
          data: {
            status: "failed",
            completedAt: new Date(),
            error: "script exited 0 but no new backup file was detected",
            meta: { stdout: result.stdout.slice(0, 2000), stderr: result.stderr.slice(0, 2000), durationMs: result.durationMs } as unknown as Prisma.InputJsonValue,
          },
        });
        await writeAudit({
          adminId: admin.id, req, action: "run_backup", entity: "backup_record", entityId: record.id,
          after: { status: "failed", reason: "no new file detected" },
        });
        return { ok: true, data: updated };
      }
      const f = newFiles[0]!;
      const updated = await prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: "succeeded",
          completedAt: new Date(),
          location: f.location,
          sizeBytes: f.sizeBytes,
          checksum: f.checksum,
          meta: { filename: f.filename, durationMs: result.durationMs, stdout: result.stdout.slice(0, 1000), stderr: result.stderr.slice(0, 1000) } as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAudit({
        adminId: admin.id, req, action: "run_backup", entity: "backup_record", entityId: record.id,
        after: { status: "succeeded", location: f.location, sizeBytes: f.sizeBytes, durationMs: result.durationMs },
      });
      return { ok: true, data: updated };
    } catch (e) {
      const err = e as Error & { code?: string; stdout?: string; stderr?: string };
      await prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          error: err.message.slice(0, 500),
          meta: { stdout: (err.stdout ?? "").slice(0, 2000), stderr: (err.stderr ?? "").slice(0, 2000) } as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAudit({
        adminId: admin.id, req, action: "run_backup", entity: "backup_record", entityId: record.id,
        after: { status: "failed", error: err.message },
      });
      // Don't leak script internals to the API response — return a clean error.
      if (err.code === "not_configured") throw notConfigured(err.message);
      throw badRequest(`backup script failed: ${err.message}`);
    }
  });

  app.post("/v1/admin/operations/backups/:id/verify", async (req) => {
    const admin = await requireAdmin(req, "ops.backups.write");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const input = validate(backupVerifySchema, bodyOf(req));
    const existing = await prisma.backupRecord.findUnique({ where: { id } });
    if (!existing) throw notFound();
    if (existing.status !== "succeeded") throw badRequest(`only 'succeeded' backups can be verified (currently '${existing.status}')`);
    const updated = await prisma.backupRecord.update({
      where: { id },
      data: { status: "verified", note: existing.note ? `${existing.note}\n${input.note}` : input.note },
    });
    await writeAudit({
      adminId: admin.id, req, action: "verify_backup", entity: "backup_record", entityId: id,
      before: { status: "succeeded" }, after: { status: "verified", note: input.note },
    });
    return { ok: true, data: updated };
  });

  app.delete("/v1/admin/operations/backups/:id", async (req) => {
    const admin = await requireAdmin(req, "ops.backups.write");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const input = validate(backupDeleteSchema, bodyOf(req));
    const existing = await prisma.backupRecord.findUnique({ where: { id } });
    if (!existing) throw notFound();
    // Only expired or failed backups may be deleted.
    if (existing.status !== "expired" && existing.status !== "failed") {
      throw badRequest(`only 'expired' or 'failed' backups can be deleted (currently '${existing.status}')`);
    }
    // Protect the last verified backup of each kind.
    const lastVerified = await prisma.backupRecord.findFirst({
      where: { kind: existing.kind, status: "verified" },
      orderBy: { completedAt: "desc" },
    });
    if (lastVerified && lastVerified.id === existing.id) {
      throw forbidden("cannot delete the last verified backup of this kind");
    }
    const updated = await prisma.backupRecord.update({
      where: { id },
      data: { status: "deleted", note: `${existing.note}\n[deleted by ${admin.username}: ${input.reason}]` },
    });
    await writeAudit({
      adminId: admin.id, req, action: "delete_backup", entity: "backup_record", entityId: id,
      before: { status: existing.status }, after: { status: "deleted", reason: input.reason },
    });
    return { ok: true, data: updated };
  });

  // --- 5. Recovery ---------------------------------------------------------
  app.get("/v1/admin/operations/recoveries", async (req) => {
    await requireAdmin(req, "ops.restore");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.recoveryRecord.count(),
      prisma.recoveryRecord.findMany({
        include: {
          backup: { select: { id: true, kind: true, location: true, status: true, completedAt: true } },
          requestedBy: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { ok: true, data: { total, items } };
  });

  app.post("/v1/admin/operations/recoveries", { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } }, async (req) => {
    const admin = await requireAdmin(req, "ops.restore");
    const input = validate(recoveryCreateSchema, bodyOf(req));
    if (input.confirm !== true) throw badRequest("`confirm: true` is required to start a recovery");

    const backup = await prisma.backupRecord.findUnique({ where: { id: input.backupId } });
    if (!backup) throw notFound("backup not found");
    // Only verified backups are eligible for restore.
    if (backup.status !== "verified") {
      throw badRequest(`only 'verified' backups can be restored (currently '${backup.status}')`);
    }

    const record = await prisma.recoveryRecord.create({
      data: {
        backupId: backup.id,
        status: "running",
        targetEnvironment: input.targetEnvironment,
        impact: `overwrites all tables in the ${input.targetEnvironment} environment`,
        notes: input.notes,
        requestedById: admin.id,
        startedAt: new Date(),
      },
    });

    if (!isRestoreConfigured()) {
      // Mark as cancelled with a clear note — we never persist a fake
      // "succeeded" recovery when no script is wired up.
      const cancelled = await prisma.recoveryRecord.update({
        where: { id: record.id },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          result: "RESTORE_SCRIPT_PATH not configured — restore must be performed manually (see infra/restore.sh)",
        },
      });
      await writeAudit({
        adminId: admin.id, req, action: "request_restore", entity: "recovery_record", entityId: record.id,
        after: { status: "cancelled", reason: "RESTORE_SCRIPT_PATH unset" },
      });
      return { ok: true, data: cancelled };
    }

    try {
      const result = await runRestoreScript(backup.location, input.targetEnvironment);
      const updated = await prisma.recoveryRecord.update({
        where: { id: record.id },
        data: {
          status: "succeeded",
          completedAt: new Date(),
          result: `restore script exited 0 in ${result.durationMs}ms`,
        },
      });
      await writeAudit({
        adminId: admin.id, req, action: "request_restore", entity: "recovery_record", entityId: record.id,
        after: { status: "succeeded", targetEnvironment: input.targetEnvironment, backupId: backup.id, durationMs: result.durationMs },
      });
      return { ok: true, data: updated };
    } catch (e) {
      const err = e as Error & { code?: string; stdout?: string; stderr?: string };
      await prisma.recoveryRecord.update({
        where: { id: record.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          result: err.message.slice(0, 500),
        },
      });
      await writeAudit({
        adminId: admin.id, req, action: "request_restore", entity: "recovery_record", entityId: record.id,
        after: { status: "failed", error: err.message },
      });
      if (err.code === "forbidden_target") throw forbidden(err.message);
      throw badRequest(`restore script failed: ${err.message}`);
    }
  });

  // --- 6. Incidents --------------------------------------------------------
  app.get("/v1/admin/operations/incidents", async (req) => {
    await requireAdmin(req, "ops.incidents");
    const q = validate(incidentListQuerySchema, queryOf(req));
    const where: Prisma.OperationalIncidentWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.severity) where.severity = q.severity;
    if (q.assigneeId) where.assigneeId = q.assigneeId;
    if (q.search) {
      where.OR = [
        { title: { contains: q.search, mode: "insensitive" } },
        { affectedService: { contains: q.search, mode: "insensitive" } },
      ];
    }
    const [total, items] = await Promise.all([
      prisma.operationalIncident.count({ where }),
      prisma.operationalIncident.findMany({
        where,
        include: {
          assignee: { select: { id: true, username: true, displayName: true } },
          createdBy: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { ok: true, data: { total, items } };
  });

  app.get("/v1/admin/operations/incidents/:id", async (req) => {
    await requireAdmin(req, "ops.incidents");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const incident = await prisma.operationalIncident.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, username: true, displayName: true } },
        createdBy: { select: { id: true, username: true, displayName: true } },
      },
    });
    if (!incident) throw notFound();
    return { ok: true, data: incident };
  });

  app.post("/v1/admin/operations/incidents", async (req) => {
    const admin = await requireAdmin(req, "ops.incidents");
    const input = validate(incidentCreateSchema, bodyOf(req));
    if (input.assigneeId) {
      const assignee = await prisma.adminUser.findUnique({ where: { id: input.assigneeId } });
      if (!assignee || !assignee.active) throw badRequest("assignee not found or inactive");
    }
    const incident = await prisma.operationalIncident.create({
      data: {
        title: input.title,
        description: input.description,
        severity: input.severity,
        affectedService: input.affectedService,
        assigneeId: input.assigneeId ?? null,
        createdById: admin.id,
      },
    });
    await writeAudit({
      adminId: admin.id, req, action: "create_incident", entity: "operational_incident", entityId: incident.id,
      after: { title: input.title, severity: input.severity, affectedService: input.affectedService },
    });
    return { ok: true, data: incident };
  });

  app.patch("/v1/admin/operations/incidents/:id", async (req) => {
    const admin = await requireAdmin(req, "ops.incidents");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const input = validate(incidentUpdateSchema, bodyOf(req));
    const existing = await prisma.operationalIncident.findUnique({ where: { id } });
    if (!existing) throw notFound();
    if (input.assigneeId) {
      const assignee = await prisma.adminUser.findUnique({ where: { id: input.assigneeId } });
      if (!assignee || !assignee.active) throw badRequest("assignee not found or inactive");
    }
    const updates: Prisma.OperationalIncidentUpdateInput = {};
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.severity !== undefined) updates.severity = input.severity;
    if (input.status !== undefined) {
      updates.status = input.status;
      if (input.status === "closed") updates.closedAt = new Date();
    }
    if (input.affectedService !== undefined) updates.affectedService = input.affectedService;
    if (input.assigneeId !== undefined) updates.assignee = input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true };
    if (input.internalNotes !== undefined) updates.internalNotes = input.internalNotes;
    if (input.resolutionDetails !== undefined) updates.resolutionDetails = input.resolutionDetails;

    const updated = await prisma.operationalIncident.update({ where: { id }, data: updates });
    await writeAudit({
      adminId: admin.id, req, action: "update_incident", entity: "operational_incident", entityId: id,
      before: { status: existing.status, severity: existing.severity, assigneeId: existing.assigneeId },
      after: input,
    });
    return { ok: true, data: updated };
  });

  // --- 7. Alerts -----------------------------------------------------------
  app.get("/v1/admin/operations/alerts", async (req) => {
    await requireAdmin(req, "ops.incidents");
    const q = validate(alertListQuerySchema, queryOf(req));
    const where: Prisma.SystemAlertWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.severity) where.severity = q.severity;
    if (q.source) where.source = q.source;
    const [total, items] = await Promise.all([
      prisma.systemAlert.count({ where }),
      prisma.systemAlert.findMany({
        where,
        include: {
          ackedBy: { select: { id: true, username: true, displayName: true } },
          resolvedBy: { select: { id: true, username: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { ok: true, data: { total, items } };
  });

  app.post("/v1/admin/operations/alerts/:id/ack", async (req) => {
    const admin = await requireAdmin(req, "ops.incidents");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const input = validate(alertAckSchema, bodyOf(req));
    const existing = await prisma.systemAlert.findUnique({ where: { id } });
    if (!existing) throw notFound();
    if (existing.status !== "open") throw badRequest(`can only ack 'open' alerts (currently '${existing.status}')`);
    const updated = await prisma.systemAlert.update({
      where: { id },
      data: { status: "acknowledged", ackedById: admin.id, acknowledgedAt: new Date(), resolutionNotes: input.note ? `ack: ${input.note}` : "" },
    });
    await writeAudit({
      adminId: admin.id, req, action: "ack_alert", entity: "system_alert", entityId: id,
      before: { status: "open" }, after: { status: "acknowledged", note: input.note },
    });
    return { ok: true, data: updated };
  });

  app.post("/v1/admin/operations/alerts/:id/resolve", async (req) => {
    const admin = await requireAdmin(req, "ops.incidents");
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const input = validate(alertResolveSchema, bodyOf(req));
    const existing = await prisma.systemAlert.findUnique({ where: { id } });
    if (!existing) throw notFound();
    if (existing.status === "resolved") throw badRequest("alert already resolved");
    const updated = await prisma.systemAlert.update({
      where: { id },
      data: {
        status: "resolved",
        resolvedById: admin.id,
        resolvedAt: new Date(),
        resolutionNotes: input.resolutionNotes,
        ...(existing.ackedById == null && { ackedById: admin.id, acknowledgedAt: new Date() }),
      },
    });
    await writeAudit({
      adminId: admin.id, req, action: "resolve_alert", entity: "system_alert", entityId: id,
      before: { status: existing.status }, after: { status: "resolved", resolutionNotes: input.resolutionNotes },
    });
    return { ok: true, data: updated };
  });

  // --- 8. System logs (read-only, redacted) --------------------------------
  app.get("/v1/admin/operations/logs", async (req) => {
    await requireAdmin(req, "ops.logs");
    const q = validate(logListQuerySchema, queryOf(req));
    const where: Prisma.ApiErrorLogWhereInput = {};
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) where.createdAt.lte = new Date(`${q.to}T23:59:59.999Z`);
    }
    if (q.search) where.message = { contains: q.search, mode: "insensitive" };
    if (q.service) {
      // Map our LOG_SERVICES enum onto the ApiErrorLog.source column.
      // We only surface logs from sources we know how to attribute.
      const serviceToSource: Record<string, string[]> = {
        api: ["admin", "v1", "provider"],
        database: ["database", "prisma"],
        provider: ["provider"],
        webhook: ["webhook"],
        wallet: ["wallet"],
      };
      where.source = { in: serviceToSource[q.service] ?? [q.service] };
    }
    // Note: ApiErrorLog does not have a `level` column — we synthesise one
    // server-side from the message content (heuristic, surfaced as `level`
    // in the response). This is documented in the response payload.
    const [total, items] = await Promise.all([
      prisma.apiErrorLog.count({ where }),
      prisma.apiErrorLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    // Redact any payload fields that look like credentials.
    const redacted = items.map((i) => ({
      id: i.id,
      level: i.source === "webhook" ? "warn" : "error",
      service: i.source,
      route: i.route,
      message: i.message,
      payload: redactPayload(i.payload),
      createdAt: i.createdAt,
    }));
    return {
      ok: true,
      data: {
        total,
        items: redacted,
        note: "System logs surface ApiErrorLog rows. Application logs (pino) are NOT exposed via the API — use the server's log shipper (e.g. vector / fluentd) for full-text log search.",
      },
    };
  });

  app.get("/v1/admin/operations/audit", async (req) => {
    await requireAdmin(req, "ops.logs");
    const q = validate(paginationQuery.extend({
      action: z.string().trim().max(80).optional(),
      entity: z.string().trim().max(80).optional(),
      adminId: z.coerce.number().int().positive().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }), queryOf(req));
    const where: Prisma.AuditLogWhereInput = {};
    if (q.action) where.action = { contains: q.action, mode: "insensitive" };
    if (q.entity) where.entity = q.entity;
    if (q.adminId) where.adminId = q.adminId;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) where.createdAt.lte = new Date(`${q.to}T23:59:59.999Z`);
    }
    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { admin: { select: { id: true, username: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { ok: true, data: { total, items } };
  });

  // --- 9. Background jobs / scheduled tasks -------------------------------
  app.get("/v1/admin/operations/jobs", async (req) => {
    await requireAdmin(req, "ops.jobs");
    const q = validate(jobListQuerySchema, queryOf(req));
    // BullMQ stores job state in Redis — we probe the queue directly so
    // the dashboard reflects the live queue, not a DB snapshot.
    type JobSummary = {
      id: string; name: string; status: string; attempts: number;
      createdAt?: number; processedAt?: number; finishedAt?: number;
      lastFailedReason?: string; nextRepeat?: string | null;
    };
    let jobs: JobSummary[] = [];
    let scheduled: Array<{ name: string; pattern?: string; every?: number; next?: string }> = [];
    let queueError: string | null = null;
    try {
      const { default: BullMQ } = await import("bullmq");
      type QueueLike = {
        getJobs: (states: string[], start?: number, end?: number, asc?: boolean) => Promise<unknown[]>;
        getRepeatableJobs: () => Promise<unknown[]>;
        close?: () => Promise<unknown>;
      };
      const Queue = (BullMQ as unknown as { Queue: new (name: string, opts: unknown) => QueueLike }).Queue;
      const queue = new Queue("sm-live-jobs", { connection: (await import("../../lib/redis.js")).redis.duplicate() });
      const states = q.status ? [q.status] : ["waiting", "active", "completed", "failed", "delayed"];
      // Wrap each BullMQ call in a timeout so a missing Redis doesn't
      // hang the dashboard. 1.5s is enough for any healthy queue probe.
      const all = await withTimeout(queue.getJobs(states as string[], 0, 100, false) as Promise<unknown[]>, 1500, "queue probe timed out") as Array<{
        id: string; name: string; attemptsMade: number; timestamp?: number;
        processedOn?: number; finishedOn?: number; failedReason?: string; opts?: { repeat?: unknown };
      }>;
      const repeatable = await withTimeout(queue.getRepeatableJobs(), 1500, "repeatable probe timed out") as Array<{ key: string; name: string; pattern?: string; every?: number; next?: number }>;
      const repeatMap = new Map(repeatable.map((r) => [r.name, r]));
      jobs = all.map((j) => {
        const rep = repeatMap.get(j.name);
        return {
          id: j.id,
          name: j.name,
          status: j.finishedOn ? (j.failedReason ? "failed" : "completed") : (j.processedOn ? "active" : "waiting"),
          attempts: j.attemptsMade,
          createdAt: j.timestamp,
          processedAt: j.processedOn,
          finishedAt: j.finishedOn,
          lastFailedReason: j.failedReason ? String(j.failedReason).slice(0, 500) : undefined,
          nextRepeat: rep?.next ? new Date(rep.next).toISOString() : null,
        };
      });
      scheduled = repeatable.map((r) => ({
        name: r.name,
        pattern: r.pattern,
        every: r.every,
        next: r.next ? new Date(r.next).toISOString() : undefined,
      }));
      if (typeof queue.close === "function") await queue.close().catch(() => {});
    } catch (e) {
      queueError = (e as Error).message;
    }
    return {
      ok: true,
      data: {
        jobs: jobs.slice((q.page - 1) * q.pageSize, (q.page - 1) * q.pageSize + q.pageSize),
        scheduled,
        queueError,
        note: "Job state is read live from the BullMQ queue (Redis). The scheduler registers 5 repeat jobs at boot: recover-rounds (every 30s), daily-rollup (00:05), rtp-snapshot (hourly), monthly-fees (1st 00:20), provider-bills (1st 00:30).",
      },
    };
  });

  /**
   * Retry a failed job. Financial / wallet / payout jobs CANNOT be retried
   * from this endpoint — they must be re-driven through the original
   * idempotent entry point so the existing txKey / providerTxId guards
   * prevent double-debits. The deny-list is enforced server-side.
   */
  app.post("/v1/admin/operations/jobs/:id/retry", async (req) => {
    const admin = await requireAdmin(req, "ops.jobs");
    const { id } = validate(z.object({ id: z.string().min(1).max(120) }), paramsOf(req));
    const input = validate(jobRetrySchema, bodyOf(req));

    // Deny-list: jobs whose name matches these patterns cannot be retried
    // from the admin UI. They must be re-driven through the original
    // idempotent entry point (e.g. POST /v1/wallet/recharge, POST /v1/games/bet).
    const DENY_LIST = [
      /^payout/, /^wallet/, /^recharge/, /^refund/, /^bet/, /^settle/, /^provider-/,
      /^monthly-fees/, /^provider-bills/,
    ];

    let jobName = "";
    try {
      const { default: BullMQ } = await import("bullmq");
      type QueueLike = {
        getJob: (id: string) => Promise<unknown> | null;
        close?: () => Promise<unknown>;
      };
      const Queue = (BullMQ as unknown as { Queue: new (name: string, opts: unknown) => QueueLike }).Queue;
      const queue = new Queue("sm-live-jobs", { connection: (await import("../../lib/redis.js")).redis.duplicate() });
      const job = await withTimeout(queue.getJob(id) as Promise<unknown>, 1500, "queue probe timed out") as { name: string; retry: (state?: string) => Promise<unknown> } | null;
      if (!job) {
        if (typeof queue.close === "function") await queue.close().catch(() => {});
        throw notFound("job not found in queue");
      }
      jobName = job.name;
      if (DENY_LIST.some((re) => re.test(jobName))) {
        if (typeof queue.close === "function") await queue.close().catch(() => {});
        throw forbidden(`job '${jobName}' is on the financial deny-list — re-drive through the original idempotent entry point`);
      }
      await withTimeout(job.retry() as Promise<unknown>, 1500, "retry timed out");
      if (typeof queue.close === "function") await queue.close().catch(() => {});
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.includes("not found")) throw notFound("job not found in queue");
      if (msg.includes("forbidden")) throw forbidden(msg);
      if (msg.includes("timed out")) throw badRequest(`retry failed: ${msg}`);
      throw badRequest(`retry failed: ${msg}`);
    }

    await writeAudit({
      adminId: admin.id, req, action: "retry_job", entity: "job", entityId: id,
      after: { name: jobName, reason: input.reason },
    });
    return { ok: true, data: { id, name: jobName, retried: true } };
  });

  // --- 10. Operational reports (CSV export) --------------------------------
  app.get("/v1/admin/operations/reports/export", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    await requireAdmin(req, "ops.view");
    const q = validate(z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      kind: z.enum(["incidents", "alerts", "maintenance", "backups", "recoveries", "audit", "api_errors"]).default("incidents"),
    }), queryOf(req));

    const dateFilter: Prisma.AdminUserWhereInput | Record<string, unknown> = {};
    if (q.from || q.to) {
      const range: Record<string, unknown> = {};
      if (q.from) range.gte = new Date(`${q.from}T00:00:00.000Z`);
      if (q.to) range.lte = new Date(`${q.to}T23:59:59.999Z`);
      dateFilter.createdAt = range;
    }

    let rows: Record<string, unknown>[] = [];
    switch (q.kind) {
      case "incidents": {
        const items = await prisma.operationalIncident.findMany({
          where: dateFilter as Prisma.OperationalIncidentWhereInput,
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        rows = items.map((i) => ({
          id: i.id, title: i.title, severity: i.severity, status: i.status,
          affectedService: i.affectedService, createdAt: i.createdAt.toISOString(),
          closedAt: i.closedAt?.toISOString() ?? "",
        }));
        break;
      }
      case "alerts": {
        const items = await prisma.systemAlert.findMany({
          where: dateFilter as Prisma.SystemAlertWhereInput,
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        rows = items.map((a) => ({
          id: a.id, source: a.source, severity: a.severity, status: a.status,
          message: a.message, occurrenceCount: a.occurrenceCount,
          createdAt: a.createdAt.toISOString(), resolvedAt: a.resolvedAt?.toISOString() ?? "",
        }));
        break;
      }
      case "maintenance": {
        const items = await prisma.maintenanceSchedule.findMany({
          where: dateFilter as Prisma.MaintenanceScheduleWhereInput,
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        rows = items.map((m) => ({
          id: m.id, scope: m.scope, title: m.title, status: m.status,
          startAt: m.startAt.toISOString(), endAt: m.endAt.toISOString(),
          activatedAt: m.activatedAt?.toISOString() ?? "",
          completedAt: m.completedAt?.toISOString() ?? "",
        }));
        break;
      }
      case "backups": {
        const items = await prisma.backupRecord.findMany({
          where: dateFilter as Prisma.BackupRecordWhereInput,
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        rows = items.map((b) => ({
          id: b.id, kind: b.kind, status: b.status, location: b.location,
          sizeBytes: b.sizeBytes ?? 0, completedAt: b.completedAt?.toISOString() ?? "",
          createdAt: b.createdAt.toISOString(),
        }));
        break;
      }
      case "recoveries": {
        const items = await prisma.recoveryRecord.findMany({
          where: dateFilter as Prisma.RecoveryRecordWhereInput,
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        rows = items.map((r) => ({
          id: r.id, backupId: r.backupId, status: r.status,
          targetEnvironment: r.targetEnvironment, completedAt: r.completedAt?.toISOString() ?? "",
          createdAt: r.createdAt.toISOString(),
        }));
        break;
      }
      case "audit": {
        const items = await prisma.auditLog.findMany({
          where: dateFilter as Prisma.AuditLogWhereInput,
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        rows = items.map((a) => ({
          id: a.id, adminId: a.adminId ?? "", action: a.action, entity: a.entity,
          entityId: a.entityId ?? "", ip: a.ip, createdAt: a.createdAt.toISOString(),
        }));
        break;
      }
      case "api_errors": {
        const items = await prisma.apiErrorLog.findMany({
          where: dateFilter as Prisma.ApiErrorLogWhereInput,
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        rows = items.map((e) => ({
          id: e.id, source: e.source, route: e.route, message: e.message,
          createdAt: e.createdAt.toISOString(),
        }));
        break;
      }
    }

    // CSV export — apply the existing formula-injection guard.
    const csvEscape = (v: unknown): string => {
      const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      // Mitigate CSV formula injection: prefix cells starting with = + - @ \t \r
      if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    if (rows.length === 0) {
      return reply.status(200).header("content-type", "text/csv").header("content-disposition", `attachment; filename="operations-${q.kind}.csv"`).send("");
    }
    const cols = Object.keys(rows[0]!);
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(","))].join("\n");
    return reply
      .status(200)
      .header("content-type", "text/csv")
      .header("content-disposition", `attachment; filename="operations-${q.kind}.csv"`)
      .send(csv);
  });
}

// --- helpers (file-local) -------------------------------------------------

/** Redact known-sensitive keys from a JSON payload before surfacing. */
function redactPayload(payload: unknown): unknown {
  if (payload == null || typeof payload !== "object") return payload;
  try {
    const obj = payload as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/password|secret|token|authorization|api[_-]?key/i.test(k)) {
        out[k] = "[REDACTED]";
      } else if (typeof v === "object" && v !== null) {
        out[k] = redactPayload(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return "[unredactable]";
  }
}
