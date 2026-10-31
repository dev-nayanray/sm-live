import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { homeFeedQuerySchema, searchQuerySchema } from "@sm-live/shared";
import { prisma } from "../../lib/prisma.js";
import { validate, queryOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";

/**
 * Mobile feed + search routes (Prompt 15).
 *
 * Three endpoints power the SM Live Home + Discover + Search experience:
 *
 *   GET /v1/feed/home           — aggregated home feed (rooms + ranking
 *                                 + content) so the client can mount
 *                                 Home with a single round-trip.
 *   GET /v1/users/search        — paginated user search by display name.
 *   GET /v1/rooms/search        — paginated room search by title + host.
 *
 * The home aggregator is intentionally read-only and never joins on
 * sensitive columns: it returns only public fields (display name, avatar,
 * vip/noble level, country). Phone and email are masked at the source
 * (publicUser in lib/auth.ts) and never returned by these endpoints.
 *
 * Search is server-side and rate-limited per the global Fastify
 * rate-limit config; the client MUST NOT issue unrestricted database
 * searches.
 */
export async function feedRoutes(app: FastifyInstance) {
  /**
   * Home feed aggregator. Returns:
   *   - rooms:        up to 20 open rooms (newest first)
   *   - popularRooms: up to 10 open rooms ranked by audience size
   *   - liveRooms:    up to 10 open live-type rooms
   *   - creators:     up to 10 weekly-top gifters (acts as
   *                   "recommended creators" since there's no follow graph)
   *   - videos:       up to 6 short videos (when short_video.enabled)
   *   - moments:      up to 6 moments
   *   - games:        up to 6 active games (acts as "trending categories")
   *
   * When `category` is "live" / "popular" / "creators", only the
   * corresponding section is populated — the others are empty arrays.
   * This keeps the response small and lets the client render category
   * tabs without firing extra requests.
   */
  app.get("/v1/feed/home", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    await requireUser(req);
    const q = validate(homeFeedQuerySchema, queryOf(req));
    const country = q.country?.toUpperCase();

    const baseRoomWhere: Prisma.RoomWhereInput = {
      closedAt: null,
      ...(country ? { country } : {}),
    };
    const liveRoomWhere: Prisma.RoomWhereInput = { ...baseRoomWhere, type: "live" };

    // Run the queries that the requested category needs. for_you runs all
    // of them; the other categories short-circuit.
    const needRooms = q.category === "for_you" || q.category === "live" || q.category === "popular";
    const needCreators = q.category === "for_you" || q.category === "creators";
    const needContent = q.category === "for_you";

    const [rooms, popularRooms, liveRooms, creators, videos, moments, games] = await Promise.all([
      needRooms ? prisma.room.findMany({
        where: baseRoomWhere,
        include: {
          host: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } },
          participants: { where: { leftAt: null, kickedAt: null }, select: { userId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }) : Promise.resolve([]),
      needRooms ? prisma.room.findMany({
        where: baseRoomWhere,
        include: {
          host: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } },
          participants: { where: { leftAt: null, kickedAt: null }, select: { userId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100, // fetch more so we can sort by audience client-side
      }) : Promise.resolve([]),
      needRooms ? prisma.room.findMany({
        where: liveRoomWhere,
        include: {
          host: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } },
          participants: { where: { leftAt: null, kickedAt: null }, select: { userId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }) : Promise.resolve([]),
      needCreators ? prisma.ranking.findMany({
        where: { period: "weekly", scope: "global" },
        orderBy: { points: "desc" },
        take: 10,
        include: { user: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true, country: true } } },
      }) : Promise.resolve([]),
      needContent ? prisma.shortVideo.findMany({
        where: { status: "published" },
        orderBy: { createdAt: "desc" },
        take: 6,
      }) : Promise.resolve([]),
      needContent ? prisma.moment.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
      }) : Promise.resolve([]),
      needContent ? prisma.game.findMany({
        where: { status: "active" },
        orderBy: { sortOrder: "asc" },
        take: 6,
        select: { code: true, name: true, isPro: true, thumbnailUrl: true, status: true },
      }) : Promise.resolve([]),
    ]);

    // Sort popularRooms by audience count (desc). We compute it from the
    // participants length so we don't need a separate aggregate query.
    const popular = [...popularRooms]
      .map((r) => ({ room: r, audience: r.participants.length }))
      .sort((a, b) => b.audience - a.audience)
      .slice(0, 10)
      .map((x) => x.room);

    return {
      ok: true,
      data: {
        category: q.category,
        rooms: rooms.map(summarizeRoom),
        popularRooms: popular.map(summarizeRoom),
        liveRooms: liveRooms.map(summarizeRoom),
        creators: creators.map((r, i) => ({
          rank: i + 1,
          points: r.points,
          user: r.user,
        })),
        videos: videos.map((v) => ({
          id: v.id, authorId: v.authorId, title: v.title,
          videoUrl: v.videoUrl, coverUrl: v.coverUrl, likes: v.likes,
          country: v.country, createdAt: v.createdAt,
        })),
        moments: moments.map((m) => ({
          id: m.id, authorId: m.authorId, text: m.text,
          imageUrl: m.imageUrl, likes: m.likes, country: m.country,
          createdAt: m.createdAt,
        })),
        games,
        generatedAt: new Date().toISOString(),
      },
    };
  });

  /**
   * User search. Searches by displayName (case-insensitive contains).
   * Excludes the calling user from results. Returns public fields only —
   * phone + email are NEVER returned here (they're not even selected).
   *
   * Rate-limited to 30/min to prevent user enumeration. Combined with
   * the min query length of 2, this caps brute-force at ~30 attempts
   * per minute per token.
   */
  app.get("/v1/users/search", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { user } = await requireUser(req);
    const q = validate(searchQuerySchema, queryOf(req));
    const where: Prisma.UserWhereInput = {
      id: { not: user.id },
      displayName: { contains: q.q, mode: "insensitive" },
      isBot: false,
    };
    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true, displayName: true, avatarUrl: true,
          vipLevel: true, nobleLevel: true, country: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((u) => ({ ...u, isHosting: false /* no host-graph yet */ })),
      },
    };
  });

  /**
   * Room search. Searches by title (case-insensitive contains). Only
   * returns OPEN rooms (closedAt === null) — never closed/archived rooms.
   * Optional `type` filter narrows by room type.
   */
  app.get("/v1/rooms/search", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    await requireUser(req);
    const q = validate(searchQuerySchema, queryOf(req));
    const where: Prisma.RoomWhereInput = {
      closedAt: null,
      title: { contains: q.q, mode: "insensitive" },
      ...(q.type && q.type !== "all" ? { type: q.type } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.room.count({ where }),
      prisma.room.findMany({
        where,
        include: {
          host: { select: { id: true, displayName: true, avatarUrl: true, vipLevel: true, nobleLevel: true } },
          participants: { where: { leftAt: null, kickedAt: null }, select: { userId: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map(summarizeRoom),
      },
    };
  });

  // The real GET /v1/notifications/count lives in routes/v1/notifications.ts
  // (Prompt 23) — the old always-zero stub that used to sit here was removed
  // because Fastify fatally rejects duplicated route registrations.
}

/**
 * Local room summariser (mirrors the shape used by /v1/rooms but with
 * the participants pre-mapped to an audienceCount + participant list).
 * Keeping it here (rather than importing from rooms.ts) so this route
 * file is self-contained — the rooms.ts summariser is private.
 */
function summarizeRoom(room: {
  id: number; title: string; type: string; slots: number; country: string;
  createdAt: Date; closedAt: Date | null;
  host: { id: number; displayName: string; avatarUrl: string; vipLevel: number; nobleLevel: number };
  participants: { userId: number }[];
}) {
  return {
    id: room.id,
    title: room.title,
    type: room.type,
    slots: room.slots,
    country: room.country,
    createdAt: room.createdAt,
    closed: room.closedAt != null,
    host: room.host,
    audienceCount: room.participants.length,
  };
}

// re-export z so the route file is self-contained for typecheck
void z;
