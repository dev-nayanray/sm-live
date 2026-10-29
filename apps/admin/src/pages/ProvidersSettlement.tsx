import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Loading } from "../components/ui";

interface Bill { id: number; providerId: number; periodStart: string; periodEnd: string; grossBets: number; grossPayout: number; commissionPct: number; commissionAmount: number; serviceFee: number; netPayable: number; status: string; provider: { name: string } }
interface SRec { id: number; providerId: number; amount: number; direction: string; method: string; note: string; createdAt: string; provider: { name: string } }

export function ProvidersSettlement() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"bills" | "records">("bills");
  const bills = useQuery({ queryKey: ["bills"], queryFn: () => api<{ items: Bill[] }>("/v1/admin/settlement/bills?page=1&pageSize=20") });
  const records = useQuery({ queryKey: ["settlement-records"], queryFn: () => api<SRec[]>("/v1/admin/settlement/records"), enabled: tab === "records" });

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Providers &amp; Settlement</h1>
      <div className="flex gap-2 mb-4">
        <Button variant={tab === "bills" ? "primary" : "ghost"} onClick={() => setTab("bills")}>Provider bills</Button>
        <Button variant={tab === "records" ? "primary" : "ghost"} onClick={() => setTab("records")}>Settlement records</Button>
        {can("providers.write") && (
          <Button variant="subtle" onClick={() => void api("/v1/admin/settlement/generate-bills", { method: "POST" }).then(() => bills.refetch())}>
            Generate bills (last month)
          </Button>
        )}
      </div>

      {tab === "bills" && (
        <>
          <Card title="Provider bills — commission, service fee, net payable">
            {bills.isLoading ? <Loading /> : (bills.data?.items ?? []).length === 0 ? <Empty text="no bills — click Generate" /> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2">Provider</th><th>Period</th><th>Gross bets</th><th>Payouts</th><th>Commission</th><th>Fee</th><th>Net</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {bills.data!.items.map((b) => (
                    <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2">{b.provider?.name}</td>
                      <td>{b.periodStart.slice(0, 7)}</td>
                      <td>{b.grossBets.toLocaleString()}</td>
                      <td>{b.grossPayout.toLocaleString()}</td>
                      <td>{b.commissionAmount.toLocaleString()} <span className="text-slate-400">({b.commissionPct}%)</span></td>
                      <td>{b.serviceFee.toLocaleString()}</td>
                      <td className="font-semibold">{b.netPayable.toLocaleString()}</td>
                      <td><Badge tone={b.status === "paid" ? "green" : "amber"}>{b.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Integration & monthly service fees are managed via Settings → settings editor (provider.monthly_service_fee) and the monthly BullMQ job.">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Monthly job chain: MonthlyServiceFee (1st, 00:20) → ProviderBill draft (1st, 00:30). Confirm/pay a bill by
              editing its status via the API; each action lands in the audit log.
            </p>
          </Card>
        </>
      )}

      {tab === "records" && (
        <Card title="Settlement records">
          {records.isLoading ? <Loading /> : (records.data ?? []).length === 0 ? <Empty text="no records" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2">Provider</th><th>Amount</th><th>Direction</th><th>Method</th><th>Note</th><th>Date</th>
              </tr></thead>
              <tbody>
                {records.data!.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">{r.provider?.name}</td>
                    <td className="font-semibold">{r.amount.toLocaleString()}</td>
                    <td><Badge>{r.direction}</Badge></td>
                    <td>{r.method}</td>
                    <td>{r.note || "—"}</td>
                    <td className="text-slate-400">{r.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
