/**
 * End-to-end flow check (run with the stack up):
 * register → recharge → launch game → bet → win → cancel/refund a bet →
 * duplicate replay → webhook settle → assert final balance & ledger integrity.
 */
import crypto from "node:crypto";

const API = process.env.FLOW_API_BASE ?? "http://localhost:4001";
const PROVIDER_KEY = process.env.MOCK_API_KEY ?? "mockcorp-key-1";
const PROVIDER_SECRET = process.env.MOCK_API_SECRET ?? "mockcorp-secret-please-rotate";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures++;
    console.error(`  ✘ ${name}`, detail ?? "");
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, json };
}

async function userCall(path: string, token: string, body?: unknown) {
  return api(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function providerCall(path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const bodyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const sig = crypto.createHmac("sha256", PROVIDER_SECRET).update(`POST|${path}|${ts}|${bodyHash}`).digest("hex");
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Api-Key": PROVIDER_KEY, "X-Timestamp": String(ts), "X-Signature": sig },
    body: raw,
  });
}

async function main() {
  console.log(`test:flow against ${API}`);

  // 1. register a fresh user
  const phone = `+88019000${crypto.randomInt(10000, 99999)}`;
  const reg = await api("/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password: "Flow123!", displayName: "Flow Tester", market: "default" }),
  });
  check("register returns tokens", reg.status === 200 && !!(reg.json?.data?.accessToken ?? reg.json?.accessToken), reg.json);
  const token = (reg.json.data?.accessToken ?? reg.json.accessToken) as string;

  // 2. recharge 5000
  const recharge = await userCall("/v1/wallet/recharge", token, { amount: 5000, provider: "fake" });
  check("recharge 5000 succeeds", recharge.status === 200 && recharge.json?.data?.balance === 5000, recharge.json);

  // 3. launch a game
  const launch = await userCall("/v1/games/crash-x/launch", token, {});
  check("launch returns signed url + session", launch.status === 200 && typeof launch.json?.data?.sessionId === "string", launch.json);
  const sessionId = launch.json.data.sessionId as string;
  const launchUrl = new URL(launch.json.data.url as string);
  const sigParam = launchUrl.searchParams.get("sig");
  const expectSig = crypto.createHmac("sha256", PROVIDER_SECRET)
    .update(`${launchUrl.searchParams.get("session")}|${launchUrl.searchParams.get("user")}|${launchUrl.searchParams.get("ts")}`)
    .digest("hex");
  check("launch url signature valid", sigParam === expectSig);

  // 4. provider balance check
  const bal0 = await providerCall("/provider/wallet/balance", { sessionId });
  check("provider sees balance 5000", bal0.json?.data?.balance === 5000, bal0.json);

  // 5. bet 1000 on round flow-r1
  const roundId = `flow-r-${crypto.randomBytes(3).toString("hex")}`;
  const betTx = crypto.randomUUID();
  const bet = await providerCall("/provider/bet", { sessionId, roundId, amount: 1000, txId: betTx });
  check("bet debits 1000 → balance 4000", bet.json?.data?.balance === 4000, bet.json);

  // 6. duplicate bet (same txId) must replay, not double-debit
  const dup = await providerCall("/provider/bet", { sessionId, roundId, amount: 1000, txId: betTx });
  check("duplicate bet replays (replayed:true)", dup.json?.data?.replayed === true, dup.json);
  const bal1 = await providerCall("/provider/wallet/balance", { sessionId });
  check("balance still 4000 after duplicate", bal1.json?.data?.balance === 4000);

  // 7. win 2500 on that bet
  const win = await providerCall("/provider/win", { sessionId, roundId, amount: 2500, txId: betTx, payoutMultiplier: 2.5 });
  check("win credits 2500 → balance 6500", win.json?.data?.balance === 6500, win.json);

  // 8. second bet then refund it
  const betTx2 = crypto.randomUUID();
  const bet2 = await providerCall("/provider/bet", { sessionId, roundId, amount: 500, txId: betTx2 });
  check("second bet → balance 6000", bet2.json?.data?.balance === 6000, bet2.json);
  const refund = await providerCall("/provider/refund", { sessionId, roundId, txId: betTx2 });
  check("refund returns 6500", refund.json?.data?.balance === 6500, refund.json);

  // 9. settle round via webhook — retry-safe
  const hook = await providerCall("/provider/webhook/round", {
    roundId, sessionId, status: "settled",
    bets: [
      { txId: betTx, amount: 1000, outcome: "won" },
      { txId: betTx2, amount: 500, outcome: "refunded" },
    ],
    ts: Math.floor(Date.now() / 1000),
  });
  check("webhook settles round", hook.json?.ok === true, hook.json);
  const hook2 = await providerCall("/provider/webhook/round", {
    roundId, sessionId, status: "settled", bets: [], ts: Math.floor(Date.now() / 1000),
  });
  check("webhook replay is duplicate-safe", hook2.json?.data?.duplicate === true, hook2.json);

  // 10. session state (reconnect support)
  const state = await userCall(`/v1/games/session/${sessionId}/state`, token);
  check("session state has balance 6500 and no pending bets", state.json?.data?.balance === 6500 && state.json?.data?.pendingBets.length === 0, state.json?.data);

  // 11. wallet history / ledger assertions
  const history = await userCall("/v1/wallet/history?page=1&pageSize=50", token);
  const items = history.json?.data?.items as { kind: string; amount: number; balanceAfter: number }[];
  check("ledger has 5 entries (recharge, bet, win, bet, refund)", items?.length === 5, items);
  const sum = items.reduce((s, i) => s + i.amount, 0);
  check("ledger sums to final balance 6500", sum === 6500, sum);
  const newestAfter = items?.[0]?.balanceAfter;
  check("balanceAfter on newest row equals 6500", newestAfter === 6500, newestAfter);

  // 12. admin integrity check
  const alogin = await api("/v1/admin/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "superadmin", password: process.env.SUPER_ADMIN_PASSWORD ?? "SuperAdmin123!" }),
  });
  const adminToken = alogin.json?.data?.accessToken as string;
  const integrity = await api("/v1/admin/wallet/integrity", { headers: { authorization: `Bearer ${adminToken}` } });
  check("ledger integrity ok (sums == wallet balances)", integrity.json?.data?.ok === true, integrity.json?.data);

  console.log(failures === 0 ? "\ntest:flow PASSED ✔" : `\ntest:flow FAILED (${failures} checks) ✘`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("flow crashed:", e);
  process.exit(1);
});
