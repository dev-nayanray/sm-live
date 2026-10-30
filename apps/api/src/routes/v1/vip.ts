import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { validate, bodyOf, queryOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { postLedgerEntries } from "../../services/ledger.service.js";
import { recordSecurityEvent } from "../../lib/audit.js";

/**
 * SM Live — VIP Membership + Rankings API (Prompt 21).
 *
 * VIP Plans:
 *   Plans are stored in the Setting table with key prefix "vip.plan.".
 *   Each plan is a JSON value: { level, name, price, durationDays, benefits: string[] }.
 *   The seed script populates 3 default plans (VIP 1/2/3). Admins can
 *   add/remove plans via the existing Settings editor (Super Admin Panel).
 *
 * Endpoints:
 *   GET  /v1/vip/plans              — list available VIP plans
 *   GET  /v1/vip/membership         — current user's active membership
 *   POST /v1/vip/purchase           — purchase a VIP plan with coins
 *   GET  /v1/vip/history            — membership purchase history
 *   GET  /v1/rankings               — leaderboard (daily/weekly/monthly)
 *   GET  /v1/rankings/me            — current user's rank + position
 */
const DEFAULT_PLANS = [
  { level: 1, name: "VIP 1", price: 500, durationDays: 30, benefits: ["VIP badge", "Special chat color"] },
  { level: 2, name: "VIP 2", price: 2000, durationDays: 30, benefits: ["VIP badge", "Special chat color", "Exclusive profile frame", "Priority room entry"] },
  { level: 3, name: "VIP 3", price: 5000, durationDays: 30, benefits: ["VIP badge", "Special chat color", "Exclusive profile frame", "Priority room entry", "Full-screen gift animations", "Custom name effects"] },
];

export async function vipRoutes(app: FastifyInstance) {
  // --- VIP Plans ---
  app.get("/v1/vip/plans", async (req) => {
    await requireUser(req);
    // Load plans from the Setting table; fall back to defaults.
    const settings = await prisma.setting.findMany({
      where: { key: { startsWith: "vip.plan." } },
    });
    let plans: typeof DEFAULT_PLANS;
    if (settings.length > 0) {
      plans = settings.map((s) => JSON.parse(s.value) as typeof DEFAULT_PLANS[number]);
      plans.sort((a, b) => a.level - b.level);
    } else {
      plans = DEFAULT_PLANS;
    }
    return { ok: true, data: { plans } };
  });

  // --- My Membership ---
  app.get("/v1/vip/membership", async (req) => {
    const { user } = await requireUser(req);
    // Expire any past-due memberships.
    await expireMemberships(user.id);
    const membership = await prisma.vipMembership.findFirst({
      where: { userId: user.id, status: "active", expiresAt: { gt: new Date() } },
      orderBy: { level: "desc" },
    });
    const user_ = await prisma.user.findUnique({ where: { id: user.id }, select: { vipLevel: true, nobleLevel: true } });
    return {
      ok: true,
      data: {
        vipLevel: user_?.vipLevel ?? 0,
        nobleLevel: user_?.nobleLevel ?? 0,
        membership: membership ? {
          id: membership.id,
          level: membership.level,
          planKey: membership.planKey,
          coinsPaid: membership.coinsPaid,
          status: membership.status,
          activatedAt: membership.activatedAt,
          expiresAt: membership.expiresAt,
        } : null,
      },
    };
  });

  // --- Purchase VIP ---
  app.post("/v1/vip/purchase", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const { user } = await requireUser(req);
    const input = validate(z.object({
      planKey: z.string().trim().min(1).max(60),
    }), bodyOf(req));

    // Load plan from Setting table (or defaults).
    const setting = await prisma.setting.findUnique({ where: { key: `vip.plan.${input.planKey}` } });
    const plan = setting
      ? JSON.parse(setting.value) as typeof DEFAULT_PLANS[number]
      : DEFAULT_PLANS.find((p) => `vip${p.level}_30d` === input.planKey);
    if (!plan) throw notFound("VIP plan not found");

    // Check balance.
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet || wallet.balance < plan.price) throw badRequest("insufficient coins");

    // Check for existing active membership at this level (prevent duplicate).
    const existing = await prisma.vipMembership.findFirst({
      where: { userId: user.id, level: plan.level, status: "active", expiresAt: { gt: new Date() } },
    });
    if (existing) throw badRequest("you already have an active membership at this level");

    // Atomic: deduct coins via ledger + create membership + update vipLevel.
    const txKey = `vip:purchase:${user.id}:${input.planKey}:${Date.now()}`;
    const expiresAt = new Date(Date.now() + plan.durationDays * 86_400_000);

    try {
      await postLedgerEntries([{
        userId: user.id,
        kind: "admin_adjust",
        amount: -plan.price,
        txKey,
        refType: "vip_membership",
        meta: { planKey: input.planKey, level: plan.level, durationDays: plan.durationDays },
      }]);

      const membership = await prisma.vipMembership.create({
        data: {
          userId: user.id,
          level: plan.level,
          planKey: input.planKey,
          coinsPaid: plan.price,
          status: "active",
          expiresAt,
        },
      });

      // Update user's vipLevel to the highest active membership.
      await updateVipLevel(user.id);

      await recordSecurityEvent("vip_purchased", `user ${user.id} purchased ${input.planKey} for ${plan.price} coins`, req.ip);
      return {
        ok: true,
        data: {
          membershipId: membership.id,
          level: plan.level,
          coinsPaid: plan.price,
          expiresAt,
        },
      };
    } catch (e) {
      // postLedgerEntries throws on insufficient funds — surface cleanly.
      const msg = (e as Error).message;
      if (msg.includes("insufficient")) throw badRequest("insufficient coins");
      throw e;
    }
  });

  // --- Membership History ---
  app.get("/v1/vip/history", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }), queryOf(req));
    const [total, items] = await Promise.all([
      prisma.vipMembership.count({ where: { userId: user.id } }),
      prisma.vipMembership.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((m) => ({
          id: m.id, level: m.level, planKey: m.planKey, coinsPaid: m.coinsPaid,
          status: m.status, activatedAt: m.activatedAt, expiresAt: m.expiresAt, createdAt: m.createdAt,
        })),
      },
    };
  });

  // --- Rankings (leaderboard) ---
  app.get("/v1/rankings", async (req) => {
    await requireUser(req);
    const q = validate(z.object({
      period: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
    }), queryOf(req));

    const [total, rows] = await Promise.all([
      prisma.ranking.count({ where: { period: q.period, scope: "global" } }),
      prisma.ranking.findMany({
        where: { period: q.period, scope: "global" },
        orderBy: { points: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: {
            select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true, country: true },
          },
        },
      }),
    ]);

    const offset = (q.page - 1) * q.pageSize;
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize, period: q.period,
        items: rows.map((r, i) => ({
          rank: offset + i + 1,
          userId: r.userId,
          points: r.points,
          user: r.user,
        })),
      },
    };
  });

  // --- My Ranking ---
  app.get("/v1/rankings/me", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(z.object({
      period: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
    }), queryOf(req));

    const myRanking = await prisma.ranking.findUnique({
      where: { userId_period_scope: { userId: user.id, period: q.period, scope: "global" } },
    });

    if (!myRanking) {
      return { ok: true, data: { period: q.period, points: 0, rank: null, note: "not ranked — send gifts to earn ranking points" } };
    }

    // Count how many users have more points to determine rank.
    const higherCount = await prisma.ranking.count({
      where: { period: q.period, scope: "global", points: { gt: myRanking.points } },
    });

    return {
      ok: true,
      data: {
        period: q.period,
        points: myRanking.points,
        rank: higherCount + 1,
      },
    };
  });
}

// --- Helpers ---

/** Expire any memberships past their expiresAt. */
async function expireMemberships(userId: number) {
  const expired = await prisma.vipMembership.updateMany({
    where: { userId, status: "active", expiresAt: { lt: new Date() } },
    data: { status: "expired" },
  });
  if (expired.count > 0) {
    await updateVipLevel(userId);
  }
}

/** Update the user's vipLevel to the highest active membership (or 0). */
async function updateVipLevel(userId: number) {
  const highest = await prisma.vipMembership.findFirst({
    where: { userId, status: "active", expiresAt: { gt: new Date() } },
    orderBy: { level: "desc" },
    select: { level: true },
  });
  await prisma.user.update({
    where: { id: userId },
    data: { vipLevel: highest?.level ?? 0 },
  });
}
