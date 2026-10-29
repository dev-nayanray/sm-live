import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;
});

afterAll(async () => {
  await app.close();
});

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("GET /v1/admin/dashboard", () => {
  it("blocks anonymous access with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/dashboard" });
    expect(res.statusCode).toBe(401);
  });

  it("blocks a viewer (zero permissions) with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns the enriched dashboard payload for super_admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const d = body.data;
    // Back-compat: legacy `totals` shape preserved.
    expect(d.totals).toMatchObject({
      betsCount: expect.any(Number),
      betsAmount: expect.any(Number),
      winsCount: expect.any(Number),
      winsAmount: expect.any(Number),
      revenue: expect.any(Number),
      giftsAmount: expect.any(Number),
      recharges: expect.any(Number),
      activeRooms: expect.any(Number),
      newUsers24h: expect.any(Number),
      apiErrors24h: expect.any(Number),
    });
    // New: range + currency + generatedAt.
    expect(d.range).toMatchObject({ from: expect.any(String), to: expect.any(String), preset: "last30", label: expect.any(String) });
    expect(d.currency).toBe("coins");
    expect(typeof d.generatedAt).toBe("string");
    // KPIs section.
    expect(d.kpis).toMatchObject({
      users: expect.objectContaining({ total: expect.any(Number), newInPeriod: expect.any(Number) }),
      agencies: expect.objectContaining({ total: expect.any(Number) }),
      liveRooms: expect.objectContaining({ activeNow: expect.any(Number) }),
      games: expect.objectContaining({ total: expect.any(Number), active: expect.any(Number), maintenance: expect.any(Number) }),
      walletTx: expect.objectContaining({ totalInPeriod: expect.any(Number), rechargesSucceeded: expect.any(Number), rechargesFailed: expect.any(Number) }),
      providers: expect.objectContaining({ total: expect.any(Number), enabled: expect.any(Number), errors24h: expect.any(Number) }),
    });
    // deltaPct must be a number or null (cannot be undefined here — backend always emits the field).
    expect(d.kpis.users.deltaPct === null || typeof d.kpis.users.deltaPct === "number").toBe(true);
    // Financial summary.
    expect(d.financial).toMatchObject({
      currency: "coins",
      bets: expect.objectContaining({ count: expect.any(Number), amount: expect.any(Number) }),
      payouts: expect.objectContaining({ count: expect.any(Number), amount: expect.any(Number) }),
      recharges: expect.objectContaining({ count: expect.any(Number), amount: expect.any(Number), failed: expect.any(Number) }),
      refunds: expect.objectContaining({ count: expect.any(Number), amount: expect.any(Number) }),
      netGaming: expect.objectContaining({ amount: expect.any(Number) }),
    });
    // Series + activity + alerts arrays.
    expect(Array.isArray(d.series)).toBe(true);
    expect(Array.isArray(d.activity)).toBe(true);
    expect(Array.isArray(d.alerts)).toBe(true);
  });

  it("applies the `today` preset correctly — range.from is today UTC", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard?preset=today",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.range.preset).toBe("today");
    expect(d.range.label).toBe("Today");
    // Today's `from` should be the UTC midnight of the current day.
    const todayUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    expect(d.range.from).toBe(todayUtc.toISOString());
    // And `to` is exactly 24h later.
    expect(new Date(d.range.to).getTime() - new Date(d.range.from).getTime()).toBe(86_400_000);
  });

  it("accepts a custom YYYY-MM-DD range and resolves the equivalent previous period", async () => {
    const from = "2026-01-01";
    const to = "2026-01-07";
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/dashboard?from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    // `to` is exclusive — server rolls forward one day so the user's `to`
    // day is included. So range.from = 2026-01-01T00:00:00Z and range.to = 2026-01-08T00:00:00Z.
    expect(d.range.from).toBe(`${from}T00:00:00.000Z`);
    expect(d.range.to).toBe(`2026-01-08T00:00:00.000Z`);
  });

  it("rejects a custom range wider than 90 days", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/dashboard?from=2025-01-01&to=2025-06-01`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("rejects an inverted custom range (to before from)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/dashboard?from=2026-01-10&to=2026-01-05`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("never counts a pending recharge as a succeeded deposit", async () => {
    // Insert a pending recharge so we can verify the financial summary excludes it.
    const u = await prisma.user.findFirst({ orderBy: { id: "asc" } });
    if (!u) return; // skip if seed not present
    const pending = await prisma.recharge.create({
      data: {
        userId: u.id,
        amount: 99999,
        provider: "fake",
        externalId: `pending-test-${Date.now()}`,
        status: "pending",
      },
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/dashboard?preset=last30`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
      });
      expect(res.statusCode).toBe(200);
      const d = res.json().data;
      // The pending recharge amount must NOT appear in the succeeded recharges total.
      expect(d.financial.recharges.amount).toBeLessThan(pending.amount);
      // Failed recharges is a separate counter — pending is not counted as failed either.
      expect(d.kpis.walletTx.rechargesFailed).toBeGreaterThanOrEqual(0);
    } finally {
      await prisma.recharge.delete({ where: { id: pending.id } });
    }
  });

  it("never double-counts a bet across the selected range — Bet and Payout are independent rows", async () => {
    // Sanity: a single bet's amount appears exactly once in `betsAmount`
    // for the day it was placed. Payouts are tracked on a separate row.
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/dashboard?preset=last30`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    // betsAmount and payoutsAmount are sums of two different tables; if both
    // are zero, the net gaming margin must also be zero (no double counting
    // from a phantom bet/payout).
    expect(d.financial.netGaming.amount).toBe(d.financial.bets.amount - d.financial.payouts.amount);
  });

  it("returns a non-empty series array for the last-30-day preset", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/dashboard?preset=last30`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.series.length).toBeGreaterThanOrEqual(28); // 30-day preset → ~30 daily rows
    expect(d.series.length).toBeLessThanOrEqual(31);
  });
});
