import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;
let testProviderId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;
  const p = await prisma.gameProvider.findFirst({ orderBy: { id: "asc" } });
  if (!p) throw new Error("seed required");
  testProviderId = p.id;
});

afterAll(async () => { await app.close(); });

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("Integration summary", () => {
  it("returns summary for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integration/summary", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.providers.total).toBeGreaterThan(0);
    expect(typeof d.apiKeys.total).toBe("number");
    expect(d.hasHealthChecks).toBe(false);
    expect(d.hasEnvironments).toBe(false);
    expect(d.hasWebhookEventLog).toBe(false);
  });

  it("blocks viewer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integration/summary", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("API access key management", () => {
  it("lists API keys with masked values", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/providers/${testProviderId}/api-keys`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    if (d.length > 0) {
      expect(d[0].keyMasked).toContain("…");
      expect(d[0]).not.toHaveProperty("key");
    }
  });

  it("creates an API key with audit", async () => {
    const label = `test-key-${Date.now()}`;
    const res = await app.inject({
      method: "POST", url: `/v1/admin/providers/${testProviderId}/api-keys`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { label, key: "test-api-key-12345678", ipAllowList: "127.0.0.1" },
    });
    expect(res.statusCode).toBe(200);
    const keyId = res.json().data.id;
    // Verify audit.
    const audit = await prisma.auditLog.findFirst({ where: { entity: "provider", entityId: String(testProviderId), action: "create_api_key" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
    // Verify key is masked.
    expect(res.json().data.keyMasked).toContain("…");
    expect(res.json().data).not.toHaveProperty("key");
    // Cleanup.
    await prisma.apiAccessKey.delete({ where: { id: keyId } });
  });

  it("rejects duplicate API key", async () => {
    const existing = await prisma.apiAccessKey.findFirst();
    if (!existing) return;
    const res = await app.inject({
      method: "POST", url: `/v1/admin/providers/${testProviderId}/api-keys`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { label: "dup", key: existing.key },
    });
    expect(res.statusCode).toBe(400);
  });

  it("blocks viewer from creating keys", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/providers/${testProviderId}/api-keys`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { label: "blocked", key: "blocked-key-12345678" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("updates an API key with audit", async () => {
    const created = await prisma.apiAccessKey.create({ data: { label: "test-update", providerId: testProviderId, key: "update-key-12345678", ipAllowList: "127.0.0.1" } });
    try {
      const res = await app.inject({
        method: "PATCH", url: `/v1/admin/providers/${testProviderId}/api-keys/${created.id}`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.enabled).toBe(false);
      const audit = await prisma.auditLog.findFirst({ where: { entity: "provider", action: "update_api_key" }, orderBy: { id: "desc" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.apiAccessKey.delete({ where: { id: created.id } });
    }
  });

  it("deletes an API key with audit", async () => {
    const created = await prisma.apiAccessKey.create({ data: { label: "test-delete", providerId: testProviderId, key: "delete-key-12345678", ipAllowList: "127.0.0.1" } });
    const res = await app.inject({
      method: "DELETE", url: `/v1/admin/providers/${testProviderId}/api-keys/${created.id}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "provider", action: "delete_api_key" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });
});

describe("Credential rotation", () => {
  it("rotates credentials with audit (same values — no side effects)", async () => {
    const before = await prisma.gameProvider.findUniqueOrThrow({ where: { id: testProviderId }, select: { apiKey: true, apiSecret: true } });
    const res = await app.inject({
      method: "POST", url: `/v1/admin/providers/${testProviderId}/rotate-credentials`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { apiKey: before.apiKey, apiSecret: before.apiSecret }, // rotate with same values
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.rotated).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "provider", action: "rotate_provider_credentials" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("blocks viewer", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/providers/${testProviderId}/rotate-credentials`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { apiKey: "blocked", apiSecret: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("never returns secrets in response", async () => {
    const before = await prisma.gameProvider.findUniqueOrThrow({ where: { id: testProviderId }, select: { apiKey: true, apiSecret: true } });
    const res = await app.inject({
      method: "POST", url: `/v1/admin/providers/${testProviderId}/rotate-credentials`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { apiKey: before.apiKey, apiSecret: before.apiSecret },
    });
    const body = res.body;
    // The response should never contain the apiKey or apiSecret values.
    expect(body).not.toContain(before.apiKey);
    expect(body).not.toContain(before.apiSecret);
  });
});

describe("Webhook event log", () => {
  it("returns webhook settlements", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integration/webhooks?page=1&pageSize=5", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((r: { settleSource: string }) => r.settleSource === "webhook")).toBe(true);
  });

  it("blocks viewer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integration/webhooks", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("Provider health check", () => {
  it("returns health status for provider", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/providers/${testProviderId}/health`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.providerId).toBe(testProviderId);
    expect(["operational", "degraded", "disabled"]).toContain(d.status);
    expect(d.healthCheckMethod).toBe("inferred");
  });

  it("returns 404 for non-existent provider", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/providers/9999999/health", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(404);
  });
});

describe("Security — secrets never exposed", () => {
  it("API key list never returns full key", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/providers/${testProviderId}/api-keys`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    const body = res.body;
    // The body should not contain any raw key values from the database.
    const keys = await prisma.apiAccessKey.findMany({ where: { providerId: testProviderId }, select: { key: true } });
    for (const k of keys) {
      if (k.key.length > 8) {
        expect(body).not.toContain(k.key);
      }
    }
  });

  it("provider list never returns apiKey or apiSecret", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/providers", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    const body = res.body;
    const provider = await prisma.gameProvider.findFirst();
    if (provider) {
      expect(body).not.toContain(provider.apiKey);
      expect(body).not.toContain(provider.apiSecret);
    }
  });

  it("provider detail never returns apiKey or apiSecret", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/providers/${testProviderId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    const body = res.body;
    const provider = await prisma.gameProvider.findUniqueOrThrow({ where: { id: testProviderId } });
    expect(body).not.toContain(provider.apiKey);
    expect(body).not.toContain(provider.apiSecret);
  });
});
