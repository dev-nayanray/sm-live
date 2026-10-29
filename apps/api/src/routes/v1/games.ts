import type { FastifyInstance } from "fastify";
import { gameLaunchSchema } from "@sm-live/shared";
import { z } from "zod";
import { env } from "../../env.js";
import { prisma } from "../../lib/prisma.js";
import { validate, bodyOf, paramsOf } from "../../lib/validate.js";
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
