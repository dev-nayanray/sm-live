/** The fake game page: buttons for bet / win / cancel / duplicate / drop / resolve. */
export function gamePage(args: { session: string; user: number; gameCode: string; rtp: number }): string {
  const { session, user, gameCode, rtp } = args;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(gameCode)} — MockCorp</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; display: grid; place-items: center; min-height: 100vh; }
  .card { background: #1e293b; padding: 24px 28px; border-radius: 14px; width: 380px; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #94a3b8; font-size: 12px; margin-bottom: 16px; }
  .row { display: flex; gap: 8px; margin-bottom: 8px; }
  button { flex: 1; padding: 10px; border: 0; border-radius: 8px; background: #7c3aed; color: white; font-weight: 600; cursor: pointer; }
  button.alt { background: #334155; }
  button:active { transform: scale(.98); }
  input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; margin-bottom: 12px; }
  #balance { font-size: 22px; font-weight: 700; color: #34d399; margin: 8px 0 16px; }
  #log { font-family: ui-monospace, monospace; font-size: 11px; background: #0f172a; border-radius: 8px; padding: 10px; height: 150px; overflow: auto; white-space: pre-wrap; }
</style>
</head>
<body>
<div class="card">
  <h1>🎯 ${escapeHtml(gameCode)}</h1>
  <div class="muted">MockCorp Games · session ${escapeHtml(session.slice(0, 12))}… · RTP ${(rtp * 100).toFixed(0)}% · user #${user}</div>
  <div>Balance: <span id="balance">…</span> 🪙</div>
  <input id="amount" type="number" value="100" min="1" />
  <div class="row">
    <button onclick="bet()">Place Bet</button>
    <button class="alt" onclick="win()">Win</button>
  </div>
  <div class="row">
    <button class="alt" onclick="cancel()">Cancel</button>
    <button class="alt" onclick="resolve()">Resolve (RNG)</button>
  </div>
  <div class="row">
    <button class="alt" onclick="duplicate()">Duplicate call</button>
    <button class="alt" onclick="drop()">Network drop</button>
  </div>
  <div id="log"></div>
</div>
<script>
const session = ${JSON.stringify(session)};
const log = (m) => { document.getElementById("log").textContent += m + "\\n"; };
async function post(path, body = {}) {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session, ...body }) });
    const json = await res.json();
    log(path + " → " + JSON.stringify(json));
    return json;
  } catch (e) { log(path + " ✗ " + e.message); }
}
async function refresh() {
  const res = await fetch("/api/state/" + session).then((r) => r.json());
  if (res.ok) document.getElementById("balance").textContent = res.data.balance ?? "—";
}
async function bet() { await post("/api/bet", { amount: Number(document.getElementById("amount").value) }); refresh(); }
async function win() { await post("/api/win"); refresh(); }
async function cancel() { await post("/api/cancel"); refresh(); }
async function duplicate() { await post("/api/duplicate"); refresh(); }
async function drop() { await post("/api/drop"); refresh(); }
async function resolve() { await post("/api/resolve"); refresh(); }
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
