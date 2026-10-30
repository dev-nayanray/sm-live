import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { env } from "./env.js";
import { jwtVerify, UserTokenPayload } from "./lib/auth.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";

let io: IOServer | null = null;

/** Broadcast the current viewer count for a room to all its subscribers. */
async function broadcastViewerCount(roomId: number) {
  const count = await prisma.roomParticipant.count({
    where: { roomId, leftAt: null, kickedAt: null },
  });
  io?.to(`room:${roomId}`).emit("room:viewer_count", { roomId, count });
}

export function initSocket(httpServer: HttpServer) {
  io = new IOServer(httpServer, { cors: { origin: env.CORS_ORIGINS.split(","), credentials: true } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("unauthorized"));
    try {
      const payload = jwtVerify<UserTokenPayload>(token, env.JWT_SECRET);
      socket.data.userId = payload.sub;
      socket.data.market = payload.market;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as number;

    socket.on("room:join", async (roomId: number, ack?: (r: unknown) => void) => {
      const room = await prisma.room.findUnique({ where: { id: Number(roomId) } });
      if (!room || room.closedAt) return ack?.({ ok: false, error: "room not found" });
      await socket.join(`room:${roomId}`);
      // Broadcast updated viewer count to everyone in the room.
      void broadcastViewerCount(Number(roomId));
      ack?.({ ok: true });
    });

    socket.on("room:leave", (roomId: number) => {
      void socket.leave(`room:${roomId}`);
      void broadcastViewerCount(Number(roomId));
    });

    socket.on("chat:send", async (msg: { roomId: number; text: string }, ack?: (r: unknown) => void) => {
      const text = String(msg?.text ?? "").trim().slice(0, 300);
      if (!text) return ack?.({ ok: false });
      const mute = await prisma.playerRestriction.findFirst({
        where: { userId, type: "mute", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      });
      if (mute) return ack?.({ ok: false, error: "muted" });
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, vipLevel: true, nobleLevel: true } });
      io?.to(`room:${msg.roomId}`).emit("chat:message", { roomId: msg.roomId, from: { id: userId, ...user }, text, ts: Date.now() });
      ack?.({ ok: true });
    });

    // host actions: mute / kick a participant
    socket.on("room:kick", async (p: { roomId: number; targetUserId: number }, ack?: (r: unknown) => void) => {
      const room = await prisma.room.findUnique({ where: { id: p.roomId } });
      if (!room || room.hostId !== userId) return ack?.({ ok: false, error: "not host" });
      await prisma.roomParticipant.updateMany({
        where: { roomId: p.roomId, userId: p.targetUserId },
        data: { kickedAt: new Date(), slotIndex: null },
      });
      io?.to(`room:${p.roomId}`).emit("room:kicked", { roomId: p.roomId, userId: p.targetUserId });
      void broadcastViewerCount(p.roomId);
      ack?.({ ok: true });
    });

    socket.on("room:mute", async (p: { roomId: number; targetUserId: number; muted: boolean }, ack?: (r: unknown) => void) => {
      const room = await prisma.room.findUnique({ where: { id: p.roomId } });
      if (!room || (room.hostId !== userId && p.targetUserId !== userId)) return ack?.({ ok: false, error: "not allowed" });
      await prisma.roomParticipant.updateMany({
        where: { roomId: p.roomId, userId: p.targetUserId },
        data: { muted: p.muted },
      });
      io?.to(`room:${p.roomId}`).emit("room:muted", { roomId: p.roomId, userId: p.targetUserId, muted: p.muted });
      ack?.({ ok: true });
    });

    // slot approval by host
    socket.on("slot:approve", async (p: { roomId: number; targetUserId: number; slotIndex: number }, ack?: (r: unknown) => void) => {
      const room = await prisma.room.findUnique({ where: { id: p.roomId } });
      if (!room || room.hostId !== userId) return ack?.({ ok: false, error: "not host" });
      const taken = await prisma.roomParticipant.findFirst({ where: { roomId: p.roomId, slotIndex: p.slotIndex, kickedAt: null, leftAt: null } });
      if (taken) return ack?.({ ok: false, error: "slot taken" });
      await prisma.roomParticipant.updateMany({
        where: { roomId: p.roomId, userId: p.targetUserId },
        data: { slotIndex: p.slotIndex, role: "cohost" },
      });
      io?.to(`room:${p.roomId}`).emit("slot:assigned", { roomId: p.roomId, userId: p.targetUserId, slotIndex: p.slotIndex });
      ack?.({ ok: true });
    });

    socket.on("disconnect", () => {
      // Presence is handled via RoomParticipant.leftAt which is set by the
      // /v1/rooms/:id/leave API. We don't auto-mark participants as left
      // on socket disconnect because a brief network blip shouldn't drop
      // a viewer from the audience list — they'll rejoin on reconnect.
      // The host's /end endpoint is the authoritative "room closed" signal.
    });
  });

  logger.info("socket.io initialised");
  return io;
}

export function emitToRoom(roomId: number, event: string, payload: unknown) {
  io?.to(`room:${roomId}`).emit(event, payload);
}

export function getIO() {
  return io;
}
