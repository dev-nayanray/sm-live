import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { adminLoginSchema, paginationQuery } from "@sm-live/shared";
import { prisma } from "../../lib/prisma.js";
import { unauthorized, notFound, badRequest, forbidden } from "../../lib/errors.js";
import { validate, bodyOf, paramsOf, queryOf } from "../../lib/validate.js";
import { requireAdmin, signAdminToken, verifyPassword, hashPassword } from "../../lib/auth.js";
import { writeAudit, recordApiError } from "../../lib/audit.js";
import { postLedgerEntries, ledgerIntegrityCheck } from "../../services/ledger.service.js";
import { configService } from "../../services/config.service.js";
import { getPaymentAdapter } from "../../services/payment.adapter.js";
import os from "node:os";

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
  app.get("/v1/admin/dashboard", async (req) => {
    await requireAdmin(req, "dashboard.view");
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400_000);
    const d1 = new Date(now.getTime() - 86400_000);
    const [betsAgg, winsAgg, activeRooms, newUsers, apiErrors, series, giftsAgg, rechargesAgg] = await Promise.all([
      prisma.bet.aggregate({ where: { createdAt: { gte: d30 } }, _count: true, _sum: { amount: true } }),
      prisma.payout.aggregate({ where: { createdAt: { gte: d30 } }, _count: true, _sum: { amount: true } }),
      prisma.room.count({ where: { closedAt: null } }),
      prisma.user.count({ where: { createdAt: { gte: d1 } } }),
      prisma.apiErrorLog.count({ where: { createdAt: { gte: d1 } } }),
      prisma.$queryRaw<{ day: Date; bets: bigint; wins: bigint; revenue: bigint }[]>`
        SELECT d::date AS day,
          COALESCE(SUM(b.amount),0) AS bets,
          COALESCE((SELECT SUM(p.amount) FROM "Payout" p WHERE p."createdAt" >= d AND p."createdAt" < d + interval '1 day'),0) AS wins,
          COALESCE(SUM(b.amount),0) - COALESCE((SELECT SUM(p.amount) FROM "Payout" p WHERE p."createdAt" >= d AND p."createdAt" < d + interval '1 day'),0) AS revenue
        FROM generate_series(${d30.toISOString()}::date, ${now.toISOString()}::date, interval '1 day') d
        LEFT JOIN "Bet" b ON b."createdAt" >= d AND b."createdAt" < d + interval '1 day'
        GROUP BY d ORDER BY d`,
      prisma.giftTransaction.aggregate({ where: { createdAt: { gte: d30 } }, _sum: { totalPrice: true } }),
      prisma.recharge.aggregate({ where: { createdAt: { gte: d30 } }, _sum: { amount: true } }),
    ]);
    return {
      ok: true,
      data: {
        totals: {
          betsCount: betsAgg._count,
          betsAmount: betsAgg._sum.amount ?? 0,
          winsCount: winsAgg._count,
          winsAmount: winsAgg._sum.amount ?? 0,
          revenue: (betsAgg._sum.amount ?? 0) - (winsAgg._sum.amount ?? 0),
          giftsAmount: giftsAgg._sum.totalPrice ?? 0,
          recharges: rechargesAgg._sum.amount ?? 0,
          activeRooms,
          newUsers24h: newUsers,
          apiErrors24h: apiErrors,
        },
        series30d: series.map((s) => ({ day: new Date(s.day).toISOString().slice(0, 10), bets: Number(s.bets), wins: Number(s.wins), revenue: Number(s.revenue) })),
      },
    };
  });

  // --- Users ---------------------------------------------------------------
  app.get("/v1/admin/users", async (req) => {
    await requireAdmin(req, "users.read");
    const q = validate(paginationQuery, queryOf(req));
    const where = q.search
      ? { OR: [{ displayName: { contains: q.search, mode: "insensitive" as const } }, { phone: { contains: q.search } }, { email: { contains: q.search } }] }
      : {};
    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { wallet: { select: { balance: true, frozen: true } }, agency: { select: { id: true, name: true } } },
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((u) => ({ id: u.id, displayName: u.displayName, phone: u.phone, email: u.email, marketCode: u.marketCode, country: u.country, vipLevel: u.vipLevel, nobleLevel: u.nobleLevel, balance: u.wallet?.balance ?? 0, frozen: u.wallet?.frozen ?? false, agency: u.agency?.name ?? null, createdAt: u.createdAt })),
      },
    };
  });

  // --- Agencies ------------------------------------------------------------
  app.get("/v1/admin/agencies", async (req) => {
    await requireAdmin(req, "agencies.read");
    const agencies = await prisma.agency.findMany({ include: { parent: { select: { id: true, name: true } }, _count: { select: { users: true, children: true } } } });
    return { ok: true, data: agencies };
  });

  app.post("/v1/admin/agencies", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const input = validate(z.object({ name: z.string().min(2), code: z.string().min(2), commissionRate: z.coerce.number().min(0).max(1), parentId: z.coerce.number().optional() }), bodyOf(req));
    const agency = await prisma.agency.create({ data: { name: input.name, code: input.code, commissionRate: input.commissionRate, parentId: input.parentId ?? null } });
    await writeAudit({ adminId: admin.id, req, action: "create", entity: "agency", entityId: agency.id, after: agency });
    return { ok: true, data: agency };
  });

  app.patch("/v1/admin/agencies/:id", async (req) => {
    const admin = await requireAdmin(req, "agencies.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const input = validate(z.object({ name: z.string().min(2).optional(), commissionRate: z.coerce.number().min(0).max(1).optional(), active: z.boolean().optional(), parentId: z.coerce.number().nullable().optional() }), bodyOf(req));
    const before = await prisma.agency.findUnique({ where: { id } });
    if (!before) throw notFound();
    const agency = await prisma.agency.update({ where: { id }, data: input });
    await writeAudit({ adminId: admin.id, req, action: "update", entity: "agency", entityId: id, before, after: agency });
    return { ok: true, data: agency };
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
  app.get("/v1/admin/rooms", async (req) => {
    await requireAdmin(req, "rooms.read");
    const q = validate(paginationQuery, queryOf(req));
    const where = q.search ? { title: { contains: q.search, mode: "insensitive" as const } } : {};
    const [total, items] = await Promise.all([
      prisma.room.count({ where }),
      prisma.room.findMany({
        where, orderBy: { id: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { host: { select: { id: true, displayName: true } }, participants: { where: { leftAt: null, kickedAt: null } } },
      }),
    ]);
    return { ok: true, data: { total, page: q.page, pageSize: q.pageSize, items } };
  });

  app.post("/v1/admin/rooms/:id/close", async (req) => {
    const admin = await requireAdmin(req, "rooms.write");
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const room = await prisma.room.update({ where: { id }, data: { closedAt: new Date() } });
    await writeAudit({ adminId: admin.id, req, action: "close_room", entity: "room", entityId: id, after: room });
    return { ok: true };
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
    const rows = await prisma.$queryRaw<{ bucket: Date; bets: bigint; wins: bigint; rounds: bigint; revenue: bigint }[]>`
      SELECT date_trunc(${granularity}, b."createdAt") AS bucket,
             COALESCE(SUM(b.amount),0) AS bets,
             0 AS wins,
             COUNT(DISTINCT b."roundId") AS rounds,
             COALESCE(SUM(b.amount),0) AS revenue
      FROM "Bet" b GROUP BY bucket ORDER BY bucket DESC LIMIT 90`;
    // wins per bucket
    const wins = await prisma.$queryRaw<{ bucket: Date; wins: bigint }[]>`
      SELECT date_trunc(${granularity}, p."createdAt") AS bucket, COALESCE(SUM(p.amount),0) AS wins
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
    const input = validate(z.object({ username: z.string().min(3).max(60), email: z.string().email(), password: z.string().min(8), displayName: z.string().min(2), roleKey: z.string() }), bodyOf(req));
    const role = await prisma.role.findUnique({ where: { key: input.roleKey } });
    if (!role) throw badRequest("unknown role");
    const created = await prisma.adminUser.create({
      data: { username: input.username, email: input.email, passwordHash: await hashPassword(input.password), displayName: input.displayName, roleId: role.id },
    });
    await writeAudit({ adminId: admin.id, req, action: "create_admin_user", entity: "admin_user", entityId: created.id, after: { username: created.username, role: input.roleKey } });
    return { ok: true, data: { id: created.id, username: created.username } };
  });
}
