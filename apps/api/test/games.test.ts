import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;
let testGameId: number;
let testProviderId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;
  const g = await prisma.game.findFirst({ orderBy: { id: "asc" } });
  if (!g) throw new Error("seed required");
  testGameId = g.id;
  if (g.providerId) testProviderId = g.providerId;
  else {
    const p = await prisma.gameProvider.findFirst({ orderBy: { id: "asc" } });
    if (p) testProviderId = p.id;
  }
});

afterAll(async () => { await app.close(); });

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("GET /v1/admin/games/summary", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/games/summary" });
    expect(res.statusCode).toBe(401);
  });
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/games/summary", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
  it("returns summary for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/games/summary", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.total).toBeGreaterThan(0);
    expect(typeof d.active).toBe("number");
    expect(d.hasGameCategories).toBe(false);
  });
});

describe("GET /v1/admin/games", () => {
  it("returns paginated list for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/games?page=1&pageSize=5", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeLessThanOrEqual(5);
    expect(["active", "maintenance", "disabled"]).toContain(d.items[0].status);
  });
  it("accepts a status filter", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/games?status=active", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((g: { status: string }) => g.status === "active")).toBe(true);
  });
  it("rejects an invalid status", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/games?status=invalid", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/admin/games/:id", () => {
  it("returns game detail with configs + provider", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/games/${testGameId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.profile.id).toBe(testGameId);
    expect(Array.isArray(d.configs)).toBe(true);
    expect(d.counts).toMatchObject({ sessions: expect.any(Number), rounds: expect.any(Number), bets: expect.any(Number) });
  });
  it("returns 404 for non-existent game", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/games/9999999", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/admin/games/:id/status", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/games/${testGameId}/status`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { action: "disable", reason: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });
  it("requires a reason", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/games/${testGameId}/status`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { action: "maintenance", reason: "" },
    });
    expect(res.statusCode).toBe(400);
  });
  it("puts game under maintenance + records audit, then restores", async () => {
    const before = await prisma.game.findUniqueOrThrow({ where: { id: testGameId } });
    if (before.status !== "active") {
      await prisma.game.update({ where: { id: testGameId }, data: { status: "active" } });
    }
    const res = await app.inject({
      method: "POST", url: `/v1/admin/games/${testGameId}/status`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { action: "maintenance", reason: "test maintenance" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("maintenance");
    const audit = await prisma.auditLog.findFirst({ where: { entity: "game", entityId: String(testGameId), action: "game_maintenance" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
    // Restore.
    await prisma.game.update({ where: { id: testGameId }, data: { status: "active" } });
  });
  it("rejects same-status change", async () => {
    const before = await prisma.game.findUniqueOrThrow({ where: { id: testGameId } });
    const action = before.status === "active" ? "activate" : before.status === "maintenance" ? "maintenance" : "disable";
    const res = await app.inject({
      method: "POST", url: `/v1/admin/games/${testGameId}/status`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { action, reason: "same status" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Provider management", () => {
  it("returns provider list without secrets", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/providers", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    if (d.items.length > 0) {
      const item = d.items[0];
      expect(item).toHaveProperty("apiKeyMasked");
      expect(item).toHaveProperty("apiSecretSet");
      expect(item).not.toHaveProperty("apiKey");
      expect(item).not.toHaveProperty("apiSecret");
    }
  });
  it("returns provider detail without secrets", async () => {
    if (!testProviderId) return;
    const res = await app.inject({ method: "GET", url: `/v1/admin/providers/${testProviderId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.profile).toHaveProperty("apiKeyMasked");
    expect(d.profile).not.toHaveProperty("apiKey");
    expect(d.profile).not.toHaveProperty("apiSecret");
  });
  it("blocks viewer from providers", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/providers", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Game sessions", () => {
  it("returns sessions list for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sessions?page=1&pageSize=5", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeLessThanOrEqual(5);
  });
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sessions", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("API error logs", () => {
  it("returns logs without payload for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-errors?page=1&pageSize=5", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    if (d.items.length > 0) {
      const item = d.items[0];
      expect(item).toHaveProperty("source");
      expect(item).toHaveProperty("route");
      expect(item).toHaveProperty("message");
      expect(item).not.toHaveProperty("payload");
    }
  });
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-errors", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Game launch enforcement", () => {
  it("a maintenance game rejects new launches", async () => {
    const before = await prisma.game.findUniqueOrThrow({ where: { id: testGameId } });
    if (before.status !== "active") {
      await prisma.game.update({ where: { id: testGameId }, data: { status: "active" } });
    }
    // Put under maintenance.
    await app.inject({
      method: "POST", url: `/v1/admin/games/${testGameId}/status`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { action: "maintenance", reason: "launch enforcement test" },
    });
    try {
      const { launchGame } = await import("../src/services/game.service.js");
      await expect(launchGame({ code: before.code, userId: 1, marketCode: "default", publicApiBase: "http://test.local" })).rejects.toMatchObject({
        code: "bad_request",
        message: expect.stringContaining(before.code),
      });
    } finally {
      // Restore.
      await prisma.game.update({ where: { id: testGameId }, data: { status: "active" } });
    }
  });
});
