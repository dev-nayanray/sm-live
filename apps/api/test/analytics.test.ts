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

afterAll(async () => { await app.close(); });

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("Analytics endpoints", () => {
  it("GET /analytics/overview blocks anonymous", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/overview" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /analytics/overview blocks viewer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/overview", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });

  it("GET /analytics/overview returns real data for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/overview", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.users.total).toBeGreaterThan(0);
    expect(d.hasActiveUserTracking).toBe(false);
    expect(d.note).toContain("real database records");
  });

  it("GET /analytics/overview accepts date filters", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/overview?from=2026-01-01&to=2026-12-31", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
  });

  it("GET /analytics/financial returns financial metrics", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/financial", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.currency).toBe("coins");
    expect(typeof d.rechargeVolume).toBe("number");
    expect(typeof d.netGamingMargin).toBe("number");
    expect(d.note).toContain("NOT platform profit");
  });

  it("GET /analytics/users returns registration series + country dist", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/users", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(Array.isArray(d.registrationSeries)).toBe(true);
    expect(Array.isArray(d.countryDistribution)).toBe(true);
    expect(d.hasRetentionData).toBe(false);
  });

  it("GET /analytics/live returns room metrics", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/live", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(typeof d.totalRooms).toBe("number");
    expect(typeof d.activeRooms).toBe("number");
    expect(d.byType).toHaveProperty("live");
    expect(d.byType).toHaveProperty("voice");
    expect(d.byType).toHaveProperty("party");
  });

  it("GET /analytics/games returns game metrics", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/games", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.totalGames).toBeGreaterThan(0);
    expect(typeof d.totalBetVolume).toBe("number");
    expect(typeof d.netGamingMargin).toBe("number");
  });

  it("GET /analytics/providers returns provider list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/providers", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.totalProviders).toBeGreaterThan(0);
    expect(Array.isArray(d.providers)).toBe(true);
    expect(d.hasResponseTimeData).toBe(false);
  });

  it("GET /analytics/system blocks viewer (requires security.read)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/system", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });

  it("GET /analytics/system returns real Node.js metrics", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/system", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(d.nodeVersion).toMatch(/^v/);
    expect(d.memory.heapUsedMb).toBeGreaterThan(0);
    expect(d.hasExternalMonitoring).toBe(false);
  });

  it("GET /analytics/errors returns error counts by source", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/errors", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(typeof d.total).toBe("number");
    expect(Array.isArray(d.bySource)).toBe(true);
  });

  it("GET /analytics/export returns CSV", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/export?category=users", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.split("\n");
    expect(lines[0]).toContain("id,displayName,country");
  });

  it("GET /analytics/export blocks viewer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/analytics/export?category=users", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});
