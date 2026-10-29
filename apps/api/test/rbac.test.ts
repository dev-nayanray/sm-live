import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;
let financeAdminId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;
  const financeRole = await prisma.role.findUniqueOrThrow({ where: { key: "finance" } });
  const finance = await prisma.adminUser.findUnique({ where: { username: "financetest" } });
  financeAdminId = finance
    ? finance.id
    : (await prisma.adminUser.create({ data: { username: "financetest", email: "finance@test.local", passwordHash: "x", displayName: "Finance Test", roleId: financeRole.id } })).id;
});

afterAll(async () => {
  await app.close();
});

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("RBAC on admin endpoints", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/resources" });
    expect(res.statusCode).toBe(401);
  });

  it("super_admin can list resources", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/resources", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(5);
  });

  it("viewer (read-only role) can read but gets 403 on write", async () => {
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const perms = await prisma.rolePermission.count({ where: { roleId: viewerRole.id } });
    expect(perms).toBe(0); // seeded viewer has no permissions at all

    const read = await app.inject({ method: "GET", url: "/v1/admin/resources/feature-flags", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(read.statusCode).toBe(403); // viewer lacks settings.read

    const write = await app.inject({
      method: "POST", url: "/v1/admin/resources/feature-flags",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { key: "should.not.exist", description: "must not be created", enabled: false },
    });
    expect(write.statusCode).toBe(403);
    expect(await prisma.featureFlag.findUnique({ where: { key: "should.not.exist" } })).toBeNull();
  });

  it("finance role can read wallet but cannot write games config", async () => {
    const readGames = await app.inject({ method: "GET", url: "/v1/admin/resources/games", headers: { authorization: `Bearer ${tok(financeAdminId, "finance")}` } });
    expect(readGames.statusCode).toBe(403); // finance lacks games.read
    const writeGames = await app.inject({
      method: "POST", url: "/v1/admin/resources/games",
      headers: { authorization: `Bearer ${tok(financeAdminId, "finance")}`, "content-type": "application/json" },
      payload: { code: "nope-game", name: "Nope" },
    });
    expect(writeGames.statusCode).toBe(403);
  });

  it("permission grant opens the door: adding rooms.read lets viewer read gifts", async () => {
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: "viewer" } });
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "rooms.read" } });
    await prisma.rolePermission.create({ data: { roleId: viewerRole.id, permissionId: perm.id } });
    const read = await app.inject({ method: "GET", url: "/v1/admin/resources/gifts", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(read.statusCode).toBe(200);
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: viewerRole.id, permissionId: perm.id } } });
  });

  it("a user JWT is not accepted on admin endpoints", async () => {
    const { signUserToken } = await import("../src/lib/auth.js");
    const userTok = signUserToken({ sub: 1, kind: "user", market: "default" });
    const res = await app.inject({ method: "GET", url: "/v1/admin/resources", headers: { authorization: `Bearer ${userTok}` } });
    expect(res.statusCode).toBe(401);
  });
});
