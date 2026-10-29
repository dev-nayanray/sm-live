import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { providerSignature, verifyProviderSignature } from "../src/lib/hmac.js";
import { buildTestApp } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import type { FastifyInstance } from "fastify";

const SECRET = "mockcorp-secret-please-rotate";
const API_KEY = "mockcorp-key-1";

let app: FastifyInstance;
let userId: number;
let sessionId: string;
const roundId = `wh-test-${crypto.randomBytes(3).toString("hex")}`;

function signedHeaders(path: string, body: unknown, opts?: { ts?: number; secret?: string }) {
  const raw = JSON.stringify(body);
  const ts = opts?.ts ?? Math.floor(Date.now() / 1000);
  return {
    "content-type": "application/json",
    "X-Api-Key": API_KEY,
    "X-Timestamp": String(ts),
    "X-Signature": providerSignature("POST", path, ts, raw, opts?.secret ?? SECRET),
  };
}

beforeAll(async () => {
  app = await buildTestApp();
  const suffix = crypto.randomBytes(4).toString("hex");
  const user = await prisma.user.create({ data: { phone: `+88016800${suffix}`, passwordHash: "x", displayName: `WH ${suffix}` } });
  await prisma.wallet.create({ data: { userId: user.id, balance: 0 } });
  userId = user.id;
  const game = await prisma.game.findUniqueOrThrow({ where: { code: "crash-x" } });
  const session = await prisma.gameSession.create({ data: { sessionKey: `wh-sess-${suffix}`, userId, gameId: game.id, marketCode: "default" } });
  sessionId = session.sessionKey;
  await prisma.$executeRawUnsafe(`UPDATE "Wallet" SET balance = 5000 WHERE "userId" = ${userId}`);
  await prisma.ledgerEntry.create({
    data: {
      userId, walletId: (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).id,
      kind: "recharge", amount: 5000, balanceAfter: 5000, txKey: `wh:fund:${suffix}`,
    },
  });
});

afterAll(async () => {
  await app.close();
});

describe("provider signature scheme", () => {
  it("accepts a correctly signed call", () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = providerSignature("POST", "/provider/bet", ts, `{"a":1}`, SECRET);
    expect(verifyProviderSignature({ method: "POST", path: "/provider/bet", timestamp: ts, rawBody: `{"a":1}`, signature: sig, secret: SECRET })).toBe(true);
  });

  it("rejects tampered body, wrong secret, and stale timestamps", () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = providerSignature("POST", "/provider/bet", ts, `{"a":1}`, SECRET);
    expect(verifyProviderSignature({ method: "POST", path: "/provider/bet", timestamp: ts, rawBody: `{"a":2}`, signature: sig, secret: SECRET })).toBe(false);
    expect(verifyProviderSignature({ method: "POST", path: "/provider/bet", timestamp: ts, rawBody: `{"a":1}`, signature: sig, secret: "other-secret" })).toBe(false);
    expect(verifyProviderSignature({ method: "POST", path: "/provider/bet", timestamp: ts - 3600, rawBody: `{"a":1}`, signature: sig, secret: SECRET })).toBe(false);
  });
});

describe("provider endpoints over HTTP", () => {
  it("rejects unsigned calls with 401", async () => {
    const res = await app.inject({ method: "POST", url: "/provider/wallet/balance", payload: { sessionId } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a bad signature with 401 and logs an api error", async () => {
    const res = await app.inject({
      method: "POST", url: "/provider/bet",
      headers: { "content-type": "application/json", "X-Api-Key": API_KEY, "X-Timestamp": String(Math.floor(Date.now() / 1000)), "X-Signature": "nope" },
      payload: { sessionId, roundId, amount: 10, txId: "x" },
    });
    expect(res.statusCode).toBe(401);
    expect(await prisma.apiErrorLog.count({ where: { route: { contains: "/provider" } } })).toBeGreaterThan(0);
  });

  it("bet → win → webhook settle → replay-safe", async () => {
    const txId = crypto.randomUUID();
    const bet = await app.inject({
      method: "POST", url: "/provider/bet",
      headers: signedHeaders("/provider/bet", { sessionId, roundId, amount: 100, txId }),
      payload: { sessionId, roundId, amount: 100, txId },
    });
    expect(bet.statusCode).toBe(200);
    expect(bet.json().data.balance).toBe(4900);

    const dup = await app.inject({
      method: "POST", url: "/provider/bet",
      headers: signedHeaders("/provider/bet", { sessionId, roundId, amount: 100, txId }),
      payload: { sessionId, roundId, amount: 100, txId },
    });
    expect(dup.json().data.replayed).toBe(true);
    expect(dup.json().data.balance).toBe(4900);

    const win = await app.inject({
      method: "POST", url: "/provider/win",
      headers: signedHeaders("/provider/win", { sessionId, roundId, amount: 250, txId, payoutMultiplier: 2.5 }),
      payload: { sessionId, roundId, amount: 250, txId, payoutMultiplier: 2.5 },
    });
    expect(win.statusCode).toBe(200);
    expect(win.json().data.balance).toBe(5150);

    const hook = await app.inject({
      method: "POST", url: "/provider/webhook/round",
      headers: signedHeaders("/provider/webhook/round", { roundId, sessionId, status: "settled", bets: [{ txId, amount: 100, outcome: "won" }], ts: Math.floor(Date.now() / 1000) }),
      payload: { roundId, sessionId, status: "settled", bets: [{ txId, amount: 100, outcome: "won" }], ts: Math.floor(Date.now() / 1000) },
    });
    expect(hook.statusCode).toBe(200);
    expect(hook.json().data.duplicate).toBe(false);

    const replay = await app.inject({
      method: "POST", url: "/provider/webhook/round",
      headers: signedHeaders("/provider/webhook/round", { roundId, sessionId, status: "settled", bets: [], ts: Math.floor(Date.now() / 1000) }),
      payload: { roundId, sessionId, status: "settled", bets: [], ts: Math.floor(Date.now() / 1000) },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.duplicate).toBe(true);

    const betRow = await prisma.bet.findUniqueOrThrow({ where: { providerTxId: txId } });
    expect(betRow.status).toBe("won");
    expect(betRow.payout).toBe(250);
  });
});
