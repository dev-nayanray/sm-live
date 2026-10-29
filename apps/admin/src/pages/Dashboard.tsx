import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { Card, ErrorBox, Loading, Stat } from "../components/ui";

interface DashboardData {
  totals: {
    betsCount: number; betsAmount: number; winsCount: number; winsAmount: number; revenue: number;
    giftsAmount: number; recharges: number; activeRooms: number; newUsers24h: number; apiErrors24h: number;
  };
  series30d: { day: string; bets: number; wins: number; revenue: number }[];
}

export function Dashboard() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/v1/admin/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const t = data!.totals;

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label="Bets (30d)" value={t.betsCount.toLocaleString()} />
        <Stat label="Bet volume" value={t.betsAmount.toLocaleString() + " 🪙"} />
        <Stat label="Payouts" value={t.winsAmount.toLocaleString() + " 🪙"} />
        <Stat label="Revenue (bets−wins)" value={t.revenue.toLocaleString() + " 🪙"} tone={t.revenue >= 0 ? "text-emerald-600" : "text-rose-600"} />
        <Stat label="Gift volume" value={t.giftsAmount.toLocaleString() + " 🪙"} />
        <Stat label="Recharges" value={t.recharges.toLocaleString() + " 🪙"} />
        <Stat label="Active rooms" value={t.activeRooms} />
        <Stat label="New users 24h" value={t.newUsers24h} />
      </div>

      <Card title="Bets / payouts / revenue — 30 days">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data!.series30d}>
              <defs>
                <linearGradient id="gBets" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gWins" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: 0, borderRadius: 8, color: "#e2e8f0" }} />
              <Area type="monotone" dataKey="bets" stroke="#8b5cf6" fill="url(#gBets)" name="bets" />
              <Area type="monotone" dataKey="wins" stroke="#34d399" fill="url(#gWins)" name="payouts" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="API errors (24h)">
        <div className="text-3xl font-bold">{t.apiErrors24h}</div>
        <p className="text-sm text-slate-400 mt-1">Provider call failures land here (see API & Security → API errors).</p>
      </Card>
    </div>
  );
}
