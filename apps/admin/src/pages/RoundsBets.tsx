import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadCsv } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Confirm, Empty, Input, Loading } from "../components/ui";

interface Round { id: number; roundId: string; status: string; startedAt: string; endedAt: string | null; settleSource: string; game: { code: string }; bets: { id: number; amount: number; status: string; user: { displayName: string } }[] }
interface Bet { id: number; roundId: number; amount: number; status: string; payout: number; providerTxId: string; createdAt: string; user: { displayName: string }; game: { code: string } }

export function RoundsBets() {
  const [tab, setTab] = useState<"rounds" | "bets">("rounds");
  const qc = useQueryClient();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [forceTarget, setForceTarget] = useState<Round | null>(null);
  const [forceAction, setForceAction] = useState<"settle" | "cancel" | "restart">("settle");

  const key = tab === "rounds" ? "admin-rounds" : "admin-bets";
  const { data, isLoading } = useQuery({
    queryKey: [key, page, search],
    queryFn: () => api<{ total: number; items: (Round | Bet)[] }>(`/v1/admin/${tab}?page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: [key] });
  const recover = async () => {
    const res = await api<{ scanned: number; refunded: number; settled: number }>("/v1/admin/rounds/recover-stuck", { method: "POST" });
    alert(`recovery scan: ${res.scanned} stale rounds — refunded ${res.refunded}, settled ${res.settled}`);
    invalidate();
  };

  const items = data?.items ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Rounds &amp; Bets</h1>
        {can("rounds.write") && <Button variant="subtle" onClick={recover}>Run stuck-round recovery now</Button>}
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant={tab === "rounds" ? "primary" : "ghost"} onClick={() => { setTab("rounds"); setPage(1); }}>Rounds</Button>
        <Button variant={tab === "bets" ? "primary" : "ghost"} onClick={() => { setTab("bets"); setPage(1); }}>Bets</Button>
      </div>

      <Card actions={
        <div className="flex gap-2">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput); }}>
            <Input placeholder="round / tx id" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="!w-48" />
            <Button variant="subtle">Search</Button>
          </form>
          <Button variant="ghost" onClick={() => downloadCsv(`${tab}.csv`, items as unknown as Record<string, unknown>[])}>Export CSV</Button>
        </div>
      } title={tab === "rounds" ? `Rounds (${data?.total ?? 0})` : `Bets (${data?.total ?? 0})`}>
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="nothing yet" /> : tab === "rounds" ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">Round</th><th>Game</th><th>Status</th><th>Bets</th><th>Started</th><th>Source</th><th />
            </tr></thead>
            <tbody>
              {(items as Round[]).map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{r.roundId}</td>
                  <td>{r.game.code}</td>
                  <td><Badge tone={r.status === "open" ? "amber" : r.status === "settled" ? "green" : "slate"}>{r.status}</Badge></td>
                  <td>{r.bets.length} · {r.bets.reduce((s, b) => s + b.amount, 0).toLocaleString()}</td>
                  <td className="text-slate-400">{r.startedAt.slice(0, 19).replace("T", " ")}</td>
                  <td className="text-slate-400 text-xs">{r.settleSource}</td>
                  <td className="text-right">
                    {can("rounds.write") && r.status === "open" && <>
                      <Button variant="ghost" onClick={() => { setForceTarget(r); setForceAction("settle"); }}>Settle</Button>{" "}
                      <Button variant="ghost" onClick={() => { setForceTarget(r); setForceAction("cancel"); }}>Cancel+refund</Button>
                    </>}
                    {can("rounds.write") && r.status !== "open" && (
                      <Button variant="ghost" onClick={() => { setForceTarget(r); setForceAction("restart"); }}>Restart</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">User</th><th>Game</th><th>Amount</th><th>Status</th><th>Payout</th><th>Tx</th><th>Placed</th><th />
            </tr></thead>
            <tbody>
              {(items as Bet[]).map((b) => (
                <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2">{b.user.displayName}</td>
                  <td>{b.game.code}</td>
                  <td className="font-semibold">{b.amount.toLocaleString()}</td>
                  <td><Badge tone={b.status === "won" ? "green" : b.status === "lost" ? "red" : b.status === "placed" ? "amber" : "slate"}>{b.status}</Badge></td>
                  <td>{b.payout > 0 ? b.payout.toLocaleString() : "—"}</td>
                  <td className="font-mono text-xs text-slate-400">{b.providerTxId.slice(0, 8)}…</td>
                  <td className="text-slate-400">{b.createdAt.slice(0, 19).replace("T", " ")}</td>
                  <td className="text-right">
                    {can("rounds.write") && b.status === "placed" && (
                      <Button variant="ghost" onClick={() => void api(`/v1/admin/bets/${b.id}/cancel`, { method: "POST" }).then(invalidate)}>Cancel</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex justify-between items-center mt-3 text-sm">
          <span className="text-slate-400">page {page} / {pages}</span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
            <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
          </div>
        </div>
      </Card>

      <Confirm
        open={!!forceTarget}
        text={forceAction === "restart"
          ? `Restart round ${forceTarget?.roundId}? It reopens for betting (bets keep final states).`
          : forceAction === "cancel"
            ? `Cancel round ${forceTarget?.roundId} and refund all placed bets through the ledger?`
            : `Force-settle round ${forceTarget?.roundId}? Placed bets will be marked lost.`}
        onCancel={() => setForceTarget(null)}
        onConfirm={async () => {
          await api(`/v1/admin/rounds/${forceTarget!.id}/force`, { method: "POST", json: { action: forceAction } });
          setForceTarget(null);
          invalidate();
        }}
      />
    </div>
  );
}
