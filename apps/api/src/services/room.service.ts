import { env } from "../env.js";
import { notFound, badRequest } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { Room } from "@prisma/client";

/**
 * LiveKit access token minting. Publish rights only for hosts and
 * participants holding an allowed slot; everyone else is subscribe-only.
 */
export async function mintLiveKitToken(args: { room: Room; userId: number; displayName: string }) {
  const { AccessToken } = await import("livekit-server-sdk");
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: String(args.userId),
    name: args.displayName,
    ttl: 60 * 60 * 2,
  });

  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: args.room.id, userId: args.userId } },
  });
  const isHost = args.room.hostId === args.userId;
  const hasSlot = participant?.slotIndex != null;

  if (isHost || hasSlot) {
    at.addGrant({
      room: livekitRoomName(args.room),
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });
  } else {
    at.addGrant({ room: livekitRoomName(args.room), roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: true });
  }
  return { token: await at.toJwt(), url: env.LIVEKIT_URL, canPublish: isHost || hasSlot, slotIndex: participant?.slotIndex ?? null };
}

export function livekitRoomName(room: Room): string {
  return room.livekitRoom || `room_${room.id}`;
}

export async function getRoomOrThrow(roomId: number): Promise<Room> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.closedAt) throw notFound("room not found or closed");
  return room;
}

export async function requireSlotFree(roomId: number, userId: number) {
  const [room, taken] = await Promise.all([
    getRoomOrThrow(roomId),
    prisma.roomParticipant.findMany({ where: { roomId, leftAt: null, kickedAt: null, slotIndex: { not: null } } }),
  ]);
  if (taken.length >= room.slots) throw badRequest("all mic slots taken");
  if (taken.some((p) => p.userId === userId)) throw badRequest("user already holds a slot");
  return room;
}
