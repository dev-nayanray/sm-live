/**
 * Load test: 200 concurrent wallet bets from one user (plus 50 duplicate
 * replays). Pass criteria: no double debit, no negative balance, ledger sums
 * equal wallet balances, exactly 200 unique bet rows.
 */
import crypto from "node:crypto";

const API = process.env.FLOW_API_BASE ?? "http://localhost:4001";
const PROVIDER_KEY = process.env.MOCK_API_KEY ?? "mockcorp-key-1";
const PROVIDER_SECRET = process.env.MOCK_API_SECRET ?? "mockcorp-secret-please-rotate";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, init);
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
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
  const N = 200;
  const BET = 100; // 200 * 100 = 20_000 out of 25_000 funded
  console.log(`load test: ${N} concurrent bets of ${BET} coins + 50 duplicate replays`);

  const phone = `+88018000${crypto.randomInt(10000, 99999)}`;
  const reg = await api("/v1/auth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password: "Load123!", displayName: "Load Tester" }),
  });
  const token = reg.json.data?.accessToken ?? reg.json.accessToken;
  await api("/v1/wallet/recharge", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount: 25_000, provider: "fake" }),
  });

  const launch = await api("/v1/games/crash-x/launch", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const sessionId = launch.json.data.sessionId;
  const roundId = `load-${crypto.randomBytes(4).toString("hex")}`;

  // large betting window so all bets land inside it
  // (seeded config: 30s betting window, 1..10000 range)

  const txIds = Array.from({ length: N }, () => crypto.randomUUID());

  const t0 = Date.now();
  const fire = (txId: string) => providerCall("/provider/bet", { sessionId, roundId, amount: BET, txId });
  const results = await Promise.all([
    ...txIds.map(fire),
    // 50 duplicate replays mixed into the same instant
    ...txIds.slice(0, 50).map(fire),
  ]);
  const elapsed = Date.now() - t0;

  const ok200 = results.filter((r) => r.status === 200).length;
  const replays = results.filter((r) => r.json?.data?.replayed === true).length;
  console.log(`  ${ok200}/250 calls succeeded in ${elapsed}ms (${replays} replays)`);

  const bal = await providerCall("/provider/wallet/balance", { sessionId });
  const balance = bal.json.data.balance as number;
  const expectBalance = 25_000 - N * BET;
  console.log(`  final balance ${balance} (expected ${expectBalance})`);

  // admin-side assertions
  const alogin = await api("/v1/admin/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "superadmin", password: process.env.SUPER_ADMIN_PASSWORD ?? "SuperAdmin123!" }),
  });
  const adminToken = alogin.json.data.accessToken;
  const integrity = await api("/v1/admin/wallet/integrity", { headers: { authorization: `Bearer ${adminToken}` } });
  let betEntries = 0;
  for (let page = 1; page <= 3; page++) {
    const history = await api(`/v1/wallet/history?page=${page}&pageSize=200`, { headers: { authorization: `Bearer ${token}` } });
    const items = (history.json?.data?.items ?? []) as { kind: string }[];
    betEntries += items.filter((i) => i.kind === "bet_debit").length;
    if (items.length < 200) break;
  }
  console.log(`  unique bet_debit ledger rows: ${betEntries} (expected ${N})`);
  console.log(`  ledger integrity: ${integrity.json.data.ok ? "OK" : "MISMATCH " + JSON.stringify(integrity.json.data.mismatches.slice(0, 3))}`);

  // negative-balance probe: within bet limits but above the 5000 balance
  const negative = await providerCall("/provider/bet", { sessionId, roundId, amount: 9_000, txId: crypto.randomUUID() });
  const negOk = negative.status === 422 || ["insufficient_funds", "bad_request"].includes(negative.json?.error?.code);
  console.log(`  over-balance bet rejected: ${negOk ? "OK" : "FAIL " + JSON.stringify(negative.json)}`);

  const pass =
    ok200 === 250 &&
    replays === 50 &&
    balance === expectBalance &&
    balance >= 0 &&
    integrity.json.data.ok === true &&
    betEntries === N &&
    negOk;
  console.log(pass ? "\nload test PASSED ✔" : "\nload test FAILED ✘");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("load crashed:", e);
  process.exit(1);
});
