import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { signAdminToken } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let superAdminId: number;
let viewerAdminId: number;
let testRoomId: number;
let testParticipantUserId: number;

beforeAll(async () => {
  app = await buildTestApp();
  superAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "superadmin" } })).id;
  viewerAdminId = (await prisma.adminUser.findUniqueOrThrow({ where: { username: "viewer" } })).id;

  // Find an active room; ensure it has at least one active participant.
  const room = await prisma.room.findFirst({
    where: { closedAt: null },
    include: { participants: { where: { leftAt: null, kickedAt: null }, take: 1 } },
    orderBy: { id: "asc" },
  });
  if (room) {
    testRoomId = room.id;
    if (room.participants.length > 0) {
      testParticipantUserId = room.participants[0]!.userId;
    } else {
      // The seed creates rooms without RoomParticipant records. Create one
      // for the host so the kick/mute tests have a target.
      testParticipantUserId = room.hostId;
      try {
        await prisma.roomParticipant.create({ data: { roomId: room.id, userId: room.hostId, role: "host", slotIndex: 0 } });
      } catch { /* already exists — fine */ }
    }
  } else {
    // Create a test room if none exists.
    const suffix = crypto.randomBytes(3).toString("hex");
    const u = await prisma.user.create({ data: { phone: `+88017${suffix}`, passwordHash: "x", displayName: `Room Test ${suffix}` } });
    const r = await prisma.room.create({ data: { title: `Test Room ${suffix}`, type: "voice", slots: 5, country: "BD", hostId: u.id, livekitRoom: `room_test_${suffix}` } });
    await prisma.roomParticipant.create({ data: { roomId: r.id, userId: u.id, role: "host" } });
    testRoomId = r.id;
    testParticipantUserId = u.id;
  }
});

afterAll(async () => {
  await app.close();
});

const tok = (id: number, role: string) => signAdminToken({ sub: id, kind: "admin", role });

describe("GET /v1/admin/rooms/summary", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/rooms/summary" });
    expect(res.statusCode).toBe(401);
  });

  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/rooms/summary", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });

  it("returns summary for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/rooms/summary", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(typeof d.totalActiveRooms).toBe("number");
    expect(typeof d.totalParticipants).toBe("number");
    expect(d.hasRealtimePresence).toBe(false);
  });
});

describe("GET /v1/admin/rooms (filtered list)", () => {
  it("blocks anonymous access", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/rooms" });
    expect(res.statusCode).toBe(401);
  });

  it("returns paginated list for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/rooms?page=1&pageSize=5&status=active`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.length).toBeLessThanOrEqual(5);
    expect(["active", "closed"]).toContain(d.items[0]?.status ?? "closed");
  });

  it("accepts a type filter", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/rooms?type=voice`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((r: { type: string }) => r.type === "voice")).toBe(true);
  });

  it("accepts a numeric search (by room id)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/rooms?search=${testRoomId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.some((r: { id: number }) => r.id === testRoomId)).toBe(true);
  });

  it("rejects an invalid type filter", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/rooms?type=invalid`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/admin/rooms/:id (detail)", () => {
  it("returns the full profile for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/rooms/${testRoomId}`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.profile.id).toBe(testRoomId);
    expect(Array.isArray(d.participants)).toBe(true);
    expect(Array.isArray(d.openReports)).toBe(true);
    expect(Array.isArray(d.recentEvents)).toBe(true);
  });

  it("returns 404 for a non-existent room", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/rooms/9999999`, headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/admin/rooms/:id/participants/:userId/kick", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/participants/${testParticipantUserId}/kick`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { reason: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires a reason", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/participants/${testParticipantUserId}/kick`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { reason: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("kicks the participant + records event + audit", async () => {
    // Re-join the participant if they were kicked by a previous test.
    const existing = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: testRoomId, userId: testParticipantUserId } } });
    if (existing?.kickedAt || existing?.leftAt) {
      await prisma.roomParticipant.update({ where: { id: existing.id }, data: { kickedAt: null, leftAt: null } });
    }
    const res = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/participants/${testParticipantUserId}/kick`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { reason: "test kick" },
    });
    expect(res.statusCode).toBe(200);
    // Verify the participant was kicked.
    const p = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: testRoomId, userId: testParticipantUserId } } });
    expect(p?.kickedAt).not.toBeNull();
    // Verify audit entry.
    const audit = await prisma.auditLog.findFirst({ where: { entity: "room", entityId: String(testRoomId), action: "kick_participant" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
    // Verify room event.
    const event = await prisma.roomEvent.findFirst({ where: { roomId: testRoomId, type: "participant_kicked" }, orderBy: { id: "desc" } });
    expect(event).not.toBeNull();
  });

  it("rejects double-kick (participant already kicked)", async () => {
    // The previous test kicked the participant. Double-kick → 400.
    const res = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/participants/${testParticipantUserId}/kick`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { reason: "double kick" },
    });
    expect([400, 404]).toContain(res.statusCode);
    // Restore for subsequent tests — re-join the participant.
    try {
      await prisma.roomParticipant.update({ where: { roomId_userId: { roomId: testRoomId, userId: testParticipantUserId } }, data: { kickedAt: null, leftAt: null } });
    } catch { /* record may not exist — skip */ }
  });
});

describe("POST /v1/admin/rooms/:id/participants/:userId/mute", () => {
  it("mutes and unmutes with audit entries", async () => {
    // Ensure participant is active (re-join if kicked/left).
    try {
      const existing = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: testRoomId, userId: testParticipantUserId } } });
      if (existing?.kickedAt || existing?.leftAt) {
        await prisma.roomParticipant.update({ where: { id: existing.id }, data: { kickedAt: null, leftAt: null } });
      }
    } catch { /* skip if not found */ }
    // Mute
    const muteRes = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/participants/${testParticipantUserId}/mute`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { muted: true, reason: "test mute" },
    });
    expect(muteRes.statusCode).toBe(200);
    const p = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: testRoomId, userId: testParticipantUserId } } });
    expect(p?.muted).toBe(true);
    const muteAudit = await prisma.auditLog.findFirst({ where: { entity: "room", entityId: String(testRoomId), action: "mute_participant" }, orderBy: { id: "desc" } });
    expect(muteAudit).not.toBeNull();

    // Unmute
    const unmuteRes = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/participants/${testParticipantUserId}/mute`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { muted: false },
    });
    expect(unmuteRes.statusCode).toBe(200);
    const p2 = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: testRoomId, userId: testParticipantUserId } } });
    expect(p2?.muted).toBe(false);
  });
});

describe("Room reports", () => {
  it("creates a report + event + audit, then resolves it", async () => {
    const createRes = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/reports`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { category: "spam", description: "test spam report" },
    });
    expect(createRes.statusCode).toBe(200);
    const reportId = createRes.json().data.id;
    try {
      // Verify event.
      const event = await prisma.roomEvent.findFirst({ where: { roomId: testRoomId, type: "report_filed" }, orderBy: { id: "desc" } });
      expect(event).not.toBeNull();
      // Verify audit.
      const audit = await prisma.auditLog.findFirst({ where: { entity: "room", entityId: String(testRoomId), action: "file_room_report" }, orderBy: { id: "desc" } });
      expect(audit).not.toBeNull();

      // Resolve the report.
      const resolveRes = await app.inject({
        method: "PATCH", url: `/v1/admin/rooms/${testRoomId}/reports/${reportId}`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { status: "resolved", reviewNote: "handled via test" },
      });
      expect(resolveRes.statusCode).toBe(200);
      expect(resolveRes.json().data.status).toBe("resolved");

      // Verify report_resolved event.
      const resolveEvent = await prisma.roomEvent.findFirst({ where: { roomId: testRoomId, type: "report_resolved" }, orderBy: { id: "desc" } });
      expect(resolveEvent).not.toBeNull();
    } finally {
      // Cleanup.
      await prisma.roomReport.deleteMany({ where: { id: reportId } });
    }
  });

  it("rejects an invalid report status", async () => {
    const createRes = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/reports`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { category: "other", description: "temp" },
    });
    const rid = createRes.json().data.id;
    try {
      const res = await app.inject({
        method: "PATCH", url: `/v1/admin/rooms/${testRoomId}/reports/${rid}`,
        headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
        payload: { status: "invalid_status" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await prisma.roomReport.deleteMany({ where: { id: rid } });
    }
  });
});

describe("POST /v1/admin/rooms/:id/close", () => {
  it("requires a reason", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/close`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { reason: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("blocks viewer with 403", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/close`,
      headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}`, "content-type": "application/json" },
      payload: { reason: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("closes the room + records event + audit, then rejects double-close", async () => {
    // Skip if already closed (previous test may have closed it).
    const before = await prisma.room.findUniqueOrThrow({ where: { id: testRoomId } });
    if (before.closedAt) {
      // Reopen for the test.
      await prisma.room.update({ where: { id: testRoomId }, data: { closedAt: null } });
    }
    const res = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/close`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { reason: "test closure" },
    });
    expect(res.statusCode).toBe(200);
    const room = await prisma.room.findUniqueOrThrow({ where: { id: testRoomId } });
    expect(room.closedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entity: "room", entityId: String(testRoomId), action: "close_room" }, orderBy: { id: "desc" } });
    expect(audit).not.toBeNull();
    const event = await prisma.roomEvent.findFirst({ where: { roomId: testRoomId, type: "closed" }, orderBy: { id: "desc" } });
    expect(event).not.toBeNull();

    // Double close → 400.
    const dup = await app.inject({
      method: "POST", url: `/v1/admin/rooms/${testRoomId}/close`,
      headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}`, "content-type": "application/json" },
      payload: { reason: "double close" },
    });
    expect(dup.statusCode).toBe(400);

    // Restore for subsequent tests.
    await prisma.room.update({ where: { id: testRoomId }, data: { closedAt: null } });
  });
});

describe("CSV export", () => {
  it("blocks viewer with 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/rooms/export", headers: { authorization: `Bearer ${tok(viewerAdminId, "viewer")}` } });
    expect(res.statusCode).toBe(403);
  });

  it("returns CSV for super_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/rooms/export?pageSize=3", headers: { authorization: `Bearer ${tok(superAdminId, "super_admin")}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body.split("\n");
    expect(lines[0]).toContain("id,title,type");
  });
});
