/**
 * SM Live — Refund Records (dedicated ledger filter).
 *
 * Read-only ledger of every Refund with the linked recharge and the admin
 * who issued it, plus a CSV export. (Previously refunds were only visible
 * inside the Wallet page's tabs.)
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, API_BASE, getToken } from "../api";
import { Badge, Button, Card, Empty, ErrorBox, Loading } from "../components/ui";

interface RefundRow {
  id: number; amount: number; reason: string; createdAt: string;
  recharge: { id: number; userId: number; amount: number; status: string; createdAt: string } | null;
  admin: { id: number; username: string } | null;
}

export function RefundRecords() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["refund-records", page],
    queryFn: () => api<{ total: number; items: RefundRow[] }>(`/v1/admin/wallet/refunds?page=${page}&pageSize=20`),
  });

  const exportCsv = () => {
    void fetch(`${API_BASE}/v1/admin/wallet/export?tab=refunds`, { headers: { authorization: `Bearer ${getToken() ?? ""}` } })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `refunds-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => undefined);
  };

  const items = data?.items ?? [];
  const totalValue = items.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Refund Records</h1>
      <p className="text-sm text-slate-400 mb-4">Every coin refund with its source recharge and issuing admin.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        {[
          { label: "Total refunds", value: data?.total },
          { label: "Value on page", value: totalValue },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {c.value === undefined ? (isLoading ? "…" : "—") : Number(c.value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <Card
        title="Refund ledger"
        actions={<Button variant="ghost" onClick={exportCsv}>Export CSV</Button>}
      >
        {error ? <ErrorBox error={error} /> : null}
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no refunds recorded" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                <th className="py-2 pr-3">#</th><th className="px-3">User</th><th className="px-3 text-right">Amount</th>
                <th className="px-3">Reason</th><th className="px-3">Source recharge</th><th className="px-3">Issued by</th><th className="px-3">Date</th>
              </tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-3 text-slate-400">{r.id}</td>
                    <td className="px-3">{r.recharge ? `#${r.recharge.userId}` : "—"}</td>
                    <td className="px-3 text-right tabular-nums font-medium">{r.amount.toLocaleString()}</td>
                    <td className="px-3 max-w-xs truncate text-slate-500 dark:text-slate-400">{r.reason || "—"}</td>
                    <td className="px-3 text-xs text-slate-400">
                      {r.recharge ? `#${r.recharge.id} · ${r.recharge.amount.toLocaleString()} (${r.recharge.status})` : "—"}
                    </td>
                    <td className="px-3">{r.admin ? <Badge>{r.admin.username}</Badge> : <Badge tone="slate">system</Badge>}</td>
                    <td className="px-3 text-xs text-slate-400">{r.createdAt.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-400">page {page} · {data?.total ?? 0} total</span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
            <Button variant="ghost" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next →</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
