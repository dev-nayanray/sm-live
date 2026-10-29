import Fastify from "fastify";
import crypto from "node:crypto";
import { createProviderClient } from "./client.js";
import { gamePage } from "./page.js";

const env = {
  PORT: Number(process.env.PORT ?? 4100),
  API_BASE: process.env.API_BASE ?? "http://localhost:4000",
  MOCK_API_KEY: process.env.MOCK_API_KEY ?? "mockcorp-key-1",
  MOCK_API_SECRET: process.env.MOCK_API_SECRET ?? "mockcorp-secret-please-rotate",
  DEFAULT_RTP: Number(process.env.DEFAULT_RTP ?? 0.97),
};

const client = createProviderClient({ apiBase: env.API_BASE, apiKey: env.MOCK_API_KEY, apiSecret: env.MOCK_API_SECRET });

/** deterministic RNG per round (mulberry32 seeded by roundId hash) */
function rngFor(roundId: string) {
  let h = 1779033703 ^ roundId.length;
  for (let i = 0; i < roundId.length; i++) {
    h = Math.imul(h ^ roundId.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface LaunchSession {
  sessionKey: string;
  userId: number;
  gameCode: string;
  rtp: number;
  roundId: string | null;
  openBets: { txId: string; amount: number }[];
}
const sessions = new Map<string, LaunchSession>();

const app = Fastify({ logger: { level: "info" } });

app.get("/health", async () => ({ ok: true, service: "provider-mock", time: new Date().toISOString() }));

/** The launch endpoint the platform links to. */
app.get("/launch", async (req, reply) => {
  const q = req.query as Record<string, string>;
  const { session, user, ts, sig } = q;
  if (!session || !user || !ts || !sig) return reply.status(400).send({ ok: false, error: "missing launch params" });
  const expect = crypto.createHmac("sha256", env.MOCK_API_SECRET).update(`${session}|${user}|${ts}`).digest("hex");
  if (expect !== sig) return reply.status(401).send({ ok: false, error: "bad launch signature" });
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return reply.status(401).send({ ok: false, error: "launch signature expired" });

  const gameCode = (q.game as string | undefined) ?? "crash-x";
  const existing = sessions.get(session);
  const qRtp = q.rtp !== undefined ? Number(q.rtp) : NaN;
  const rtp = existing?.rtp ?? (Number.isNaN(qRtp) ? env.DEFAULT_RTP : qRtp);
  sessions.set(session, { sessionKey: session, userId: Number(user), gameCode, rtp, roundId: existing?.roundId ?? null, openBets: existing?.openBets ?? [] });
  return reply.type("text/html").send(gamePage({ session, user: Number(user), gameCode, rtp }));
});

// --- JSON API used by the game page buttons -------------------------------
app.get("/api/state/:session", async (req, reply) => {
  const { session } = req.params as { session: string };
  const s = sessions.get(session);
  if (!s) return reply.status(404).send({ ok: false, error: "unknown session" });
  const bal = await client.balance(session);
  return { ok: true, data: { roundId: s.roundId, openBets: s.openBets, rtp: s.rtp, balance: bal.body.data?.balance ?? null } };
});

app.post("/api/bet", async (req, reply) => {
  const { session, amount, roundId } = req.body as { session: string; amount: number; roundId?: string };
  const s = sessions.get(session);
  if (!s) return reply.status(404).send({ ok: false, error: "unknown session" });
  const rid = roundId ?? s.roundId ?? nextRoundId();
  s.roundId = rid;
  const txId = crypto.randomUUID();
  const res = await client.bet({ sessionId: session, roundId: rid, amount, txId });
  if (res.status === 200 && res.body.ok) s.openBets.push({ txId, amount });
  return res.body;
});

app.post("/api/win", async (req, reply) => {
  const { session, txId, multiplier } = req.body as { session: string; txId?: string; multiplier?: number };
  const s = sessions.get(session);
  if (!s || !s.roundId) return reply.status(400).send({ ok: false, error: "no active round" });
  const bet = txId ? s.openBets.find((b) => b.txId === txId) : s.openBets[0];
  if (!bet) return reply.status(400).send({ ok: false, error: "no open bet" });
  const winTxId = crypto.randomUUID();
  const amount = Math.floor(bet.amount * (multiplier ?? 2));
  const res = await client.win({ sessionId: session, roundId: s.roundId, amount, txId: bet.txId, payoutMultiplier: multiplier ?? 2 });
  s.openBets = s.openBets.filter((b) => b.txId !== bet.txId);
  return { ...res.body, winTxId, amount };
});

app.post("/api/cancel", async (req, reply) => {
  const { session, txId } = req.body as { session: string; txId?: string };
  const s = sessions.get(session);
  if (!s || !s.roundId) return reply.status(400).send({ ok: false, error: "no active round" });
  const bet = txId ? s.openBets.find((b) => b.txId === txId) : s.openBets[0];
  if (!bet) return reply.status(400).send({ ok: false, error: "no open bet" });
  const res = await client.cancel({ sessionId: session, roundId: s.roundId, txId: bet.txId });
  s.openBets = s.openBets.filter((b) => b.txId !== bet.txId);
  return res.body;
});

/** Replay the exact same signed bet call — the platform must dedupe it. */
app.post("/api/duplicate", async (req, reply) => {
  const { session } = req.body as { session: string };
  const s = sessions.get(session);
  if (!s || !s.roundId || s.openBets.length === 0) return reply.status(400).send({ ok: false, error: "no open bet to duplicate" });
  const bet = s.openBets[0]!;
  const res = await client.bet({ sessionId: session, roundId: s.roundId, amount: bet.amount, txId: bet.txId });
  return { ...res.body, note: "duplicate call — platform must return replayed:true with same balance" };
});

/** Simulate a network drop mid-call (client aborts). */
app.post("/api/drop", async (req, reply) => {
  const { session } = req.body as { session: string };
  const s = sessions.get(session);
  if (!s || !s.roundId) return reply.status(400).send({ ok: false, error: "no active round" });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 5);
  try {
    await fetch(`${env.API_BASE}/provider/bet`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Api-Key": env.MOCK_API_KEY, "X-Timestamp": String(Math.floor(Date.now() / 1000)), "X-Signature": "deadbeef" },
      body: JSON.stringify({ sessionId: session, roundId: s.roundId, amount: 10, txId: crypto.randomUUID() }),
      signal: ac.signal,
    });
  } catch {
    /* dropped as intended */
  }
  return { ok: true, note: "call dropped mid-flight; verify recovery via session state" };
});

/** Resolve the round: seeded RNG decides win/loss targeting configured RTP. */
app.post("/api/resolve", async (req, reply) => {
  const { session } = req.body as { session: string };
  const s = sessions.get(session);
  if (!s || !s.roundId) return reply.status(400).send({ ok: false, error: "no active round" });
  const rng = rngFor(s.roundId + ":" + s.openBets.map((b) => b.txId).join(","));
  const results: { txId: string; amount: number; outcome: string }[] = [];
  for (const bet of s.openBets) {
    const win = rng() < s.rtp;
    if (win) {
      const amount = Math.floor(bet.amount * 2);
      await client.win({ sessionId: session, roundId: s.roundId!, amount, txId: bet.txId, payoutMultiplier: 2 });
      results.push({ txId: bet.txId, amount: bet.amount, outcome: "won" });
    } else {
      results.push({ txId: bet.txId, amount: bet.amount, outcome: "lost" });
    }
  }
  await client.roundWebhook({
    roundId: s.roundId,
    sessionId: session,
    status: "settled",
    bets: results.map((r) => ({ txId: r.txId, amount: r.amount, outcome: r.outcome })),
    ts: Math.floor(Date.now() / 1000),
  });
  s.openBets = [];
  s.roundId = null;
  return { ok: true, results };
});

function nextRoundId(): string {
  return `mock-r-${crypto.randomBytes(4).toString("hex")}`;
}

app.listen({ port: env.PORT, host: "0.0.0.0" }).then((addr) => {
  console.log(`provider-mock listening on ${addr} (api: ${env.API_BASE})`);
});
