import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { validate, bodyOf, paramsOf, queryOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { recordSecurityEvent } from "../../lib/audit.js";

/**
 * SM Live — Social Connections API (Prompt 16).
 *
 * Endpoints:
 *   GET    /v1/users/:id                — public profile + follow/block status
 *   PATCH  /v1/auth/me                  — update own profile (displayName, avatarUrl, country)
 *   POST   /v1/social/follow/:userId     — follow a user
 *   DELETE /v1/social/follow/:userId     — unfollow a user
 *   GET    /v1/social/followers/:userId  — paginated followers list
 *   GET    /v1/social/following/:userId  — paginated following list
 *   POST   /v1/social/block/:userId      — block a user
 *   DELETE /v1/social/block/:userId      — unblock a user
 *   GET    /v1/social/blocked             — list users I blocked
 *   POST   /v1/social/report/:userId      — report a user
 *   GET    /v1/social/suggestions         — suggested users to follow
 *
 * Security:
 *   - All endpoints require authentication.
 *   - Follow/block/report validate both parties exist.
 *   - Prevents self-follow, self-block, self-report.
 *   - Duplicate follows prevented by unique constraint.
 *   - Blocked users cannot follow the blocker.
 *   - Profile data uses the publicUser shape (masked phone/email).
 */
export async function socialRoutes(app: FastifyInstance) {
  const PUBLIC_USER_SELECT = {
    id: true, displayName: true, avatarUrl: true,
    vipLevel: true, nobleLevel: true, country: true,
    marketCode: true, createdAt: true,
  } as const;

  // --- Get public profile ---
  app.get("/v1/users/:id", async (req) => {
    const { user } = await requireUser(req);
    const { id } = validate(z.object({ id: z.coerce.number().int().positive() }), paramsOf(req));
    const target = await prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!target) throw notFound("user not found");

    // Check block relationship (either direction).
    const blocked = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: user.id, blockedId: id },
          { blockerId: id, blockedId: user.id },
        ],
      },
    });

    // Check follow status.
    const following = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: user.id, followingId: id } },
    });

    // Counts.
    const [followerCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: id } }),
      prisma.follow.count({ where: { followerId: id } }),
    ]);

    return {
      ok: true,
      data: {
        ...target,
        followerCount,
        followingCount,
        isFollowing: !!following,
        isBlocked: !!blocked,
      },
    };
  });

  // --- Update own profile ---
  app.patch("/v1/auth/me", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { user } = await requireUser(req);
    const input = validate(z.object({
      displayName: z.string().trim().min(2).max(40).optional(),
      avatarUrl: z.string().trim().max(500).optional(),
      country: z.string().trim().length(2).optional(),
    }), bodyOf(req));

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(input.displayName !== undefined && { displayName: input.displayName }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        ...(input.country !== undefined && { country: input.country.toUpperCase() }),
      },
      select: PUBLIC_USER_SELECT,
    });

    await recordSecurityEvent("profile_updated", `user ${user.id} updated profile`, req.ip);
    return { ok: true, data: updated };
  });

  // --- Follow ---
  app.post("/v1/social/follow/:userId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { user } = await requireUser(req);
    const { userId } = validate(z.object({ userId: z.coerce.number().int().positive() }), paramsOf(req));
    if (userId === user.id) throw badRequest("cannot follow yourself");

    // Check target exists.
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw notFound("user not found");

    // Check block: cannot follow someone who blocked you.
    const blockedBy = await prisma.userBlock.findUnique({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: user.id } },
    });
    if (blockedBy) throw forbidden("cannot follow this user");

    // Create follow (unique constraint prevents duplicates).
    try {
      await prisma.follow.create({
        data: { followerId: user.id, followingId: userId },
      });
    } catch (e) {
      // P2002 = unique constraint violation → already following (idempotent).
      if ((e as { code?: string }).code === "P2002") {
        return { ok: true, data: { following: true, alreadyFollowing: true } };
      }
      throw e;
    }

    return { ok: true, data: { following: true, alreadyFollowing: false } };
  });

  // --- Unfollow ---
  app.delete("/v1/social/follow/:userId", async (req) => {
    const { user } = await requireUser(req);
    const { userId } = validate(z.object({ userId: z.coerce.number().int().positive() }), paramsOf(req));
    await prisma.follow.deleteMany({
      where: { followerId: user.id, followingId: userId },
    });
    return { ok: true, data: { following: false } };
  });

  // --- Followers list ---
  app.get("/v1/social/followers/:userId", async (req) => {
    const { user } = await requireUser(req);
    const { userId } = validate(z.object({ userId: z.coerce.number().int().positive() }), paramsOf(req));
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
    }), queryOf(req));

    const [total, follows] = await Promise.all([
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.findMany({
        where: { followingId: userId },
        include: { follower: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    // For each follower, check if the current user follows them back.
    const followerIds = follows.map((f) => f.followerId);
    const myFollows = await prisma.follow.findMany({
      where: { followerId: user.id, followingId: { in: followerIds } },
      select: { followingId: true },
    });
    const myFollowSet = new Set(myFollows.map((f) => f.followingId));

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: follows.map((f) => ({
          ...f.follower,
          isFollowing: myFollowSet.has(f.followerId),
        })),
      },
    };
  });

  // --- Following list ---
  app.get("/v1/social/following/:userId", async (req) => {
    await requireUser(req);
    const { userId } = validate(z.object({ userId: z.coerce.number().int().positive() }), paramsOf(req));
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
    }), queryOf(req));

    const [total, follows] = await Promise.all([
      prisma.follow.count({ where: { followerId: userId } }),
      prisma.follow.findMany({
        where: { followerId: userId },
        include: { following: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: follows.map((f) => f.following),
      },
    };
  });

  // --- Block ---
  app.post("/v1/social/block/:userId", async (req) => {
    const { user } = await requireUser(req);
    const { userId } = validate(z.object({ userId: z.coerce.number().int().positive() }), paramsOf(req));
    if (userId === user.id) throw badRequest("cannot block yourself");
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw notFound("user not found");

    try {
      await prisma.userBlock.create({
        data: { blockerId: user.id, blockedId: userId },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        return { ok: true, data: { blocked: true, alreadyBlocked: true } };
      }
      throw e;
    }
    // Also unfollow each other.
    await prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: user.id, followingId: userId },
          { followerId: userId, followingId: user.id },
        ],
      },
    });
    return { ok: true, data: { blocked: true, alreadyBlocked: false } };
  });

  // --- Unblock ---
  app.delete("/v1/social/block/:userId", async (req) => {
    const { user } = await requireUser(req);
    const { userId } = validate(z.object({ userId: z.coerce.number().int().positive() }), paramsOf(req));
    await prisma.userBlock.deleteMany({
      where: { blockerId: user.id, blockedId: userId },
    });
    return { ok: true, data: { blocked: false } };
  });

  // --- List blocked users ---
  app.get("/v1/social/blocked", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
    }), queryOf(req));

    const [total, blocks] = await Promise.all([
      prisma.userBlock.count({ where: { blockerId: user.id } }),
      prisma.userBlock.findMany({
        where: { blockerId: user.id },
        include: { blocked: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: blocks.map((b) => b.blocked),
      },
    };
  });

  // --- Report user ---
  app.post("/v1/social/report/:userId", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { user } = await requireUser(req);
    const { userId } = validate(z.object({ userId: z.coerce.number().int().positive() }), paramsOf(req));
    if (userId === user.id) throw badRequest("cannot report yourself");

    const input = validate(z.object({
      reason: z.enum(["harassment", "spam", "impersonation", "inappropriate_content", "scam", "other"]).default("other"),
      details: z.string().trim().max(1000).default(""),
    }), bodyOf(req));

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw notFound("user not found");

    const report = await prisma.userReport.create({
      data: {
        reporterId: user.id,
        reportedId: userId,
        reason: input.reason,
        details: input.details,
      },
    });

    await recordSecurityEvent("user_reported", `user ${user.id} reported user ${userId} for ${input.reason}`, req.ip);
    return { ok: true, data: { id: report.id, status: "open" } };
  });

  // --- Suggested users to follow ---
  app.get("/v1/social/suggestions", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
    }), queryOf(req));

    // Suggest top weekly gifters that the user doesn't already follow.
    const followingIds = await prisma.follow.findMany({
      where: { followerId: user.id },
      select: { followingId: true },
    });
    const excludeIds = [...followingIds.map((f) => f.followingId), user.id];

    const [total, items] = await Promise.all([
      prisma.ranking.count({
        where: { period: "weekly", scope: "global", userId: { notIn: excludeIds } },
      }),
      prisma.ranking.findMany({
        where: { period: "weekly", scope: "global", userId: { notIn: excludeIds } },
        orderBy: { points: "desc" },
        take: q.pageSize,
        skip: (q.page - 1) * q.pageSize,
        include: { user: { select: PUBLIC_USER_SELECT } },
      }),
    ]);

    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: items.map((r) => ({
          ...r.user,
          rankingPoints: r.points,
          rank: 0, // not meaningful for suggestions
        })),
      },
    };
  });
}
