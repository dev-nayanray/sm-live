import type { FastifyInstance } from "fastify";
import { createRoomSchema } from "@sm-live/shared";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { validate, bodyOf, paramsOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { mintLiveKitToken, livekitRoomName } from "../../services/room.service.js";
import { configService } from "../../services/config.service.js";
import { emitToRoom } from "../../socket.js";
import { recordSecurityEvent } from "../../lib/audit.js";

let roomCounter = Date.now() % 100000;
function roomSeq(): string {
  roomCounter += 1;
  return String(roomCounter);
}

export async function roomRoutes(app: FastifyInstance) {
  app.get("/v1/rooms", async (req) => {
    const q = validate(
      z.object({ type: z.string().optional(), country: z.string().optional(), market: z.string().default("default") }),
      req.query as Record<string, string>
    );
    const cfgBlocked = q.country ? await configService.isCountryBlocked(q.market, q.country) : false;
    const rooms = await prisma.room.findMany({
      where: {
        closedAt: null,
        ...(q.type ? { type: q.type } : {}),
        ...(cfgBlocked ? { country: { not: q.country! } } : {}),
      },
      include: {
        host: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } },
        participants: { where: { leftAt: null, kickedAt: null }, include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { ok: true, data: rooms.map(summarizeRoom) };
  });

  app.post("/v1/rooms", async (req) => {
    const input = validate(createRoomSchema, bodyOf(req));
    const { user } = await requireUser(req);
    // Banned users cannot create rooms.
    const ban = await prisma.playerRestriction.findFirst({
      where: { userId: user.id, type: "ban", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (ban) throw forbidden("account banned");
    const muteCheck = await prisma.playerRestriction.findFirst({
      where: { userId: user.id, type: "mute", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (muteCheck) throw forbidden("you are muted");
    // Prevent duplicate active host sessions — a host can only have ONE open
    // room at a time. They must end the previous one before starting a new.
    const existing = await prisma.room.findFirst({
      where: { hostId: user.id, closedAt: null },
      select: { id: true },
    });
    if (existing) throw badRequest("you already have an active room — end it first");
    const room = await prisma.room.create({
      data: {
        title: input.title,
        type: input.type,
        slots: input.slots,
        country: input.country.toUpperCase(),
        hostId: user.id,
        livekitRoom: `room_${roomSeq()}`,
      },
    });
    await prisma.room.update({ where: { id: room.id }, data: { livekitRoom: livekitRoomName(room) } });
    await prisma.roomParticipant.create({
      data: { roomId: room.id, userId: user.id, role: "host", slotIndex: 0 },
    });
    await recordSecurityEvent("room_created", `room ${room.id} created by ${user.id}`, req.ip);
    return { ok: true, data: { ...room, livekitRoom: livekitRoomName(room) } };
  });

  app.post("/v1/rooms/:id/join", async (req) => {
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const { user } = await requireUser(req);
    const room = await prisma.room.findUnique({ where: { id } });
    if (!room || room.closedAt) throw notFound("room not found");
    const existing = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId: id, userId: user.id } },
    });
    if (!existing) {
      await prisma.roomParticipant.create({ data: { roomId: id, userId: user.id } });
    } else if (existing.leftAt || existing.kickedAt) {
      await prisma.roomParticipant.update({ where: { id: existing.id }, data: { leftAt: null, kickedAt: null } });
    }
    // Notify the room that a viewer joined (used for live viewer-count updates).
    emitToRoom(id, "room:viewer_joined", { userId: user.id, displayName: user.displayName });
    return { ok: true, data: { roomId: id } };
  });

  app.post("/v1/rooms/:id/leave", async (req) => {
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const { user } = await requireUser(req);
    await prisma.roomParticipant.updateMany({
      where: { roomId: id, userId: user.id },
      data: { leftAt: new Date(), slotIndex: null },
    });
    emitToRoom(id, "room:viewer_left", { userId: user.id });
    return { ok: true };
  });

  /** LiveKit token — publish rights only for host or slot holders. */
  app.post("/v1/rooms/:id/token", async (req) => {
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const { user } = await requireUser(req);
    const room = await prisma.room.findUnique({ where: { id } });
    if (!room || room.closedAt) throw notFound("room not found");
    // ensure joined
    const p = await prisma.roomParticipant.findUnique({ where: { roomId_userId: { roomId: id, userId: user.id } } });
    if (!p) await prisma.roomParticipant.create({ data: { roomId: id, userId: user.id } });
    const token = await mintLiveKitToken({ room, userId: user.id, displayName: user.displayName });
    return { ok: true, data: { ...token, roomId: id, slots: room.slots, type: room.type, hostId: room.hostId } };
  });

  /** Slot request (voice/party rooms) — host approves via socket event. */
  app.post("/v1/rooms/:id/slot-request", async (req) => {
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const { user } = await requireUser(req);
    const room = await prisma.room.findUnique({ where: { id } });
    if (!room || room.closedAt) throw notFound("room not found");
    if (room.type === "live" && room.hostId !== user.id) throw badRequest("live rooms: only host publishes");
    emitToRoom(id, "slot:request", { userId: user.id, displayName: user.displayName });
    return { ok: true, data: { queued: true } };
  });

  /**
   * End a live broadcast (Prompt 17).
   *
   * Host-only: sets `closedAt`, emits `room:ended` to all connected
   * viewers so they can route back to the Live tab, and records a
   * security event. The LiveKit room itself is torn down by the LiveKit
   * server when the host disconnects — we don't call the LiveKit API
   * here (keeping the integration boundary clean; the SDK handles it).
   */
  app.post("/v1/rooms/:id/end", async (req) => {
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const { user } = await requireUser(req);
    const room = await prisma.room.findUnique({ where: { id } });
    if (!room) throw notFound("room not found");
    if (room.hostId !== user.id) throw forbidden("only the host can end this room");
    if (room.closedAt) throw badRequest("room already ended");
    await prisma.room.update({ where: { id }, data: { closedAt: new Date() } });
    // Release all active participants so the viewer count drops to 0.
    await prisma.roomParticipant.updateMany({
      where: { roomId: id, leftAt: null, kickedAt: null },
      data: { leftAt: new Date(), slotIndex: null },
    });
    emitToRoom(id, "room:ended", { roomId: id, hostId: user.id });
    await recordSecurityEvent("room_ended", `room ${id} ended by host ${user.id}`, req.ip);
    return { ok: true };
  });

  /**
   * Get the audience list (Prompt 17).
   *
   * Returns the list of currently-connected participants (leftAt +
   * kickedAt both null). Host-only? No — any authenticated user can
   * see who's in a public room (matches the existing /v1/rooms/:id
   * response which already includes participants).
   */
  app.get("/v1/rooms/:id/audience", async (req) => {
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    await requireUser(req);
    const participants = await prisma.roomParticipant.findMany({
      where: { roomId: id, leftAt: null, kickedAt: null },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return {
      ok: true,
      data: {
        count: participants.length,
        items: participants.map((p) => ({
          userId: p.userId,
          slotIndex: p.slotIndex,
          role: p.role,
          muted: p.muted,
          joinedAt: p.joinedAt,
          user: p.user,
        })),
      },
    };
  });

  app.get("/v1/rooms/:id", async (req) => {
    const { id } = validate(z.object({ id: z.coerce.number() }), paramsOf(req));
    const room = await prisma.room.findUnique({
      where: { id },
      include: {
        host: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } },
        participants: {
          where: { leftAt: null, kickedAt: null },
          include: { user: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } } },
        },
      },
    });
    if (!room) throw notFound("room not found");
    return { ok: true, data: summarizeRoom(room) };
  });
}

function summarizeRoom(room: {
  id: number; title: string; type: string; slots: number; country: string; createdAt: Date; closedAt: Date | null;
  host: { id: number; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number };
  participants: { userId: number; slotIndex: number | null; role: string; muted: boolean; user: { id: number; displayName: string; avatarUrl: string } }[];
}) {
  return {
    id: room.id,
    title: room.title,
    type: room.type,
    slots: room.slots,
    country: room.country,
    createdAt: room.createdAt,
    closed: room.closedAt != null,
    closedAt: room.closedAt,
    host: room.host,
    audienceCount: room.participants.length,
    participants: room.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      avatarUrl: p.user.avatarUrl,
      slotIndex: p.slotIndex,
      role: p.role,
      muted: p.muted,
    })),
  };
}
