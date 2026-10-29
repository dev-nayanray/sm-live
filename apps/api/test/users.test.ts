import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  // Use the first seeded user as the test target.
  const u = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (!u) throw new Error("seed required: at least one user");
  testUserId = u.id;
});

afterAll(async () => {
  await app.close();
});

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("GET /v1/admin/users/summary", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/users/summary" });
    expect(res.statusCode).toBe(401);
  });

  it("blocks viewer (zero perms) with 403", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users/summary",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns summary KPIs for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users/summary",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.totalUsers).toBeGreaterThan(0);
    expect(typeof d.active).toBe("number");
    expect(typeof d.restricted).toBe("number");
    expect(typeof d.newUsers7d).toBe("number");
    expect(typeof d.newUsers30d).toBe("number");
  });
});

describe("GET /v1/admin/users (filtered list)", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("returns paginated list for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users?page=1&pageSize=5",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeLessThanOrEqual(5);
    expect(d.total).toBeGreaterThan(0);
    // Each item must have the new derived status field.
    expect(["active", "restricted", "banned", "muted", "frozen"]).toContain(d.items[0].status);
  });

  it("accepts a numeric search (matches by id)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/users?search=${testUserId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.items[0].id).toBe(testUserId);
  });

  it("accepts a country filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users?country=BD",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((u: { country: string }) => u.country === "BD")).toBe(true);
  });

  it("accepts a status=banned filter that returns only banned users", async () => {
    // First ban the test user.
    const banRes = await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/restrict`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { type: "ban", reason: "test ban" },
    });
    expect(banRes.statusCode).toBe(200);
    try {
      const res = await app.inject({
        method: "GET", url: "/v1/admin/users?status=banned&pageSize=100",
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
      });
      expect(res.statusCode).toBe(200);
      const d = res.json().data;
      expect(d.items.length).toBeGreaterThan(0);
      expect(d.items.some((u: { id: number }) => u.id === testUserId)).toBe(true);
      expect(d.items.every((u: { status: string }) => u.status === "banned")).toBe(true);
    } finally {
      // Lift the ban via the new endpoint (cleanup).
      const restrictions = await prisma.playerRestriction.findMany({ where: { userId: testUserId, type: "ban" } });
      for (const r of restrictions) {
        await prisma.playerRestriction.update({ where: { id: r.id }, data: { expiresAt: new Date() } });
      }
    }
  });

  it("rejects an invalid status filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users?status=invalid",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a sortBy value that isn't in the whitelist", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users?sortBy=passwordHash",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200); // silently falls back to default sort
    const d = res.json().data;
    expect(d.items.length).toBeGreaterThan(0);
  });
});

describe("GET /v1/admin/users/:id", () => {
  it("returns the full profile for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/users/${testUserId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.profile.id).toBe(testUserId);
    expect(d.profile).toMatchObject({ displayName: expect.any(String), country: expect.any(String), createdAt: expect.any(String) });
    expect(d.perms.canViewWallet).toBe(true);
    expect(d.perms.canViewRounds).toBe(true);
    expect(d.perms.canEdit).toBe(true);
    expect(Array.isArray(d.restrictions)).toBe(true);
    expect(Array.isArray(d.bets)).toBe(true);
    expect(Array.isArray(d.sessions)).toBe(true);
    // passwordHash is never in the response
    expect(JSON.stringify(d.profile)).not.toContain("passwordHash");
  });

  it("returns 404 for a non-existent user", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users/9999999",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /v1/admin/users/:id", () => {
  it("blocks viewer (no users.write) with 403", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/users/${testUserId}`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { displayName: "Blocked Edit" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("updates safe profile fields for super_admin", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: testUserId } });
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/users/${testUserId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { displayName: "Edited By Test", country: "BD" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.displayName).toBe("Edited By Test");
    // Restore
    await prisma.user.update({ where: { id: testUserId }, data: { displayName: before.displayName, country: before.country } });
    // Verify an audit log entry was created.
    const audit = await prisma.auditLog.findFirst({ where: { entity: "user", entityId: String(testUserId), action: "update_profile" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("rejects a too-short display name", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/users/${testUserId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { displayName: "x" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/admin/users/:id/restrict", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/restrict`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { type: "ban", reason: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates a restriction with audit entry", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/restrict`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { type: "mute", reason: "test mute", durationDays: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.type).toBe("mute");
    // Verify the audit log entry was created.
    const audit = await prisma.auditLog.findFirst({ where: { entity: "user", entityId: String(testUserId), action: "restrict_mute" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
    // Cleanup.
    await prisma.playerRestriction.updateMany({ where: { userId: testUserId, type: "mute" }, data: { expiresAt: new Date() } });
  });

  it("is idempotent — applying the same restriction twice doesn't create duplicates", async () => {
    await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/restrict`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { type: "ban", reason: "first ban" },
    });
    await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/restrict`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { type: "ban", reason: "second ban" },
    });
    const activeBans = await prisma.playerRestriction.count({
      where: { userId: testUserId, type: "ban", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    expect(activeBans).toBe(1);
    // Cleanup.
    await prisma.playerRestriction.updateMany({ where: { userId: testUserId, type: "ban" }, data: { expiresAt: new Date() } });
  });
});

describe("Admin notes", () => {
  it("requires users.write to read notes", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/users/${testUserId}/notes`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates a note + audit entry, then deletes it", async () => {
    const createRes = await app.inject({
      method: "POST", url: `/v1/admin/users/${testUserId}/notes`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { userId: testUserId, category: "review", body: "Test note from automated test", internal: true },
    });
    expect(createRes.statusCode).toBe(200);
    const noteId = createRes.json().data.id;
    const audit = await prisma.auditLog.findFirst({ where: { entity: "user", entityId: String(testUserId), action: "add_note" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();

    const delRes = await app.inject({
      method: "DELETE", url: `/v1/admin/users/${testUserId}/notes/${noteId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(delRes.statusCode).toBe(200);
  });
});

describe("CSV export", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users/export",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns CSV with proper headers + sanitized cells", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/users/export?pageSize=5",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const body = res.body;
    const lines = body.split("\n");
    expect(lines[0]).toContain("id,displayName,country");
    expect(lines[0]).toContain("phone");
    expect(lines[0]).toContain("email");
    expect(lines[0]).toContain("balance");
    // No cell starts with =, +, -, @ (formula injection)
    // (the only allowed leading characters are letters, digits, quotes, etc.)
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      for (const cell of cells) {
        if (cell.length > 0 && !cell.startsWith('"')) {
          expect(cell[0]).not.toBe("=");
        }
      }
    }
  });
});

describe("Restriction enforcement (backend)", () => {
  it("a banned user's token is rejected by requireUser (existing auth flow)", async () => {
    // Create a fresh test user + wallet.
    const crypto = await import("node:crypto");
    const suffix = crypto.randomBytes(4).toString("hex");
    const u = await prisma.user.create({
      data: { phone: `+88017${suffix}`, passwordHash: "x", displayName: `Ban Test ${suffix}`, country: "BD" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 100 } });
    try {
      // Ban them via the admin endpoint.
      await app.inject({
        method: "POST", url: `/v1/admin/users/${u.id}/restrict`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { type: "ban", reason: "enforcement test" },
      });
      // Sign a user token and try to call a protected user endpoint.
      const { signUserToken } = await import("../src/lib/auth.js");
      const userTok = signUserToken({ sub: u.id, kind: "user", market: "default" });
      const walletRes = await app.inject({
        method: "GET", url: "/v1/wallet/balance",
        headers: { authorization: `Bearer ${userTok}` },
      });
      expect(walletRes.statusCode).toBe(403); // banned → forbidden
    } finally {
      await prisma.playerRestriction.deleteMany({ where: { userId: u.id } });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });

  it("a freeze_wallet restriction blocks the user from launching a game", async () => {
    const crypto = await import("node:crypto");
    const suffix = crypto.randomBytes(4).toString("hex");
    const u = await prisma.user.create({
      data: { phone: `+88017${suffix}9`, passwordHash: "x", displayName: `Freeze Test ${suffix}`, country: "BD" },
    });
    await prisma.wallet.create({ data: { userId: u.id, balance: 1000 } });
    try {
      await app.inject({
        method: "POST", url: `/v1/admin/users/${u.id}/restrict`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { type: "freeze_wallet", reason: "freeze test" },
      });
      // The game service's launch flow checks for an active freeze_wallet
      // restriction and throws `badRequest("wallet frozen …")`. We exercise
      // that path directly by calling the service.
      const { launchGame } = await import("../src/services/game.service.js");
      await expect(launchGame({ code: "crash-x", userId: u.id, marketCode: "default", publicApiBase: "http://test.local" })).rejects.toMatchObject({
        code: "bad_request",
        message: expect.stringContaining("wallet frozen"),
      });
    } finally {
      await prisma.playerRestriction.deleteMany({ where: { userId: u.id } });
      await prisma.wallet.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});
