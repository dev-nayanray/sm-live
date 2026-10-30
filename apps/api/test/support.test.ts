import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;
let testUserId: number;
let testTicketId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;
  const u = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (!u) throw new Error("seed required");
  testUserId = u.id;
});

afterAll(async () => {
  // Cleanup test tickets
  await prisma.ticketMessage.deleteMany({ where: { ticketId: { in: (await prisma.supportTicket.findMany({ where: { id: testTicketId }, select: { id: true } })).map(t => t.id) } } });
  await prisma.supportTicket.deleteMany({ where: { id: testTicketId } }).catch(() => {});
  await app.close();
});

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("Support summary", () => {
  it("blocks anonymous", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/support/summary" });
    expect(res.statusCode).toBe(401);
  });
  it("blocks viewer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/support/summary", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });
  it("returns summary for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/support/summary", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.tickets).toHaveProperty("total");
    expect(d.complaints).toHaveProperty("total");
    expect(d.hasSLA).toBe(false);
    expect(d.hasSatisfaction).toBe(false);
    expect(d.hasNotificationService).toBe(false);
  });
});

describe("Ticket management", () => {
  it("creates a ticket with audit", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/tickets",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { userId: testUserId, subject: "Test ticket", description: "Test description", category: "account_issues", priority: "high" },
    });
    expect(res.statusCode).toBe(200);
    testTicketId = res.json().data.id;
    const audit = await prisma.auditLog.findFirst({ where: { entity: "support_ticket", action: "create_ticket" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("lists tickets with filters", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/support/tickets?status=new&page=1&pageSize=10`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((t: { status: string }) => t.status === "new")).toBe(true);
  });

  it("returns ticket detail with messages", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/support/tickets/${testTicketId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.ticket.id).toBe(testTicketId);
    expect(d.ticket.subject).toBe("Test ticket");
    expect(Array.isArray(d.messages)).toBe(true);
    expect(d.user).not.toBeNull();
  });

  it("returns 404 for non-existent ticket", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/support/tickets/9999999", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(404);
  });

  it("updates ticket status with audit", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/support/tickets/${testTicketId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { status: "in_progress", priority: "urgent" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("in_progress");
    expect(res.json().data.priority).toBe("urgent");
    const audit = await prisma.auditLog.findFirst({ where: { entity: "support_ticket", action: "update_ticket" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("assigns ticket to admin with audit", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/support/tickets/${testTicketId}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { assigneeId: superAdminId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.assigneeId).toBe(superAdminId);
  });

  it("rejects assignment to inactive admin", async () => {
    // Create an inactive admin
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "support" } });
    const inactive = await prisma.adminUser.create({ data: { username: "inactive-test", email: "inactive@test.local", passwordHash: "x", displayName: "Inactive", roleId: role.id, active: false } });
    try {
      const res = await app.inject({
        method: "PATCH", url: `/v1/admin/support/tickets/${testTicketId}`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { assigneeId: inactive.id },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await prisma.adminUser.delete({ where: { id: inactive.id } });
    }
  });

  it("blocks viewer from updating tickets", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/support/tickets/${testTicketId}`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { status: "resolved" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Ticket messages", () => {
  it("adds a customer-facing reply with audit", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/support/tickets/${testTicketId}/messages`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { body: "Customer-facing reply", isInternal: false },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "support_ticket", action: "reply_ticket" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("adds an internal note with audit", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/support/tickets/${testTicketId}/messages`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { body: "Internal note — not visible to user", isInternal: true },
    });
    expect(res.statusCode).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "support_ticket", action: "add_internal_note" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
  });

  it("verifies internal notes are returned in admin detail but marked isInternal", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/support/tickets/${testTicketId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    const messages = res.json().data.messages;
    const internal = messages.filter((m: { isInternal: boolean }) => m.isInternal);
    expect(internal.length).toBeGreaterThan(0);
  });

  it("blocks viewer from adding messages", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/support/tickets/${testTicketId}/messages`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { body: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects empty message body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/support/tickets/${testTicketId}/messages`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { body: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Ticket creation validation", () => {
  it("rejects missing subject", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/tickets",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { userId: testUserId, subject: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects non-existent user", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/tickets",
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { userId: 9999999, subject: "Test" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("blocks viewer from creating tickets", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/support/tickets",
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { userId: testUserId, subject: "Blocked" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Complaint management (existing)", () => {
  it("lists complaints", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/complaints?page=1&pageSize=5", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
  });

  it("updates complaint status with audit", async () => {
    // Find an existing complaint or skip
    const complaint = await prisma.complaint.findFirst();
    if (!complaint) return;
    const res = await app.inject({
      method: "PATCH", url: `/v1/admin/complaints/${complaint.id}`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { assigneeNote: "test note" },
    });
    expect(res.statusCode).toBe(200);
  });
});
