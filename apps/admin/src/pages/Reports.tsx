import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, downloadCsv } from "../api";
import { Badge, Button, Card, Empty, Loading } from "../components/ui";

interface RevenueRow { bucket: string; bets: number; wins: number; rounds: number; revenue: number }
interface GamePerf { code: string; name: string; bets: number; amount: number; payouts: number; rounds: number; rtp: number | null }
interface Daily { day: string; betsAmount: number; winsAmount: number; revenue: number; giftsAmount: number; recharges: number }

export function Reports() {
  const [gran, setGran] = useState<"daily" | "weekly" | "monthly">("daily");
  const revenue = useQuery({ queryKey: ["revenue", gran], queryFn: () => api<RevenueRow[]>(`/v1/admin/reports/revenue?granularity=${gran}`) });
  const games = useQuery({ queryKey: ["report-games"], queryFn: () => api<GamePerf[]>("/v1/admin/reports/games") });
  const daily = useQuery({ queryKey: ["daily-rollup"], queryFn: () => api<Daily[]>("/v1/admin/reports/daily-rollup") });

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Reports</h1>

      <Card title="Revenue by period" actions={
        <div className="flex gap-2">
          {(["daily", "weekly", "monthly"] as const).map((g) => (
            <Button key={g} variant={gran === g ? "primary" : "ghost"} onClick={() => setGran(g)}>{g}</Button>
          ))}
          <Button variant="ghost" onClick={() => downloadCsv(`revenue-${gran}.csv`, (revenue.data ?? []) as unknown as Record<string, unknown>[])}>Export CSV</Button>
        </div>
      }>
        {revenue.isLoading ? <Loading /> : (revenue.data ?? []).length === 0 ? <Empty text="no bet data yet" /> : (
          <>
            <div className="h-64 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(0, 10)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: 0, borderRadius: 8, color: "#e2e8f0" }} />
                  <Bar dataKey="bets" fill="#8b5cf6" name="bets" />
                  <Bar dataKey="wins" fill="#34d399" name="payouts" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2">Bucket</th><th>Rounds</th><th>Bets</th><th>Payouts</th><th>Revenue</th>
              </tr></thead>
              <tbody>
                {revenue.data!.map((r) => (
                  <tr key={r.bucket} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">{r.bucket.slice(0, 10)}</td>
                    <td>{r.rounds}</td>
                    <td>{r.bets.toLocaleString()}</td>
                    <td>{r.wins.toLocaleString()}</td>
                    <td className={r.revenue >= 0 ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold"}>{r.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="Game performance" actions={
        <Button variant="ghost" onClick={() => downloadCsv("game-performance.csv", (games.data ?? []) as unknown as Record<string, unknown>[])}>Export CSV</Button>
      }>
        {games.isLoading ? <Loading /> : (games.data ?? []).length === 0 ? <Empty text="no games with bets" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">Game</th><th>Rounds</th><th>Bets</th><th>Volume</th><th>Payouts</th><th>RTP</th>
            </tr></thead>
            <tbody>
              {games.data!.map((g) => (
                <tr key={g.code} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2">{g.name} <span className="text-slate-400 font-mono text-xs">{g.code}</span></td>
                  <td>{g.rounds}</td>
                  <td>{g.bets}</td>
                  <td>{g.amount.toLocaleString()}</td>
                  <td>{g.payouts.toLocaleString()}</td>
                  <td>{g.rtp == null ? "—" : <Badge tone={g.rtp > 1 ? "red" : g.rtp > 0.9 ? "amber" : "green"}>{(g.rtp * 100).toFixed(1)}%</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Daily rollup (BullMQ job, 00:05 UTC)">
        {daily.isLoading ? <Loading /> : (daily.data ?? []).length === 0 ? <Empty text="first rollup runs at 00:05 UTC (or trigger via the job)" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-2">Day</th><th>Bets</th><th>Payouts</th><th>Revenue</th><th>Gifts</th><th>Recharges</th>
            </tr></thead>
            <tbody>
              {daily.data!.map((d) => (
                <tr key={d.day} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2">{d.day.slice(0, 10)}</td>
                  <td>{d.betsAmount.toLocaleString()}</td>
                  <td>{d.winsAmount.toLocaleString()}</td>
                  <td className="font-semibold">{d.revenue.toLocaleString()}</td>
                  <td>{d.giftsAmount.toLocaleString()}</td>
                  <td>{d.recharges}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
