/**
 * SM Live — Wallet & Financial Transaction Management (Prompt 07).
 *
 * Replaces the existing Wallet.tsx with a comprehensive multi-tab dashboard:
 *   1. Overview        — summary KPIs with date filter
 *   2. Wallets          — player wallet list with frozen/balance filters
 *   3. Transactions     — filtered ledger with kind/user/date/amount filters + CSV export
 *   4. Recharges        — recharge records with status filter
 *   5. Refunds         — refund records with admin + recharge context
 *   6. Withdrawals     — agency withdrawal requests
 *   7. Reconciliation  — ledger integrity + unmatched recharges + duplicates
 *
 * All data is READ-ONLY through these endpoints. Wallet mutations
 * (recharge, adjust, refund) go through the existing dedicated endpoints
 * that use the ledger service with idempotency + row locking.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE, getToken, downloadCsv } from "../api";
import { Badge, Button, Card, Empty, Input, Loading, Select, Stat } from "../components/ui";

const KINDS = ["", "recharge", "bet_debit", "bet_refund", "win_credit", "gift_debit", "gift_credit", "agency_commission", "admin_adjust", "refund"];

interface Summary {
  currency: string; totalWallets: number; totalBalance: number; frozenWallets: number;
  totalCredits: number; totalCreditCount: number; totalDebits: number; totalDebitCount: number;
  rechargeAmount: number; rechargeCount: number; refundAmount: number; refundCount: number;
  betDebitAmount: number; winCreditAmount: number; giftDebitAmount: number; giftCreditAmount: number;
  adminAdjustAmount: number; pendingRecharges: number; failedRecharges: number;
  pendingWithdrawals: number; approvedWithdrawals: number; netGamingMargin: number; note: string;
}

export function Wallet() {
  const [tab, setTab] = useState<"overview" | "wallets" | "transactions" | "recharges" | "refunds" | "withdrawals" | "reconciliation">("overview");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Wallet &amp; Finance</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          ["overview", "Overview"], ["wallets", "Player Wallets"], ["transactions", "Transactions"],
          ["recharges", "Recharges"], ["refunds", "Refunds"], ["withdrawals", "Withdrawals"], ["reconciliation", "Reconciliation"],
        ] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "wallets" && <WalletsTab />}
      {tab === "transactions" && <TransactionsTab />}
      {tab === "recharges" && <RechargesTab />}
      {tab === "refunds" && <RefundsTab />}
      {tab === "withdrawals" && <WithdrawalsTab />}
      {tab === "reconciliation" && <ReconciliationTab />}
    </div>
  );
}

// ----------------------------------------------------------------
// Overview — summary KPIs with date filter
// ----------------------------------------------------------------
function OverviewTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  const qs = new URLSearchParams();
  if (appliedFrom) qs.set("from", appliedFrom);
  if (appliedTo) qs.set("to", appliedTo);

  const { data, isLoading } = useQuery({
    queryKey: ["wallet-summary", qs.toString()],
    queryFn: () => api<Summary>(`/v1/admin/wallet/summary?${qs.toString()}`),
  });

  if (isLoading) return <Loading />;
  const d = data!;

  return (
    <div className="space-y-4">
      <Card title="Date filter">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setAppliedFrom(from); setAppliedTo(to); }}>
          <label className="text-xs text-slate-500 dark:text-slate-400">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-36 ml-1" /></label>
          <label className="text-xs text-slate-500 dark:text-slate-400">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-36 ml-1" /></label>
          <Button variant="subtle" type="submit">Apply</Button>
          <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); setAppliedFrom(""); setAppliedTo(""); }}>Clear</Button>
        </form>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Stat label="Total wallets" value={d.totalWallets.toLocaleString()} />
        <Stat label="Total balance" value={`${d.totalBalance.toLocaleString()} ${d.currency}`} tone="text-violet-600 dark:text-violet-400" />
        <Stat label="Frozen wallets" value={d.frozenWallets} tone={d.frozenWallets > 0 ? "text-amber-600" : undefined} />
        <Stat label="Net gaming margin" value={`${d.netGamingMargin.toLocaleString()} ${d.currency}`} tone={d.netGamingMargin >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <Stat label="Recharges" value={`${d.rechargeAmount.toLocaleString()} (${d.rechargeCount})`} tone="text-emerald-600" />
        <Stat label="Refunds" value={`${d.refundAmount.toLocaleString()} (${d.refundCount})`} tone="text-rose-600" />
        <Stat label="Bet debits" value={`${d.betDebitAmount.toLocaleString()}`} />
        <Stat label="Win credits" value={`${d.winCreditAmount.toLocaleString()}`} />
        <Stat label="Gift debits" value={`${d.giftDebitAmount.toLocaleString()}`} />
        <Stat label="Gift credits" value={`${d.giftCreditAmount.toLocaleString()}`} />
        <Stat label="Admin adjustments" value={`${d.adminAdjustAmount.toLocaleString()}`} tone="text-amber-600" />
        <Stat label="Pending recharges" value={d.pendingRecharges} tone={d.pendingRecharges > 0 ? "text-amber-600" : undefined} />
      </div>
      <p className="text-xs text-slate-400">{d.note}</p>
      <p className="text-xs text-slate-400">
        Total credits: {d.totalCreditCount.toLocaleString()} entries ({d.totalCredits.toLocaleString()} {d.currency}) ·
        Total debits: {d.totalDebitCount.toLocaleString()} entries ({d.totalDebits.toLocaleString()} {d.currency})
      </p>
    </div>
  );
}

// ----------------------------------------------------------------
// Wallets — player wallet list
// ----------------------------------------------------------------
interface WalletRow { id: number; userId: number; displayName: string; phone: string | null; email: string | null; balance: number; frozen: boolean; status: string; updatedAt: string; userCreatedAt: string | null }

function WalletsTab() {
  const [search, setSearch] = useState("");
  const [frozen, setFrozen] = useState("");
  const [page, setPage] = useState(1);
  const qs = `page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ""}${frozen ? `&frozen=${frozen}` : ""}`;
  const { data, isLoading } = useQuery({ queryKey: ["wallets", qs], queryFn: () => api<{ total: number; items: WalletRow[] }>(`/v1/admin/wallet/wallets?${qs}`) });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  return (
    <Card title={`Player wallets (${total.toLocaleString()})`}>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
        <Input placeholder="search user ID" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-40" />
        <Select value={frozen} onChange={(e) => setFrozen(e.target.value)} className="!w-32">
          <option value="">All</option>
          <option value="true">Frozen</option>
          <option value="false">Active</option>
        </Select>
        <Button variant="subtle" type="submit">Apply</Button>
      </form>
      {items.length === 0 ? <Empty text="No wallets found." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">User</th><th>Balance</th><th>Status</th><th>Updated</th><th />
            </tr></thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2">
                    <Link to={`/users/${w.userId}`} className="font-medium text-violet-600 hover:underline dark:text-violet-300">{w.displayName}</Link>
                    <div className="text-xs text-slate-400">#{w.userId}</div>
                  </td>
                  <td className="font-semibold tabular-nums">{w.balance.toLocaleString()}</td>
                  <td><Badge tone={w.frozen ? "violet" : "green"}>{w.status}</Badge></td>
                  <td className="text-xs text-slate-400">{w.updatedAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} setPage={setPage} />
    </Card>
  );
}

// ----------------------------------------------------------------
// Transactions — filtered ledger with CSV export
// ----------------------------------------------------------------
interface LedgerRow { id: string; userId: number; kind: string; amount: number; balanceAfter: number; txKey: string; refType: string | null; refId: number | null; createdAt: string }

function TransactionsTab() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const qs = `page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ""}${kind ? `&kind=${kind}` : ""}`;
  const { data, isLoading } = useQuery({ queryKey: ["ledger-v2", qs], queryFn: () => api<{ total: number; items: LedgerRow[] }>(`/v1/admin/wallet/transactions?${qs}`) });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));

  const handleExport = () => {
    const url = `${API_BASE}/v1/admin/wallet/export?${kind ? `kind=${kind}` : ""}`;
    void fetch(url, { headers: { authorization: `Bearer ${getToken() ?? ""}` } })
      .then((r) => r.blob()).then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `ledger-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
        a.click(); URL.revokeObjectURL(a.href);
      });
  };

  return (
    <Card title={`Transactions (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={handleExport}>Export CSV</Button>}>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
        <Input placeholder="search user ID / txKey" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-48" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="!w-40">
          {KINDS.map((k) => <option key={k} value={k}>{k || "All kinds"}</option>)}
        </Select>
        <Button variant="subtle" type="submit">Apply</Button>
        <Button variant="ghost" onClick={() => { setSearch(""); setKind(""); setPage(1); }}>Clear</Button>
      </form>
      {isLoading ? <Loading /> : items.length === 0 ? <Empty text="No transactions found." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">User</th><th>Kind</th><th>Amount</th><th>After</th><th>txKey</th><th>Ref</th><th>Time</th>
            </tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Link to={`/users/${e.userId}`} className="text-violet-600 hover:underline dark:text-violet-300">#{e.userId}</Link></td>
                  <td><Badge tone={e.amount >= 0 ? "green" : "red"}>{e.kind}</Badge></td>
                  <td className={e.amount >= 0 ? "text-emerald-600 font-semibold tabular-nums" : "text-rose-600 font-semibold tabular-nums"}>{e.amount >= 0 ? "+" : ""}{e.amount.toLocaleString()}</td>
                  <td className="tabular-nums">{e.balanceAfter.toLocaleString()}</td>
                  <td className="font-mono text-xs text-slate-400 truncate max-w-[120px]">{e.txKey}</td>
                  <td className="text-xs text-slate-400">{e.refType ? `${e.refType}:${e.refId}` : "—"}</td>
                  <td className="text-xs text-slate-400">{e.createdAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={pages} setPage={setPage} />
    </Card>
  );
}

// ----------------------------------------------------------------
// Recharges
// ----------------------------------------------------------------
interface RechargeRow { id: number; userId: number; amount: number; provider: string; externalId: string; status: string; createdById: number | null; createdAt: string; user: { displayName: string } }

function RechargesTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["recharges-v2", page], queryFn: () => api<{ total: number; items: RechargeRow[] }>(`/v1/admin/wallet/recharges?page=${page}&pageSize=20`) });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  return (
    <Card title={`Recharges (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={() => downloadCsv("recharges.csv", items as unknown as Record<string, unknown>[])}>Export CSV</Button>}>
      {items.length === 0 ? <Empty text="No recharges." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">User</th><th>Amount</th><th>Provider</th><th>Status</th><th>Ext ID</th><th>Time</th>
            </tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Link to={`/users/${r.userId}`} className="text-violet-600 hover:underline dark:text-violet-300">{r.user?.displayName ?? "—"}</Link></td>
                  <td className="font-semibold tabular-nums">{r.amount.toLocaleString()}</td>
                  <td>{r.provider}</td>
                  <td><Badge tone={r.status === "succeeded" ? "green" : r.status === "refunded" ? "slate" : "amber"}>{r.status}</Badge></td>
                  <td className="font-mono text-xs text-slate-400 truncate max-w-[100px]">{r.externalId}</td>
                  <td className="text-xs text-slate-400">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 20))} setPage={setPage} />
    </Card>
  );
}

// ----------------------------------------------------------------
// Refunds
// ----------------------------------------------------------------
interface RefundRow { id: number; rechargeId: number; amount: number; reason: string; adminId: number; admin: { id: number; username: string; displayName: string } | null; recharge: { id: number; userId: number; originalAmount: number; status: string; createdAt: string } | null; createdAt: string }

function RefundsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["refunds-v2", page], queryFn: () => api<{ total: number; items: RefundRow[] }>(`/v1/admin/wallet/refunds?page=${page}&pageSize=20`) });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  return (
    <Card title={`Refunds (${total.toLocaleString()})`}>
      {items.length === 0 ? <Empty text="No refunds recorded." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">User</th><th>Original</th><th>Refunded</th><th>Reason</th><th>Admin</th><th>Time</th>
            </tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Link to={`/users/${r.recharge?.userId ?? 0}`} className="text-violet-600 hover:underline dark:text-violet-300">#{r.recharge?.userId ?? "—"}</Link></td>
                  <td className="tabular-nums">{r.recharge?.originalAmount.toLocaleString() ?? "—"}</td>
                  <td className="font-semibold text-rose-600 tabular-nums">{r.amount.toLocaleString()}</td>
                  <td className="text-xs">{r.reason || "—"}</td>
                  <td className="text-xs text-slate-400">{r.admin?.displayName ?? "—"}</td>
                  <td className="text-xs text-slate-400">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 20))} setPage={setPage} />
    </Card>
  );
}

// ----------------------------------------------------------------
// Withdrawals — agency withdrawal requests
// ----------------------------------------------------------------
interface WithdrawalRow { id: number; agencyId: number; agencyName: string; agencyCode: string; amount: number; status: string; note: string; createdAt: string }

function WithdrawalsTab() {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const qs = `page=${page}&pageSize=20${statusFilter ? `&status=${statusFilter}` : ""}`;
  const { data, isLoading } = useQuery({ queryKey: ["withdrawals", qs], queryFn: () => api<{ total: number; items: WithdrawalRow[] }>(`/v1/admin/wallet/withdrawals?${qs}`) });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  return (
    <Card title={`Withdrawals (${total.toLocaleString()})`}>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-32">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Button variant="subtle" type="submit">Apply</Button>
      </form>
      {items.length === 0 ? <Empty text="No withdrawal requests." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">Agency</th><th>Amount</th><th>Status</th><th>Note</th><th>Time</th>
            </tr></thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Link to={`/agencies/${w.agencyId}`} className="text-violet-600 hover:underline dark:text-violet-300">{w.agencyName}</Link></td>
                  <td className="font-semibold tabular-nums">{w.amount.toLocaleString()}</td>
                  <td><Badge tone={w.status === "approved" ? "green" : w.status === "pending" ? "amber" : "red"}>{w.status}</Badge></td>
                  <td className="text-xs">{w.note || "—"}</td>
                  <td className="text-xs text-slate-400">{w.createdAt.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pages={Math.max(1, Math.ceil(total / 20))} setPage={setPage} />
    </Card>
  );
}

// ----------------------------------------------------------------
// Reconciliation
// ----------------------------------------------------------------
function ReconciliationTab() {
  const { data, isLoading } = useQuery({ queryKey: ["reconciliation"], queryFn: () => api<{
    integrity: { ok: boolean; mismatchCount: number; mismatches: { userId: number; ledgerSum: number; walletBalance: number }[] };
    unmatchedRecharges: { rechargeId: number; userId: number; amount: number }[];
    unmatchedCount: number;
    duplicateTxKeys: { txKey: string; count: number }[];
    duplicateCount: number;
    note: string;
  }>("/v1/admin/wallet/reconciliation") });
  if (isLoading) return <Loading />;
  const d = data!;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className={`rounded-xl border p-4 ${d.integrity.ok ? "border-emerald-200 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20" : "border-rose-200 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/20"}`}>
          <div className="text-xs uppercase tracking-wider text-slate-400">Ledger Integrity</div>
          <div className={`mt-1 text-2xl font-bold ${d.integrity.ok ? "text-emerald-600" : "text-rose-600"}`}>{d.integrity.ok ? "OK ✓" : "MISMATCH"}</div>
          <div className="text-xs text-slate-400">{d.integrity.mismatchCount} mismatches</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs uppercase tracking-wider text-slate-400">Unmatched Recharges</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{d.unmatchedCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs uppercase tracking-wider text-slate-400">Duplicate txKeys</div>
          <div className="mt-1 text-2xl font-bold text-rose-600">{d.duplicateCount}</div>
        </div>
      </div>
      <p className="text-xs text-slate-400">{d.note}</p>

      {d.integrity.mismatches.length > 0 && (
        <Card title={`Balance mismatches (${d.integrity.mismatchCount})`}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">User</th><th>Ledger Sum</th><th>Wallet Balance</th><th>Difference</th>
            </tr></thead>
            <tbody>
              {d.integrity.mismatches.map((m) => (
                <tr key={m.userId} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Link to={`/users/${m.userId}`} className="text-violet-600 hover:underline dark:text-violet-300">#{m.userId}</Link></td>
                  <td className="tabular-nums">{m.ledgerSum.toLocaleString()}</td>
                  <td className="tabular-nums">{m.walletBalance.toLocaleString()}</td>
                  <td className="font-semibold text-rose-600 tabular-nums">{(m.ledgerSum - m.walletBalance).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {d.unmatchedRecharges.length > 0 && (
        <Card title={`Unmatched recharges (${d.unmatchedCount})`}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">Recharge ID</th><th>User</th><th>Amount</th>
            </tr></thead>
            <tbody>
              {d.unmatchedRecharges.map((r) => (
                <tr key={r.rechargeId} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2">#{r.rechargeId}</td>
                  <td><Link to={`/users/${r.userId}`} className="text-violet-600 hover:underline dark:text-violet-300">#{r.userId}</Link></td>
                  <td className="tabular-nums">{r.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Pagination helper
// ----------------------------------------------------------------
function Pagination({ page, pages, setPage }: { page: number; pages: number; setPage: (p: number) => void }) {
  return (
    <div className="flex justify-between items-center mt-3 text-sm">
      <span className="text-slate-400">page {page} / {pages}</span>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
        <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
      </div>
    </div>
  );
}

// Pagination helper
