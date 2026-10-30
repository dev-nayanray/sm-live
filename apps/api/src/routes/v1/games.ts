import type { FastifyInstance } from "fastify";
import { gameLaunchSchema, paginationQuery } from "@sm-live/shared";
import { z } from "zod";
import { env } from "../../env.js";
import { prisma } from "../../lib/prisma.js";
import { validate, bodyOf, paramsOf, queryOf } from "../../lib/validate.js";
import { requireUser } from "../../lib/auth.js";
import { notFound } from "../../lib/errors.js";
import { launchGame, sessionState } from "../../services/game.service.js";

export async function gameRoutes(app: FastifyInstance) {
  app.get("/v1/games", async (req) => {
    const market = ((req.query as { market?: string }).market ?? "default").toLowerCase();
    const m = await prisma.market.findUnique({ where: { code: market } });
    const games = await prisma.game.findMany({
      where: { status: "active", ...(m ? { configs: { some: { marketId: m.id } } } : {}) },
      include: { configs: { where: m ? { marketId: m.id } : undefined } },
      orderBy: { sortOrder: "asc" },
    });
    return {
      ok: true,
      data: games.map((g) => ({
        code: g.code,
        name: g.name,
        isPro: g.isPro,
        thumbnailUrl: g.thumbnailUrl,
        version: g.version,
        minBet: g.configs[0]?.minBet ?? null,
        maxBet: g.configs[0]?.maxBet ?? null,
      })),
    };
  });

  /**
   * Game details (Prompt 22).
   * Returns the full game record including provider info (masked), config
   * (min/max bet, betting seconds), and the game's availability status.
   */
  app.get("/v1/games/:code", async (req) => {
    await requireUser(req);
    const { code } = validate(z.object({ code: z.string() }), paramsOf(req));
    const game = await prisma.game.findUnique({
      where: { code },
      include: {
        provider: { select: { name: true, enabled: true } },
        configs: { include: { market: { select: { code: true, name: true } } } },
      },
    });
    if (!game) throw notFound(`game ${code} not found`);
    return {
      ok: true,
      data: {
        code: game.code,
        name: game.name,
        version: game.version,
        status: game.status,
        isPro: game.isPro,
        thumbnailUrl: game.thumbnailUrl,
        sortOrder: game.sortOrder,
        provider: game.provider ? { name: game.provider.name, enabled: game.provider.enabled } : null,
        configs: game.configs.map((c) => ({
          market: c.market?.code ?? "default",
          marketName: c.market?.name ?? "Default",
          minBet: c.minBet,
          maxBet: c.maxBet,
          bettingSeconds: c.bettingSeconds,
          timeoutSeconds: c.timeoutSeconds,
          stuckPolicy: c.stuckPolicy,
        })),
      },
    };
  });

  /**
   * Recent game sessions for the authenticated user (Prompt 22).
   * Returns the last N sessions with their game code + status + dates.
   */
  app.get("/v1/games/sessions", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(paginationQuery, queryOf(req));
    const [total, sessions] = await Promise.all([
      prisma.gameSession.count({ where: { userId: user.id } }),
      prisma.gameSession.findMany({
        where: { userId: user.id },
        include: { game: { select: { code: true, name: true, thumbnailUrl: true, isPro: true } } },
        orderBy: { openedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      ok: true,
      data: {
        total, page: q.page, pageSize: q.pageSize,
        items: sessions.map((s) => ({
          sessionKey: s.sessionKey,
          gameCode: s.game.code,
          gameName: s.game.name,
          gameThumbnail: s.game.thumbnailUrl,
          isPro: s.game.isPro,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
          isActive: s.closedAt === null,
        })),
      },
    };
  });

  /**
   * Game history — the authenticated user's recent bets (Prompt 22).
   * Returns the last N bets with round status + payout information.
   */
  app.get("/v1/games/history", async (req) => {
    const { user } = await requireUser(req);
    const q = validate(paginationQuery, queryOf(req));
    const [total, bets] = await Promise.all([
      prisma.bet.count({ where: { userId: user.id } }),
      prisma.bet.findMany({
        where: { userId: user.id },
        include: {
          game: { select: { code: true, name: true, thumbnailUrl: true } },
          round: { select: { roundId: true, status: true, startedAt: true, endedAt: true } },
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
        items: bets.map((b) => ({
          id: b.id,
          gameCode: b.game.code,
          gameName: b.game.name,
          gameThumbnail: b.game.thumbnailUrl,
          amount: b.amount,
          status: b.status,
          payout: b.payout,
          providerTxId: b.providerTxId,
          roundId: b.round?.roundId ?? null,
          roundStatus: b.round?.status ?? null,
          createdAt: b.createdAt,
          settledAt: b.settledAt,
        })),
      },
    };
  });

  app.post("/v1/games/:code/launch", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { code } = validate(z.object({ code: z.string() }), paramsOf(req));
    const input = validate(gameLaunchSchema, bodyOf(req));
    const { user } = await requireUser(req);
    const market = input.market ?? user.marketCode;
    const result = await launchGame({ code, userId: user.id, marketCode: market, publicApiBase: env.PUBLIC_API_BASE });
    return { ok: true, data: result };
  });

  /** Reconnect support: pending bets + balance for a game session. */
  app.get("/v1/games/session/:id/state", async (req) => {
    const { id } = validate(z.object({ id: z.string().min(6).max(80) }), paramsOf(req));
    const { user } = await requireUser(req);
    const session = await prisma.gameSession.findUnique({ where: { sessionKey: id } });
    if (!session || session.userId !== user.id) throw notFound("session not found");
    return { ok: true, data: await sessionState(id) };
  });
}
