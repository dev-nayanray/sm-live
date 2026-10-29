import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  adminLoginSchema, paginationQuery, LEDGER_KINDS,
  userListQuerySchema, userUpdateSchema, adminNoteSchema,
  maskContact, RESTRICTION_TYPES,
  agencyCreateSchema, agencyUpdateSchema, agencyStatusChangeSchema, agencyListQuerySchema,
  roomReportCreateSchema, roomReportUpdateSchema, roomListQuerySchema,
} from "@sm-live/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { unauthorized, notFound, badRequest, forbidden } from "../../lib/errors.js";
import { validate, bodyOf, paramsOf, queryOf } from "../../lib/validate.js";
import { requireAdmin, signAdminToken, verifyPassword, hashPassword } from "../../lib/auth.js";
import { writeAudit, recordApiError } from "../../lib/audit.js";
import { postLedgerEntries, ledgerIntegrityCheck } from "../../services/ledger.service.js";
import { getPaymentAdapter } from "../../services/payment.adapter.js";
import { emitToRoom } from "../../socket.js";
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
  app.get("/v1/admin/security/audit", async (req) => {
    await requireAdmin(req, "security.read");
    const q = validate(paginationQuery, queryOf(req));
    const [total, items] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({ orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { admin: { select: { username: true, displayName: true } } } }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
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
}
