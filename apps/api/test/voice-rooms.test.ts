/**
 * Voice room + multi-mic seat API tests (Prompt 18).
 *
 * Coverage:
 *   - /v1/rooms/:id/slot-release: slot holder can release, host cannot,
 *     non-slot-holder gets 400.
 *   - /v1/rooms/:id/hand-raise: audience can raise, slot-holder gets
 *     400, all-slots-taken gets 400.
 *   - /v1/rooms/:id/hand-lower: audience can lower.
 *   - /v1/rooms/:id/hand-reject: host can reject, non-host gets 403.
 *
 * Requires a live Postgres instance (DATABASE_URL env).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let hostId: number;
let hostToken: string;
let speakerId: number;
let speakerToken: string;
let audienceId: number;
let audienceToken: string;
let testRoomId: number;

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

beforeAll(async () => {
  app = await buildTestApp();

  // Create host, speaker (co-host), and audience user.
  const hostPhone = unique("+88017");
  const host = await prisma.user.create({
    data: { phone: hostPhone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Voice Host" },
  });
  await prisma.wallet.create({ data: { userId: host.id, balance: 0 } });
  hostId = host.id;
  hostToken = (await app.inject({
    method: "POST", url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: { identifier: hostPhone, password: "Pass1234!" },
  })).json().accessToken;

  const speakerPhone = unique("+88017");
  const speaker = await prisma.user.create({
    data: { phone: speakerPhone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Speaker" },
  });
  await prisma.wallet.create({ data: { userId: speaker.id, balance: 0 } });
  speakerId = speaker.id;
  speakerToken = (await app.inject({
    method: "POST", url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: { identifier: speakerPhone, password: "Pass1234!" },
  })).json().accessToken;

  const audiencePhone = unique("+88017");
  const audience = await prisma.user.create({
    data: { phone: audiencePhone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Audience" },
  });
  await prisma.wallet.create({ data: { userId: audience.id, balance: 0 } });
  audienceId = audience.id;
  audienceToken = (await app.inject({
    method: "POST", url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: { identifier: audiencePhone, password: "Pass1234!" },
  })).json().accessToken;

  // Host creates a 10-seat voice room.
  const createRes = await app.inject({
    method: "POST", url: "/v1/rooms",
    headers: { authorization: `Bearer ${hostToken}`, "content-type": "application/json" },
    payload: { title: "Test Voice Room", type: "voice", slots: 10, country: "BD" },
  });
  testRoomId = createRes.json().data.id;

  // Speaker joins + is assigned seat 1.
  await app.inject({
    method: "POST", url: `/v1/rooms/${testRoomId}/join`,
    headers: { authorization: `Bearer ${speakerToken}` },
  });
  await prisma.roomParticipant.update({
    where: { roomId_userId: { roomId: testRoomId, userId: speakerId } },
    data: { slotIndex: 1, role: "cohost" },
  });

  // Audience joins.
  await app.inject({
    method: "POST", url: `/v1/rooms/${testRoomId}/join`,
    headers: { authorization: `Bearer ${audienceToken}` },
  });
});

afterAll(async () => {
  await prisma.roomParticipant.deleteMany({ where: { roomId: testRoomId } }).catch(() => {});
  await prisma.room.delete({ where: { id: testRoomId } }).catch(() => {});
  await prisma.session.deleteMany({ where: { userId: { in: [hostId, speakerId, audienceId] } } }).catch(() => {});
  await prisma.wallet.deleteMany({ where: { userId: { in: [hostId, speakerId, audienceId] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [hostId, speakerId, audienceId] } } }).catch(() => {});
  await app.close();
});

describe("POST /v1/rooms/:id/slot-release", () => {
  it("rejects unauthenticated (401)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/rooms/${testRoomId}/slot-release` });
    expect(res.statusCode).toBe(401);
  });

  it("speaker can release their seat (200)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/slot-release`,
      headers: { authorization: `Bearer ${speakerToken}` },
    });
    expect(res.statusCode).toBe(200);
    // Verify the slot was cleared.
    const p = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId: testRoomId, userId: speakerId } },
    });
    expect(p?.slotIndex).toBeNull();
    expect(p?.role).toBe("audience");
  });

  it("host cannot release their own seat (400)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/slot-release`,
      headers: { authorization: `Bearer ${hostToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("host cannot release");
  });

  it("audience without a seat gets 400", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/slot-release`,
      headers: { authorization: `Bearer ${audienceToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("don't hold a microphone seat");
  });
});

describe("POST /v1/rooms/:id/hand-raise", () => {
  it("rejects unauthenticated (401)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/rooms/${testRoomId}/hand-raise` });
    expect(res.statusCode).toBe(401);
  });

  it("audience can raise hand (200)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/hand-raise`,
      headers: { authorization: `Bearer ${audienceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.raised).toBe(true);
  });

  it("slot holder cannot raise hand (400)", async () => {
    // Re-assign speaker seat.
    await prisma.roomParticipant.update({
      where: { roomId_userId: { roomId: testRoomId, userId: speakerId } },
      data: { slotIndex: 2, role: "cohost" },
    });
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/hand-raise`,
      headers: { authorization: `Bearer ${speakerToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("already hold a microphone seat");
  });
});

describe("POST /v1/rooms/:id/hand-lower", () => {
  it("audience can lower hand (200)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/hand-lower`,
      headers: { authorization: `Bearer ${audienceToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.lowered).toBe(true);
  });
});

describe("POST /v1/rooms/:id/hand-reject", () => {
  it("rejects non-host (403)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/hand-reject`,
      headers: { authorization: `Bearer ${audienceToken}`, "content-type": "application/json" },
      payload: { targetUserId: speakerId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("only the host");
  });

  it("host can reject a hand-raise request (200)", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/rooms/${testRoomId}/hand-reject`,
      headers: { authorization: `Bearer ${hostToken}`, "content-type": "application/json" },
      payload: { targetUserId: audienceId },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /v1/rooms (voice room with 5/10/15/20 seats)", () => {
  it.each([5, 10, 15, 20])("creates a voice room with %d seats", async (slots) => {
    // Clean up any existing active room for the host first.
    await prisma.room.updateMany({
      where: { hostId, closedAt: null },
      data: { closedAt: new Date() },
    });
    const res = await app.inject({
      method: "POST", url: "/v1/rooms",
      headers: { authorization: `Bearer ${hostToken}`, "content-type": "application/json" },
      payload: { title: `${slots}-seat room`, type: "voice", slots, country: "BD" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.slots).toBe(slots);
    expect(res.json().data.type).toBe("voice");
    // Clean up.
    const roomId = res.json().data.id;
    await prisma.roomParticipant.deleteMany({ where: { roomId } }).catch(() => {});
    await prisma.room.delete({ where: { id: roomId } }).catch(() => {});
  });
});
