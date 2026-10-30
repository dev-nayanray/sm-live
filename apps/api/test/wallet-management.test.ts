import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;
let testUserId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;
  const u = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (!u) throw new Error("seed required");
  testUserId = u.id;
});

afterAll(async () => { await app.close(); });

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("GET /v1/admin/wallet/summary", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/summary" });
    expect(res.statusCode).toBe(401);
  });
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/summary", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
  it("returns summary for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/summary", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.currency).toBe("coins");
    expect(d.totalWallets).toBeGreaterThan(0);
    expect(typeof d.totalBalance).toBe("number");
    expect(typeof d.netGamingMargin).toBe("number");
    expect(d.note).toContain("NOT platform profit");
  });
});

describe("GET /v1/admin/wallet/wallets", () => {
  it("returns paginated wallet list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/wallets?page=1&pageSize=5", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeLessThanOrEqual(5);
    expect(d.items[0]).toHaveProperty("balance");
    expect(d.items[0]).toHaveProperty("userId");
  });
  it("accepts frozen filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/wallets?frozen=true", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((w: { frozen: boolean }) => w.frozen === true)).toBe(true);
  });
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/wallets", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/admin/wallet/wallets/:userId", () => {
  it("returns wallet detail with recent entries + integrity check", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/wallet/wallets/${testUserId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.wallet.userId).toBe(testUserId);
    expect(Array.isArray(d.recentEntries)).toBe(true);
    expect(d.integrity).toHaveProperty("ok");
  });
  it("returns 404 for non-existent wallet", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/wallet/wallets/9999999`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/admin/wallet/transactions", () => {
  it("returns filtered ledger entries", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/wallet/transactions?userId=${testUserId}&pageSize=5`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((e: { userId: number }) => e.userId === testUserId)).toBe(true);
    // Verify BigInt id is converted to string.
    expect(typeof d.items[0]?.id).toBe("string");
  });
  it("accepts kind filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/transactions?kind=recharge", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((e: { kind: string }) => e.kind === "recharge")).toBe(true);
  });
  it("never returns meta field (may contain admin context)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/wallet/transactions?userId=${testUserId}&pageSize=1`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    const items = res.json().data.items;
    if (items.length > 0) {
      expect(items[0]).not.toHaveProperty("meta");
    }
  });
});

describe("GET /v1/admin/wallet/refunds", () => {
  it("returns refund list with admin + recharge context", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/refunds?page=1&pageSize=5", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    if (d.items.length > 0) {
      expect(d.items[0]).toHaveProperty("recharge");
      expect(d.items[0]).toHaveProperty("admin");
    }
  });
});

describe("GET /v1/admin/wallet/withdrawals", () => {
  it("returns withdrawal list with status filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/withdrawals?status=pending", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((w: { status: string }) => w.status === "pending")).toBe(true);
  });
});

describe("GET /v1/admin/wallet/reconciliation", () => {
  it("returns integrity check + unmatched recharges + duplicates", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/reconciliation", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.integrity).toHaveProperty("ok");
    expect(typeof d.unmatchedCount).toBe("number");
    expect(typeof d.duplicateCount).toBe("number");
    expect(d.note).toContain("Diagnostic only");
  });
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/reconciliation", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("CSV export", () => {
  it("returns CSV with proper headers", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/export", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const lines = res.body.split("\n");
    expect(lines[0]).toContain("id,userId,kind,amount");
  });
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/wallet/export", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Idempotency protection", () => {
  it("replaying the same txKey does not create a duplicate entry", async () => {
    const { credit } = await import("../src/services/ledger.service.js");
    const suffix = crypto.randomBytes(4).toString("hex");
    const u = await prisma.user.create({ data: { phone: `+88017${suffix}`, passwordHash: "x", displayName: `Idemp Test ${suffix}` } });
    await prisma.wallet.create({ data: { userId: u.id, balance: 0 } });
    try {
      const txKey = `idemp-test:${suffix}`;
      const r1 = await credit(u.id, "recharge", 100, txKey);
      expect(r1.replayed).toBe(false);
      const r2 = await credit(u.id, "recharge", 100, txKey);
      expect(r2.replayed).toBe(true);
      // Balance should be 100, not 200 (the replay returned the original entry).
      const balance = await prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } });
      expect(balance.balance).toBe(100);
    } finally {
      await prisma.ledgerEntry.deleteMany({ where: { userId: u.id } });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});

describe("Refund validation", () => {
  it("rejects refund for non-succeeded recharge", async () => {
    // Create a failed recharge.
    const suffix = crypto.randomBytes(4).toString("hex");
    const u = await prisma.user.create({ data: { phone: `+88017${suffix}`, passwordHash: "x", displayName: `Refund Test ${suffix}` } });
    try {
      const r = await prisma.recharge.create({ data: { userId: u.id, amount: 500, provider: "fake", externalId: `fail-${suffix}`, status: "failed" } });
      const res = await app.inject({
        method: "POST", url: "/v1/admin/wallet/refund",
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { rechargeId: r.id, reason: "test" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await prisma.recharge.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
  it("rejects duplicate refund for same recharge", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const u = await prisma.user.create({ data: { phone: `+88017${suffix}`, passwordHash: "x", displayName: `Dup Refund ${suffix}` } });
    await prisma.wallet.create({ data: { userId: u.id, balance: 1000 } });
    try {
      const r = await prisma.recharge.create({ data: { userId: u.id, amount: 500, provider: "fake", externalId: `dup-${suffix}`, status: "succeeded" } });
      // First refund.
      const res1 = await app.inject({
        method: "POST", url: "/v1/admin/wallet/refund",
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { rechargeId: r.id, reason: "first refund" },
      });
      expect(res1.statusCode).toBe(200);
      // Duplicate refund.
      const res2 = await app.inject({
        method: "POST", url: "/v1/admin/wallet/refund",
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { rechargeId: r.id, reason: "duplicate" },
      });
      expect(res2.statusCode).toBe(400);
    } finally {
      await prisma.refund.deleteMany({ where: { recharge: { userId: u.id } } });
      await prisma.recharge.deleteMany({ where: { userId: u.id } });
      await prisma.ledgerEntry.deleteMany({ where: { userId: u.id } });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});

describe("Viewer cannot write wallet operations", () => {
  it("viewer cannot recharge", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/recharge`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { amount: 100 },
    });
    expect(res.statusCode).toBe(403);
  });
  it("viewer cannot adjust balance", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/adjust`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { amount: 50, reason: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });
  it("viewer cannot refund", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/wallet/refund",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { rechargeId: 1, reason: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });
});
