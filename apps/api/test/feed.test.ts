/**
 * Feed + search API tests (Prompt 15).
 *
 * Coverage:
 *   - /v1/feed/home: unauthenticated 401, authenticated 200 with the
 *     full response shape (rooms / popularRooms / liveRooms / creators
 *     / videos / moments / games). Category filter — when category=live,
 *     the creators + videos + moments arrays are empty.
 *   - /v1/users/search: unauthenticated 401, min-length validation
 *     (q="a" → 400), excludes the calling user from results, only
 *     returns public fields (no phone / email).
 *   - /v1/rooms/search: unauthenticated 401, returns only OPEN rooms
 *     (closedAt === null), optional type filter narrows results.
 *   - /v1/notifications/count: returns 0 + supported=false (the
 *     notification backend does not exist yet — the API honestly
 *     documents this rather than returning a fake badge).
 *
 * Requires a live Postgres instance (DATABASE_URL env). The test file
 * uses the existing `buildTestApp()` helper which now registers the
 * feed routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/auth.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let testUserId: number;
let testAccessToken: string;
let testRoomId: number;

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

beforeAll(async () => {
  app = await buildTestApp();
  // Create a test user we can log in as.
  const phone = unique("+88017");
  const u = await prisma.user.create({
    data: { phone, email: null, passwordHash: await hashPassword("Pass1234!"), displayName: "Feed Test User" },
  });
  await prisma.wallet.create({ data: { userId: u.id, balance: 100 } });
  testUserId = u.id;

  // Log in to get an access token.
  const loginRes = await app.inject({
    method: "POST", url: "/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: { identifier: phone, password: "Pass1234!" },
  });
  testAccessToken = loginRes.json().accessToken;

  // Create an open room owned by the test user.
  const room = await prisma.room.create({
    data: {
      title: `Test Live Room ${Date.now()}`,
      type: "live",
      slots: 3,
      country: "BD",
      hostId: u.id,
      livekitRoom: `room_test_${Date.now()}`,
    },
  });
  testRoomId = room.id;
  await prisma.roomParticipant.create({
    data: { roomId: room.id, userId: u.id, role: "host", slotIndex: 0 },
  });
});

afterAll(async () => {
  // Cleanup everything created during the run.
  await prisma.roomParticipant.deleteMany({ where: { roomId: testRoomId } }).catch(() => {});
  await prisma.room.delete({ where: { id: testRoomId } }).catch(() => {});
  await prisma.session.deleteMany({ where: { userId: testUserId } }).catch(() => {});
  await prisma.wallet.deleteMany({ where: { userId: testUserId } }).catch(() => {});
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  await app.close();
});

describe("GET /v1/feed/home", () => {
  it("blocks unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/feed/home" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the full feed shape for category=for_you", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/feed/home?category=for_you",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.category).toBe("for_you");
    expect(Array.isArray(d.rooms)).toBe(true);
    expect(Array.isArray(d.popularRooms)).toBe(true);
    expect(Array.isArray(d.liveRooms)).toBe(true);
    expect(Array.isArray(d.creators)).toBe(true);
    expect(Array.isArray(d.videos)).toBe(true);
    expect(Array.isArray(d.moments)).toBe(true);
    expect(Array.isArray(d.games)).toBe(true);
    // The test room we created should appear in the rooms + liveRooms arrays.
    expect(d.rooms.some((r: { id: number }) => r.id === testRoomId)).toBe(true);
    expect(d.liveRooms.some((r: { id: number }) => r.id === testRoomId)).toBe(true);
    // Each room has the expected shape.
    if (d.liveRooms.length > 0) {
      const r = d.liveRooms[0];
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("type");
      expect(r).toHaveProperty("audienceCount");
      expect(r).toHaveProperty("host");
      expect(r).not.toHaveProperty("participants"); // we trimmed this client-side
    }
  });

  it("respects the category filter — category=live omits creators + videos + moments", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/feed/home?category=live",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.category).toBe("live");
    expect(d.creators).toEqual([]);
    expect(d.videos).toEqual([]);
    expect(d.moments).toEqual([]);
    expect(d.games).toEqual([]);
    // rooms + popularRooms + liveRooms are populated.
    expect(d.liveRooms.length).toBeGreaterThan(0);
  });

  it("respects the category filter — category=creators omits rooms + content", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/feed/home?category=creators",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.category).toBe("creators");
    expect(d.rooms).toEqual([]);
    expect(d.popularRooms).toEqual([]);
    expect(d.liveRooms).toEqual([]);
    expect(d.videos).toEqual([]);
    expect(d.moments).toEqual([]);
  });

  it("defaults to category=for_you when no query param", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/feed/home",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.category).toBe("for_you");
  });
});

describe("GET /v1/users/search", () => {
  it("blocks unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/users/search?q=alice" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects queries shorter than 2 chars", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/users/search?q=a",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("excludes the calling user from results", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/users/search?q=Feed",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.items.every((u: { id: number }) => u.id !== testUserId)).toBe(true);
  });

  it("only returns public fields — no phone or email", async () => {
    // Create a separate user with a known display name + email so we
    // can verify the search returns them WITHOUT the email.
    const phone = unique("+88017");
    const other = await prisma.user.create({
      data: {
        phone, email: "alice-search@example.com",
        passwordHash: await hashPassword("Pass1234!"),
        displayName: "Alice Searchable",
      },
    });
    try {
      const res = await app.inject({
        method: "GET", url: "/v1/users/search?q=Alice%20Searchable",
        headers: { authorization: `Bearer ${testAccessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().data.items as Array<{ id: number; displayName: string; phone?: string; email?: string }>;
      const found = items.find((u) => u.id === other.id);
      expect(found).toBeDefined();
      expect(found!.displayName).toBe("Alice Searchable");
      expect(found!.phone).toBeUndefined();
      expect(found!.email).toBeUndefined();
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  it("supports pagination", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/users/search?q=player&page=1&pageSize=5",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.page).toBe(1);
    expect(d.pageSize).toBe(5);
    expect(d.items.length).toBeLessThanOrEqual(5);
  });
});

describe("GET /v1/rooms/search", () => {
  it("blocks unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/rooms/search?q=room" });
    expect(res.statusCode).toBe(401);
  });

  it("returns only OPEN rooms (closedAt === null)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/rooms/search?q=Test%20Live",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ id: number; closed: boolean }>;
    expect(items.every((r) => r.closed === false)).toBe(true);
    expect(items.some((r) => r.id === testRoomId)).toBe(true);
  });

  it("supports the optional type filter", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/rooms/search?q=Test&type=live",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ type: string }>;
    expect(items.every((r) => r.type === "live")).toBe(true);
  });

  it("rejects queries shorter than 2 chars", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/rooms/search?q=a",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/notifications/count", () => {
  it("blocks unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/notifications/count" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 0 + supported=false (notification backend not yet wired)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/notifications/count",
      headers: { authorization: `Bearer ${testAccessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.unread).toBe(0);
    expect(d.total).toBe(0);
    expect(d.supported).toBe(false);
  });
});
