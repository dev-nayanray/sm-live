import type { FastifyInstance, FastifyRequest } from "fastify";
import { providerBetSchema, providerRoundWebhookSchema, providerWinSchema } from "@sm-live/shared";
import { prisma } from "../lib/prisma.js";
import { AppError, notFound, badRequest, unauthorized } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { verifyProviderSignature } from "../lib/hmac.js";
import { postLedgerEntries, balanceOf } from "../services/ledger.service.js";
import { resolveGameConfig, openRoundOrCheck } from "../services/game.service.js";
import { recordApiError, recordSecurityEvent } from "../lib/audit.js";

/**
 * Provider wallet API — every call must carry:
 *   X-Api-Key, X-Timestamp (unix seconds), X-Signature
 * signature = HMAC_SHA256(secret, `${METHOD}|${path}|${timestamp}|${sha256(body)}`)
 * The api key must be enabled and the caller IP must be in its allow list.
 */
async function providerAuth(req: FastifyRequest) {
  const key = req.headers["x-api-key"];
  const ts = req.headers["x-timestamp"];
  const sig = req.headers["x-signature"];
  if (typeof key !== "string" || typeof ts !== "string" || typeof sig !== "string") {
    throw unauthorized("missing provider auth headers");
  }
  const accessKey = await prisma.apiAccessKey.findUnique({
    where: { key },
    include: { provider: true },
  });
  if (!accessKey || !accessKey.enabled) {
    await recordSecurityEvent("provider_auth", `unknown or disabled api key`, req.ip, { key: key.slice(0, 4) + "…" });
    throw unauthorized("unknown api key");
  }
  if (!ipAllowed(accessKey.ipAllowList, req.ip)) {
    await recordSecurityEvent("provider_auth", `ip not in allow list`, req.ip, { key: accessKey.label });
    throw unauthorized("ip not allowed");
  }
  const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
  const ok = verifyProviderSignature({
    method: req.method,
    path: req.url.split("?")[0]!,
    timestamp: Number(ts),
    rawBody,
    signature: sig,
    secret: accessKey.provider.apiSecret,
  });
  if (!ok) {
    await recordSecurityEvent("provider_auth", `bad signature`, req.ip, { key: accessKey.label });
    throw unauthorized("bad signature or stale timestamp");
  }
  return accessKey;
}

function ipAllowed(allowList: string, ip: string): boolean {
  const list = allowList.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes(ip)) return true;
  // allow CIDR-style prefixes like "172.18."
  return list.some((entry) => entry.endsWith("*") && ip.startsWith(entry.slice(0, -1)));
}

export async function providerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/provider/")) {
      try {
        await providerAuth(req);
      } catch (e) {
        await recordApiError("provider", req.url, (e as Error).message, { ip: req.ip });
        throw e;
      }
    }
  });

  app.post("/provider/wallet/balance", async (req) => {
    const { sessionId } = validate(providerBetSchema.pick({ sessionId: true }), req.body);
    const { session } = await resolveGameConfig(sessionId);
    return { ok: true, data: { userId: session.userId, balance: await balanceOf(session.userId), currency: "coins" } };
  });

  app.post("/provider/bet", async (req) => {
    const input = validate(providerBetSchema, req.body);
    const { session, config } = await resolveGameConfig(input.sessionId);

    if (session.game.status !== "active") {
      await recordApiError("provider", "/provider/bet", `game ${session.game.status}`);
      throw badRequest(`game ${session.game.code} is ${session.game.status}`);
    }
    if (input.amount < config.minBet || input.amount > config.maxBet) {
      throw badRequest(`bet ${input.amount} outside ${config.minBet}..${config.maxBet}`);
    }
    const round = await openRoundOrCheck(session.gameId, input.roundId, config.bettingSeconds);

    // Idempotency: same providerTxId returns the original bet.
    const existing = await prisma.bet.findUnique({ where: { providerTxId: input.txId } });
    if (existing) {
      return { ok: true, data: { betId: existing.id, status: existing.status, replayed: true, balance: await balanceOf(session.userId) } };
    }

    const result = await postLedgerEntries([
      {
        userId: session.userId,
        kind: "bet_debit",
        amount: -input.amount,
        txKey: `bet:${input.txId}`,
        refType: "bet",
        meta: { roundId: input.roundId, game: session.game.code },
      },
    ]);
    const entry = result.entries[0]!;

    if (entry.replayed) {
      // lost a race against a concurrent identical call — return the winner's bet
      const winner = await prisma.bet.findUnique({ where: { providerTxId: input.txId } });
      return { ok: true, data: { betId: winner?.id ?? null, status: winner?.status ?? "placed", replayed: true, balance: entry.balanceAfter } };
    }

    let bet;
    try {
      bet = await prisma.bet.create({
        data: {
          roundId: round.id,
          sessionId: session.id,
          userId: session.userId,
          gameKey: session.gameId,
          amount: input.amount,
          providerTxId: input.txId,
          status: "placed",
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        const winner = await prisma.bet.findUnique({ where: { providerTxId: input.txId } });
        return { ok: true, data: { betId: winner?.id ?? null, status: winner?.status ?? "placed", replayed: true, balance: entry.balanceAfter } };
      }
      throw e;
    }

    return {
      ok: true,
      data: { betId: bet.id, balance: result.balances[session.userId] ?? 0, currency: "coins" },
    };
  });

  app.post("/provider/win", async (req) => {
    const input = validate(providerWinSchema, req.body);
    const { session } = await resolveGameConfig(input.sessionId);
    const round = await prisma.gameRound.findUnique({ where: { roundId: input.roundId } });
    if (!round) throw notFound("round not found");

    const existing = await prisma.payout.findFirst({
      where: { bet: { providerTxId: input.txId } },
    });
    if (existing) {
      return { ok: true, data: { payoutId: existing.id, replayed: true, balance: await balanceOf(session.userId) } };
    }

    const result = await postLedgerEntries([
      {
        userId: session.userId,
        kind: "win_credit",
        amount: input.amount,
        txKey: `win:${input.txId}`,
        refType: "bet",
        meta: { roundId: input.roundId, multiplier: input.payoutMultiplier },
      },
    ]);

    // Mark the matching bet won; create payout row. If no bet matches txId (provider-side win),
    // attach to the round and mark any still-placed bets of this session/round lost.
    const bet = await prisma.bet.findUnique({ where: { providerTxId: input.txId } });
    let payoutRow;
    if (bet) {
      await prisma.bet.update({ where: { id: bet.id }, data: { status: "won", payout: input.amount, settledAt: new Date() } });
      payoutRow = await prisma.payout.create({ data: { betId: bet.id, amount: input.amount, multiplier: input.payoutMultiplier ?? 1 } });
    } else {
      const roundBets = await prisma.bet.findMany({ where: { roundId: round.id, sessionId: session.id, status: "placed" } });
      const target = roundBets[0];
      if (target) {
        await prisma.bet.update({ where: { id: target.id }, data: { status: "won", payout: input.amount, settledAt: new Date() } });
        payoutRow = await prisma.payout.create({ data: { betId: target.id, amount: input.amount, multiplier: input.payoutMultiplier ?? 1 } });
      }
    }

    return { ok: true, data: { payoutId: payoutRow?.id ?? null, balance: result.balances[session.userId] ?? 0 } };
  });

  /** cancel + refund both reverse a placed bet idempotently. */
  app.post("/provider/cancel", async (req) => await reverseBet(req, "cancelled"));
  app.post("/provider/refund", async (req) => await reverseBet(req, "refunded"));

  /** Round settlement webhook — retry-safe: replays return duplicate:true with 200. */
  app.post("/provider/webhook/round", async (req) => {
    const input = validate(providerRoundWebhookSchema, req.body);
    const round = await prisma.gameRound.findUnique({ where: { roundId: input.roundId } });
    if (!round) throw notFound("round not found");

    if (round.status !== "open") {
      return { ok: true, data: { duplicate: true, status: round.status } };
    }

    await prisma.$transaction(async (tx) => {
      for (const b of input.bets) {
        const bet = await tx.bet.findUnique({ where: { providerTxId: b.txId } });
        if (!bet || bet.status !== "placed") continue;
        if (b.outcome === "refunded") {
          await tx.bet.update({ where: { id: bet.id }, data: { status: "refunded", settledAt: new Date() } });
          await postLedgerEntries(
            [{ userId: bet.userId, kind: "bet_refund", amount: bet.amount, txKey: `betrefund:${b.txId}`, refType: "bet", refId: bet.id }],
            tx
          );
        } else {
          await tx.bet.update({
            where: { id: bet.id },
            data: { status: b.outcome === "won" ? "won" : "lost", settledAt: new Date() },
          });
        }
      }
      await tx.gameRound.update({
        where: { id: round.id },
        data: { status: input.status === "cancelled" ? "cancelled" : "settled", endedAt: new Date(), resultJson: input as never, settleSource: "webhook" },
      });
    });

    return { ok: true, data: { duplicate: false, status: input.status } };
  });
}

async function reverseBet(req: FastifyRequest, finalStatus: "cancelled" | "refunded") {
  const input = validate(providerBetSchema.pick({ sessionId: true, txId: true, roundId: true }), req.body);
  const { session } = await resolveGameConfig(input.sessionId);
  const bet = await prisma.bet.findUnique({ where: { providerTxId: input.txId } });
  if (!bet) throw notFound("bet not found");
  if (bet.status === finalStatus) {
    return { ok: true, data: { replayed: true, balance: await balanceOf(session.userId) } };
  }
  if (bet.status !== "placed") throw badRequest(`bet is ${bet.status}; cannot ${finalStatus}`);

  const result = await postLedgerEntries([
    { userId: bet.userId, kind: "bet_refund", amount: bet.amount, txKey: `betrefund:${bet.providerTxId}`, refType: "bet", refId: bet.id },
  ]);
  await prisma.bet.update({ where: { id: bet.id }, data: { status: finalStatus, settledAt: new Date() } });
  return { ok: true, data: { balance: result.balances[bet.userId] ?? 0, status: finalStatus } };
}
