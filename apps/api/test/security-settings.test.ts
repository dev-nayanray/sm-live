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

describe("Admin user management", () => {
  it("GET /v1/admin/admin-users blocks anonymous", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/admin-users" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/admin/admin-users returns list for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/admin-users?page=1&pageSize=10", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeGreaterThan(0);
    expect(d.items[0]).toHaveProperty("role");
    expect(d.items[0]).not.toHaveProperty("passwordHash");
  });

  it("GET /v1/admin/admin-users/:id returns detail with audit", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/admin-users/${superAdminId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.profile.id).toBe(superAdminId);
    expect(d.profile.role).toHaveProperty("permissions");
    expect(Array.isArray(d.recentAudit)).toBe(true);
  });

  it("GET /v1/admin/admin-users/:id returns 404 for non-existent", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/admin-users/9999999", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /v1/admin/admin-users/:id blocks viewer", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/admin-users/${viewerAdminId}`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { active: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/admin/admin-users/:id records audit on update", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/admin-users/${viewerAdminId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { displayName: "Updated Viewer" },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "admin_user", entityId: String(viewerAdminId), action: "update_admin_user" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("PATCH protects last super_admin from deactivation", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/admin-users/${superAdminId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { active: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("last active super_admin");
  });

  it("PATCH protects last super_admin from role demotion", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/admin-users/${superAdminId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { roleKey: "viewer" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("last active super_admin");
  });
});

describe("Permissions list", () => {
  it("returns all permissions for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/permissions", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.length).toBeGreaterThan(10);
    expect(d[0]).toHaveProperty("key");
  });

  it("blocks viewer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/permissions", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Enhanced audit log", () => {
  it("supports filters (entity, action, adminId)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/security/audit?entity=admin_user&page=1&pageSize=5`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((a: { entity: string }) => a.entity === "admin_user")).toBe(true);
  });

  it("never returns before/after fields", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/security/audit?page=1&pageSize=1",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    const items = res.json().data.items;
    if (items.length > 0) {
      expect(items[0]).not.toHaveProperty("before");
      expect(items[0]).not.toHaveProperty("after");
    }
  });

  it("CSV export returns proper headers", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/security/audit/export",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.split("\n")[0]).toContain("id,adminId");
  });

  it("CSV export blocks viewer", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/security/audit/export",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("System settings", () => {
  it("GET /v1/admin/settings/overview returns platform info + settings + flags", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/settings/overview",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.platform.name).toBe("SM Live");
    expect(d.platform.nodeVersion).toMatch(/^v/);
    expect(Array.isArray(d.settings)).toBe(true);
    expect(Array.isArray(d.featureFlags)).toBe(true);
    expect(d.counts.admins).toBeGreaterThan(0);
    expect(d.hasMaintenanceMode).toBe(false);
    expect(d.hasMFA).toBe(false);
    expect(d.hasNotificationService).toBe(false);
  });

  it("blocks viewer from settings", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/settings/overview",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/admin/settings/:key updates + records audit", async () => {
    const key = `test.setting.${Date.now()}`;
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/settings/${key}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { value: "test-value", description: "test setting" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.value).toBe("test-value");
    const audit = await prisma.auditLog.findFirst({ where: { entity: "setting", entityId: key, action: "update_setting" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
    // Cleanup
    await prisma.setting.delete({ where: { key } }).catch(() => {});
  });

  it("PATCH settings blocks viewer", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/settings/test.key",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { value: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH feature flag updates + records audit", async () => {
    const flag = await prisma.featureFlag.findFirst();
    if (!flag) return;
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/feature-flags/${flag.id}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { enabled: !flag.enabled },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "feature_flag", entityId: String(flag.id), action: "update_feature_flag" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
    // Restore
    await prisma.featureFlag.update({ where: { id: flag.id }, data: { enabled: flag.enabled } });
  });
});

describe("Security — passwordHash never exposed", () => {
  it("admin-users list never returns passwordHash", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/admin-users",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    const body = res.body;
    expect(body).not.toContain("passwordHash");
  });

  it("admin-users detail never returns passwordHash", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/admin-users/${superAdminId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    const body = res.body;
    expect(body).not.toContain("passwordHash");
  });

  it("audit log never returns before/after with secrets", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/security/audit?page=1&pageSize=50",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    const body = res.body;
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("\"before\"");
    expect(body).not.toContain("\"after\"");
  });
});
