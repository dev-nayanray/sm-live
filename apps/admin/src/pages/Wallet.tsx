import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, downloadCsv } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Input, Loading, Stat } from "../components/ui";

interface LedgerRow { id: string; userId: number; kind: string; amount: number; balanceAfter: number; txKey: string; createdAt: string }
interface RechargeRow { id: number; userId: number; amount: number; provider: string; status: string; user: { displayName: string }; createdAt: string }
interface RtpRow { id: number; gameId: number; totalBet: number; totalPayout: number; rtp: number; windowEnd: string; game: { code: string } }

const KINDS = ["", "recharge", "bet_debit", "bet_refund", "win_credit", "gift_debit", "gift_credit", "agency_commission", "admin_adjust", "refund"];

export function Wallet() {
  const [tab, setTab] = useState<"overview" | "ledger" | "recharges" | "rtp">("overview");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Wallet</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["overview", "Balances & integrity"], ["ledger", "Ledger explorer"], ["recharges", "Recharges & refunds"], ["rtp", "RTP view"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "ledger" && <LedgerTab />}
      {tab === "recharges" && <RechargesTab />}
      {tab === "rtp" && <RtpTab />}
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading } = useQuery({ queryKey: ["wallet-integrity"], queryFn: () => api<{ ok: boolean; mismatches: { userId: number; ledgerSum: number; walletBalance: number }[] }>("/v1/admin/wallet/integrity") });
  if (isLoading) return <Loading />;
  const ok = data?.ok ?? false;
  return (
    <div>
      <div className="grid md:grid-cols-2 gap-4">
        <Stat label="Ledger integrity" value={ok ? "OK ✔" : "MISMATCH ✘"} tone={ok ? "text-emerald-600" : "text-rose-600"} />
        <Stat label="Mismatched wallets" value={data?.mismatches.length ?? 0} tone={(data?.mismatches.length ?? 0) === 0 ? "text-emerald-600" : "text-rose-600"} />
      </div>
      <Card title="Invariant">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every coin movement flows through one ledger service: immutable rows, unique <code>txKey</code> idempotency,
          row-locked wallets, no negative balances, and <code>balanceAfter</code> stored per row.
          This check asserts <code>SUM(LedgerEntry.amount) == Wallet.balance</code> for every user.
        </p>
        {!ok && (
          <table className="w-full text-sm mt-3">
            <tbody>{data?.mismatches.map((m) => (
              <tr key={m.userId}><td>user {m.userId}</td><td>ledger {m.ledgerSum}</td><td>wallet {m.walletBalance}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function LedgerTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [kind, setKind] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["ledger", page, search, kind],
    queryFn: () => api<{ total: number; items: LedgerRow[] }>(`/v1/admin/wallet/ledger?page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ""}${kind ? `&kind=${kind}` : ""}`),
  });
  const items = data?.items ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));
  return (
    <Card title={`Ledger explorer (${data?.total ?? 0})`} actions={
      <Button variant="ghost" onClick={() => downloadCsv("ledger.csv", items as unknown as Record<string, unknown>[])}>Export CSV</Button>
    }>
      <form className="flex gap-2 mb-3 flex-wrap" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput); }}>
        <Input placeholder="user id or txKey" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="!w-52" />
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm">
          {KINDS.map((k) => <option key={k} value={k}>{k || "all kinds"}</option>)}
        </select>
        <Button variant="subtle">Filter</Button>
      </form>
      {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no entries" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">#</th><th>User</th><th>Kind</th><th>Amount</th><th>After</th><th>txKey</th><th>Time</th>
            </tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 text-slate-400">{e.id}</td>
                  <td>{e.userId}</td>
                  <td><Badge tone="slate">{e.kind}</Badge></td>
                  <td className={e.amount >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>{e.amount >= 0 ? "+" : ""}{e.amount.toLocaleString()}</td>
                  <td className="font-semibold">{e.balanceAfter.toLocaleString()}</td>
                  <td className="font-mono text-xs text-slate-400">{e.txKey}</td>
                  <td className="text-slate-400">{e.createdAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-between items-center mt-3 text-sm">
        <span className="text-slate-400">page {page} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>
    </Card>
  );
}

function RechargesTab() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["recharges", page],
    queryFn: () => api<{ total: number; items: RechargeRow[] }>(`/v1/admin/wallet/recharges?page=${page}&pageSize=20`),
  });
  const items = data?.items ?? [];
  return (
    <Card title={`Recharges (${data?.total ?? 0})`}>
      {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no recharges" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2">User</th><th>Amount</th><th>Provider</th><th>Status</th><th>Time</th><th />
          </tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2">{r.user?.displayName}</td>
                <td className="font-semibold">{r.amount.toLocaleString()}</td>
                <td>{r.provider}</td>
                <td><Badge tone={r.status === "succeeded" ? "green" : r.status === "refunded" ? "slate" : "amber"}>{r.status}</Badge></td>
                <td className="text-slate-400">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
                <td className="text-right">
                  {can("wallet.write") && r.status === "succeeded" && (
                    <Button variant="ghost" onClick={() => void api("/v1/admin/wallet/refund", { method: "POST", json: { rechargeId: r.id, reason: "admin refund" } }).then(() => refetch())}>Refund</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex justify-between items-center mt-3 text-sm">
        <span className="text-slate-400">page {page}</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button variant="ghost" onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>
    </Card>
  );
}

function RtpTab() {
  const { data, isLoading } = useQuery({ queryKey: ["rtp"], queryFn: () => api<RtpRow[]>("/v1/admin/wallet/rtp") });
  if (isLoading) return <Loading />;
  const rows = data ?? [];
  return (
    <Card title="RTP snapshots (hourly, realized return)">
      {rows.length === 0 ? <Empty text="no snapshots yet — hourly job or a test:flow run populates them" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2">Game</th><th>Bet volume</th><th>Payouts</th><th>RTP</th><th>Window end</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2">{r.game.code}</td>
                <td>{r.totalBet.toLocaleString()}</td>
                <td>{r.totalPayout.toLocaleString()}</td>
                <td><Badge tone={r.rtp > 1 ? "red" : r.rtp > 0.9 ? "amber" : "green"}>{(r.rtp * 100).toFixed(1)}%</Badge></td>
                <td className="text-slate-400">{r.windowEnd.slice(0, 19).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
