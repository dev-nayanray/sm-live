import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;
let agencyAdminId: number;
let testAgencyId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;
  // Provision a dedicated agency_admin role user for isolation testing.
  const agencyRole = await prisma.role.findUniqueOrThrow({ where: { key: "agency_admin" } });
  const existing = await prisma.adminUser.findUnique({ where: { username: "agencyadmintest" } });
  agencyAdminId = existing
    ? existing.id
    : (await prisma.adminUser.create({ data: { username: "agencyadmintest", email: "agency@test.local", passwordHash: "x", displayName: "Agency Test", roleId: agencyRole.id } })).id;
  const a = await prisma.agency.findFirst({ orderBy: { id: "asc" } });
  if (!a) throw new Error("seed required: at least one agency");
  testAgencyId = a.id;
});

afterAll(async () => {
  await app.close();
});

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("GET /v1/admin/agencies/summary", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/agencies/summary" });
    expect(res.statusCode).toBe(401);
  });

  it("blocks viewer (zero perms) with 403", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies/summary",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns summary for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies/summary",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.totalAgencies).toBeGreaterThan(0);
    expect(typeof d.activeAgencies).toBe("number");
    expect(typeof d.suspendedAgencies).toBe("number");
    expect(d.hasApprovalWorkflow).toBe(false); // documented gap
  });
});

describe("GET /v1/admin/agencies (filtered list)", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/agencies" });
    expect(res.statusCode).toBe(401);
  });

  it("returns paginated list for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies?page=1&pageSize=5",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeLessThanOrEqual(5);
    expect(d.total).toBeGreaterThan(0);
    expect(["active", "suspended"]).toContain(d.items[0].status);
  });

  it("agency_admin can read (has agencies.read) but cannot write", async () => {
    const read = await app.inject({
      method: "GET", url: "/v1/admin/agencies",
      headers: { authorization: `Bearer ${tok(agencyAdminId, "agency_admin")}` },
    });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({
      method: "POST", url: "/v1/admin/agencies",
      headers: { authorization: `Bearer ${tok(agencyAdminId, "agency_admin")}`, "content-type": "application/json" },
      payload: { name: "Blocked", code: "blocked-test" },
    });
    expect(write.statusCode).toBe(403);
  });

  it("accepts a numeric search (by id)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/agencies?search=${testAgencyId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.some((a: { id: number }) => a.id === testAgencyId)).toBe(true);
  });

  it("accepts a status=suspended filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies?status=suspended",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((a: { status: string }) => a.status === "suspended")).toBe(true);
  });

  it("rejects an invalid status filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies?status=invalid",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/admin/agencies (create)", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/agencies",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { name: "Blocked", code: "blocked-test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates an agency with audit entry + rejects duplicate code", async () => {
    const code = `test-${crypto.randomBytes(3).toString("hex")}`;
    const createRes = await app.inject({
      method: "POST", url: "/v1/admin/agencies",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { name: "Test Agency", code, description: "created by automated test", commissionRate: 0.15 },
    });
    expect(createRes.statusCode).toBe(200);
    const newId = createRes.json().data.id;
    try {
      const audit = await prisma.auditLog.findFirst({ where: { entity: "agency", entityId: String(newId), action: "create" }, orderBy: { id: "desc" } });
      expect(audit).not.toBeNull();

      // Duplicate code → 400
      const dup = await app.inject({
        method: "POST", url: "/v1/admin/agencies",
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { name: "Dup", code },
      });
      expect(dup.statusCode).toBe(400);
    } finally {
      // Cleanup
      await prisma.agencyMember.deleteMany({ where: { agencyId: newId } });
      await prisma.agency.delete({ where: { id: newId } });
    }
  });

  it("rejects an invalid code format", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/agencies",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { name: "Bad", code: "Has Spaces!" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/admin/agencies/:id (detail)", () => {
  it("returns the full profile for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/admin/agencies/${testAgencyId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.profile.id).toBe(testAgencyId);
    expect(d.counts).toMatchObject({ users: expect.any(Number), members: expect.any(Number), admins: expect.any(Number) });
    expect(d.performance).toMatchObject({ newMembers30d: expect.any(Number), activeAdmins: expect.any(Number), commissionRate: expect.any(Number) });
    expect(Array.isArray(d.auditHistory)).toBe(true);
    expect(Array.isArray(d.recentWithdrawals)).toBe(true);
  });

  it("returns 404 for a non-existent agency", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies/9999999",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/admin/agencies/:id/status (suspend / activate)", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/agencies/${testAgencyId}/status`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { action: "suspend", reason: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires a reason", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/agencies/${testAgencyId}/status`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { action: "suspend", reason: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("suspends and re-activates with audit entries", async () => {
    // Skip if the agency is already suspended (some other test may have left it).
    const before = await prisma.agency.findUniqueOrThrow({ where: { id: testAgencyId } });
    if (!before.active) {
      // Reactivate first
      await app.inject({
        method: "POST", url: `/v1/admin/agencies/${testAgencyId}/status`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { action: "activate", reason: "test setup" },
      });
    }
    const suspendRes = await app.inject({
      method: "POST", url: `/v1/admin/agencies/${testAgencyId}/status`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { action: "suspend", reason: "test suspension" },
    });
    expect(suspendRes.statusCode).toBe(200);
    expect(suspendRes.json().data.status).toBe("suspended");

    const suspendAudit = await prisma.auditLog.findFirst({ where: { entity: "agency", entityId: String(testAgencyId), action: "suspend_agency" }, orderBy: { id: "desc" } });
    expect(suspendAudit).not.toBeNull();

    // Re-activate
    const activateRes = await app.inject({
      method: "POST", url: `/v1/admin/agencies/${testAgencyId}/status`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { action: "activate", reason: "test reactivation" },
    });
    expect(activateRes.statusCode).toBe(200);
    expect(activateRes.json().data.status).toBe("active");

    const activateAudit = await prisma.auditLog.findFirst({ where: { entity: "agency", entityId: String(testAgencyId), action: "activate_agency" }, orderBy: { id: "desc" } });
    expect(activateAudit).not.toBeNull();
  });
});

describe("Agency members", () => {
  it("assigns a user, rejects duplicates, and removes with audit", async () => {
    // Find a user not yet a member of testAgencyId.
    const existing = await prisma.agencyMember.findMany({ where: { agencyId: testAgencyId }, select: { userId: true } });
    const existingIds = new Set(existing.map((e) => e.userId));
    const candidate = await prisma.user.findFirst({ where: { id: { notIn: [...existingIds] } }, orderBy: { id: "asc" } });
    if (!candidate) return; // skip if no candidate
    try {
      const assignRes = await app.inject({
        method: "POST", url: `/v1/admin/agencies/${testAgencyId}/members`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { userId: candidate.id },
      });
      expect(assignRes.statusCode).toBe(200);

      // Duplicate → 400
      const dup = await app.inject({
        method: "POST", url: `/v1/admin/agencies/${testAgencyId}/members`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { userId: candidate.id },
      });
      expect(dup.statusCode).toBe(400);

      // Audit entry
      const audit = await prisma.auditLog.findFirst({ where: { entity: "agency", entityId: String(testAgencyId), action: "assign_member" }, orderBy: { id: "desc" } });
      expect(audit).not.toBeNull();

      // Remove
      const delRes = await app.inject({
        method: "DELETE", url: `/v1/admin/agencies/${testAgencyId}/members/${candidate.id}`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
      });
      expect(delRes.statusCode).toBe(200);
    } finally {
      // Cleanup
      await prisma.agencyMember.deleteMany({ where: { agencyId: testAgencyId, userId: candidate.id } });
    }
  });
});

describe("Agency admins", () => {
  it("refuses to assign a super_admin to an agency", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/agencies/${testAgencyId}/admins`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { adminId: superAdminId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("assigns an existing admin and removes with audit", async () => {
    // Use the agency_admin test user
    const before = await prisma.adminUser.findUniqueOrThrow({ where: { id: agencyAdminId } });
    const originalAgencyId = before.agencyId;
    try {
      const assignRes = await app.inject({
        method: "POST", url: `/v1/admin/agencies/${testAgencyId}/admins`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { adminId: agencyAdminId },
      });
      // If the agency_admin is already assigned to this agency, expect 400.
      if (originalAgencyId === testAgencyId) {
        expect(assignRes.statusCode).toBe(400);
        return;
      }
      expect(assignRes.statusCode).toBe(200);

      const audit = await prisma.auditLog.findFirst({ where: { entity: "agency", entityId: String(testAgencyId), action: "assign_agency_admin" }, orderBy: { id: "desc" } });
      expect(audit).not.toBeNull();

      // Remove
      const delRes = await app.inject({
        method: "DELETE", url: `/v1/admin/agencies/${testAgencyId}/admins/${agencyAdminId}`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
      });
      expect(delRes.statusCode).toBe(200);
    } finally {
      // Restore original agencyId
      await prisma.adminUser.update({ where: { id: agencyAdminId }, data: { agencyId: originalAgencyId } });
    }
  });
});

describe("CSV export", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies/export",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns CSV with proper headers for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/agencies/export?pageSize=3",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const lines = res.body.split("\n");
    expect(lines[0]).toContain("id,name,code");
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe("POST /v1/admin/admin-users (with agencyId)", () => {
  it("creates an agency-scoped admin (not super_admin)", async () => {
    const suffix = crypto.randomBytes(3).toString("hex");
    const username = `agadmintest-${suffix}`;
    const res = await app.inject({
      method: "POST", url: "/v1/admin/admin-users",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { username, email: `${username}@test.local`, password: "Password123!", displayName: `Agency Adm ${suffix}`, roleKey: "agency_admin", agencyId: testAgencyId },
    });
    expect(res.statusCode).toBe(200);
    const newId = res.json().data.id;
    try {
      const created = await prisma.adminUser.findUniqueOrThrow({ where: { id: newId } });
      expect(created.agencyId).toBe(testAgencyId);
    } finally {
      await prisma.adminUser.delete({ where: { id: newId } });
    }
  });

  it("refuses to create a super_admin with an agency", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/admin-users",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { username: `sa-${crypto.randomBytes(3).toString("hex")}`, email: "sa@test.local", password: "Password123!", displayName: "SA Test", roleKey: "super_admin", agencyId: testAgencyId },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Wallet balance preservation on member assignment", () => {
  it("does not change the user's wallet balance when assigned to an agency", async () => {
    const candidate = await prisma.user.findFirst({
      where: { wallet: { isNot: null } },
      include: { wallet: true, agency: true },
      orderBy: { id: "asc" },
    });
    if (!candidate || !candidate.wallet) return;
    const balanceBefore = candidate.wallet.balance;
    const wasMember = await prisma.agencyMember.findUnique({ where: { agencyId_userId: { agencyId: testAgencyId, userId: candidate.id } } });
    if (wasMember) return; // skip if already a member
    try {
      await app.inject({
        method: "POST", url: `/v1/admin/agencies/${testAgencyId}/members`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { userId: candidate.id },
      });
      const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { userId: candidate.id } });
      expect(walletAfter.balance).toBe(balanceBefore);
    } finally {
      await prisma.agencyMember.deleteMany({ where: { agencyId: testAgencyId, userId: candidate.id } });
    }
  });
});
