import crypto from "node:crypto";
import { AppError, notFound, badRequest } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { launchSignature } from "../lib/hmac.js";
import { balanceOf } from "./ledger.service.js";

export async function launchGame(args: { code: string; userId: number; marketCode: string; publicApiBase: string }) {
  const game = await prisma.game.findUnique({
    where: { code: args.code },
    include: { provider: true, configs: true },
  });
  if (!game) throw notFound(`game ${args.code} not found`);
  if (game.status !== "active") throw badRequest(`game ${args.code} is ${game.status}`);
  if (!game.provider || !game.provider.enabled) throw badRequest(`game ${args.code} has no enabled provider`);

  const market = await prisma.market.findUnique({ where: { code: args.marketCode } });
  const config = game.configs.find((c) => c.marketId === market?.id) ?? game.configs[0];
  if (!config) throw badRequest(`game ${args.code} not configured for market ${args.marketCode}`);

  const freeze = await prisma.playerRestriction.findFirst({
    where: { userId: args.userId, type: "freeze_wallet", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
  if (freeze) throw badRequest("wallet frozen — cannot launch games");

  const sessionKey = crypto.randomBytes(16).toString("hex");
  await prisma.gameSession.create({
    data: { sessionKey, userId: args.userId, gameId: game.id, marketCode: args.marketCode },
  });

  const ts = Math.floor(Date.now() / 1000);
  const sig = launchSignature(sessionKey, args.userId, ts, game.provider.apiSecret);
  const url = new URL(`${game.provider.apiBase.replace(/\/$/, "")}/launch`);
  url.searchParams.set("session", sessionKey);
  url.searchParams.set("user", String(args.userId));
  url.searchParams.set("ts", String(ts));
  url.searchParams.set("sig", sig);

  return {
    sessionId: sessionKey,
    url: url.toString(),
    game: { code: game.code, name: game.name, minBet: config.minBet, maxBet: config.maxBet },
  };
}

export async function sessionState(sessionKey: string) {
  const session = await prisma.gameSession.findUnique({
    where: { sessionKey },
    include: { game: { include: { configs: true } } },
  });
  if (!session) throw notFound("session not found");

  const [balance, pendingBets, recentRounds] = await Promise.all([
    balanceOf(session.userId),
    prisma.bet.findMany({
      where: { sessionId: session.id, status: "placed" },
      include: { round: { select: { roundId: true, status: true, startedAt: true } } },
    }),
    prisma.gameRound.findMany({
      where: { bets: { some: { sessionId: session.id } } },
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    sessionId: sessionKey,
    balance,
    game: session.game.code,
    pendingBets: pendingBets.map((b) => ({
      betId: b.id,
      txId: b.providerTxId,
      amount: b.amount,
      status: b.status,
      roundId: b.round?.roundId,
    })),
    recentRounds: recentRounds.map((r) => ({ roundId: r.roundId, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt })),
  };
}

/** Resolve market-scoped GameConfig for a session, or throw. */
export async function resolveGameConfig(sessionKey: string) {
  const session = await prisma.gameSession.findUnique({
    where: { sessionKey },
    include: { game: { include: { provider: true, configs: true } } },
  });
  if (!session) throw notFound("session not found");
  if (session.closedAt) throw badRequest("session closed");
  const market = await prisma.market.findUnique({ where: { code: session.marketCode } });
  const config = session.game.configs.find((c) => c.marketId === market?.id) ?? session.game.configs[0];
  if (!config) throw new AppError("game_not_configured", "no game config for market", 422);
  return { session, config };
}

/** Find or open a round; enforce the betting window. */
export async function openRoundOrCheck(gameId: number, roundId: string, bettingSeconds: number) {
  let round = await prisma.gameRound.findUnique({ where: { roundId } });
  if (!round) {
    try {
      round = await prisma.gameRound.create({ data: { roundId, gameId } });
    } catch {
      round = await prisma.gameRound.findUniqueOrThrow({ where: { roundId } });
    }
  }
  if (round.status !== "open") throw badRequest(`round ${roundId} already ${round.status}`);
  const elapsed = (Date.now() - round.startedAt.getTime()) / 1000;
  if (elapsed > bettingSeconds) throw badRequest(`round ${roundId} betting window closed (${bettingSeconds}s)`);
  return round;
}
