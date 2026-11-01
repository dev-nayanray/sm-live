/**
 * SM Live — Dedicated report pages.
 *
 * Thin, focused wrappers over the analytics tabs that used to live only
 * inside the 7-tab Reports page. Each page keeps its own date filter and
 * renders exactly one tab (users / games / financial) plus the relevant
 * summary tiles.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, Input } from "../components/ui";
import { UsersTab, GamesTab, FinancialTab } from "./Analytics";

function DateFilter({ onApply }: { onApply: (qs: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const apply = () => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    onApply(qs.toString());
  };
  return (
    <Card>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <label className="text-xs text-slate-500 dark:text-slate-400">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-36 ml-1" /></label>
        <label className="text-xs text-slate-500 dark:text-slate-400">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-36 ml-1" /></label>
        <Button variant="subtle" type="submit">Apply</Button>
        <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); onApply(""); }}>Clear</Button>
      </form>
    </Card>
  );
}

export function UserActivityReports() {
  const [qs, setQs] = useState("");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">User Activity Reports</h1>
      <div className="mb-4"><DateFilter onApply={setQs} /></div>
      <UsersTab qs={qs} />
    </div>
  );
}

export function GamePerformance() {
  const [qs, setQs] = useState("");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Game Performance</h1>
      <div className="mb-4"><DateFilter onApply={setQs} /></div>
      <GamesTab qs={qs} />
    </div>
  );
}

export function FinancialReports() {
  const [qs, setQs] = useState("");
  const summaryQ = useQuery({
    queryKey: ["financial-reports-summary", qs],
    queryFn: () => api<{ totals: Record<string, number> }>(`/v1/admin/wallet/summary?${qs}`),
  });
  const t = summaryQ.data?.totals ?? {};
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Financial Reports</h1>
      <div className="mb-4"><DateFilter onApply={setQs} /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-4">
        {[
          { label: "Ledger volume", value: t.total },
          { label: "Credits", value: t.credits },
          { label: "Debits", value: t.debits },
          { label: "Balance held", value: t.balance },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {c.value === undefined ? "…" : Number(c.value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      <FinancialTab qs={qs} />
    </div>
  );
}
