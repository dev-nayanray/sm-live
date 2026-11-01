/**
 * SM Live — Reports & Analytics Dashboard (Prompt 08).
 *
 * 7-tab analytics dashboard: Overview, Users, Live, Games, Financial,
 * Providers, System. All metrics from real backend data. Date filters
 * with from/to YYYY-MM-DD. CSV export.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, API_BASE, getToken } from "../api";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Skeleton } from "../components/ui";

export function Analytics() {
  const [tab, setTab] = useState<"overview" | "users" | "live" | "games" | "financial" | "providers" | "system">("overview");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  const qs = new URLSearchParams();
  if (appliedFrom) qs.set("from", appliedFrom);
  if (appliedTo) qs.set("to", appliedTo);
  const qsStr = qs.toString();

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Reports &amp; Analytics</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          ["overview", "Overview"], ["users", "Users"], ["live", "Live Platform"],
          ["games", "Games"], ["financial", "Financial"], ["providers", "Providers"], ["system", "System"],
        ] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>

      <Card>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setAppliedFrom(from); setAppliedTo(to); }}>
          <label className="text-xs text-slate-500 dark:text-slate-400">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-36 ml-1" /></label>
          <label className="text-xs text-slate-500 dark:text-slate-400">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-36 ml-1" /></label>
          <Button variant="subtle" type="submit">Apply</Button>
          <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); setAppliedFrom(""); setAppliedTo(""); }}>Clear</Button>
        </form>
      </Card>

      <div className="mt-4">
        {tab === "overview" && <OverviewTab qs={qsStr} />}
        {tab === "users" && <UsersTab qs={qsStr} />}
        {tab === "live" && <LiveTab qs={qsStr} />}
        {tab === "games" && <GamesTab qs={qsStr} />}
        {tab === "financial" && <FinancialTab qs={qsStr} />}
        {tab === "providers" && <ProvidersTab qs={qsStr} />}
        {tab === "system" && <SystemTab />}
      </div>
    </div>
  );
}

function OverviewTab({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-overview", qs],
    queryFn: () => api<{
      users: { total: number; new: number }; agencies: { total: number; active: number };
      rooms: { total: number; active: number }; sessions: { total: number; active: number };
      bets: { total: number; won: number; lost: number };
      recharges: { total: number; succeeded: number; failed: number };
      ledger: { total: number; credits: number; debits: number };
      payouts: { total: number }; refunds: { total: number };
      reports: { total: number; open: number };
      games: { active: number; maintenance: number; disabled: number };
      providers: { total: number; enabled: number };
      hasActiveUserTracking: boolean; note: string;
    }>(`/v1/admin/analytics/overview?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("Failed to load")} />;
  const d = data;
  const cards = [
    { label: "Total users", value: d.users.total, sub: `${d.users.new} new in range` },
    { label: "Agencies", value: d.agencies.total, sub: `${d.agencies.active} active` },
    { label: "Active rooms", value: d.rooms.active, sub: `${d.rooms.total} total` },
    { label: "Active sessions", value: d.sessions.active, sub: `${d.sessions.total} total` },
    { label: "Bets", value: d.bets.total, sub: `${d.bets.won} won · ${d.bets.lost} lost` },
    { label: "Recharges", value: d.recharges.total, sub: `${d.recharges.succeeded} ok · ${d.recharges.failed} failed` },
    { label: "Ledger entries", value: d.ledger.total, sub: `${d.ledger.credits} credits · ${d.ledger.debits} debits` },
    { label: "Payouts", value: d.payouts.total },
    { label: "Refunds", value: d.refunds.total },
    { label: "Open reports", value: d.reports.open, sub: `${d.reports.total} total` },
    { label: "Active games", value: d.games.active, sub: `${d.games.maintenance} maint · ${d.games.disabled} disabled` },
    { label: "Providers", value: d.providers.total, sub: `${d.providers.enabled} enabled` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{c.value.toLocaleString()}</div>
            {c.sub && <div className="text-xs text-slate-400 mt-0.5">{c.sub}</div>}
          </div>
        ))}
      </div>
      {!d.hasActiveUserTracking && <p className="text-xs text-slate-400">{d.note}</p>}
    </div>
  );
}

export function UsersTab({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-users", qs],
    queryFn: () => api<{
      registrationSeries: { day: string; count: number }[];
      countryDistribution: { country: string; count: number }[];
      statusDistribution: { total: number; active: number; banned: number; muted: number; frozen: number };
      hasRetentionData: boolean; note: string;
    }>(`/v1/admin/analytics/users?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("Failed to load")} />;
  const d = data;
  return (
    <div className="space-y-4">
      <Card title="Registration trend">
        {d.registrationSeries.length === 0 ? <Empty text="No registration data." /> : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.registrationSeries}>
                <defs><linearGradient id="gReg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.7} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#1e293b", border: 0, borderRadius: 8, color: "#e2e8f0" }} />
                <Area type="monotone" dataKey="count" stroke="#8b5cf6" fill="url(#gReg)" name="New users" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Country distribution">
          {d.countryDistribution.length === 0 ? <Empty text="No country data." /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700"><th className="py-2">Country</th><th className="text-right">Users</th></tr></thead>
              <tbody>
                {d.countryDistribution.map((c) => (
                  <tr key={c.country} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-mono">{c.country}</td><td className="text-right tabular-nums">{c.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Account status">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50"><div className="text-xs text-slate-400">Total</div><div className="text-xl font-bold">{d.statusDistribution.total}</div></div>
            <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-900/20"><div className="text-xs text-slate-400">Active</div><div className="text-xl font-bold text-emerald-600">{d.statusDistribution.active}</div></div>
            <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-900/20"><div className="text-xs text-slate-400">Banned</div><div className="text-xl font-bold text-rose-600">{d.statusDistribution.banned}</div></div>
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20"><div className="text-xs text-slate-400">Muted</div><div className="text-xl font-bold text-amber-600">{d.statusDistribution.muted}</div></div>
          </div>
          {!d.hasRetentionData && <p className="mt-3 text-xs text-slate-400">{d.note}</p>}
        </Card>
      </div>
    </div>
  );
}

function LiveTab({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-live", qs],
    queryFn: () => api<{
      totalRooms: number; activeRooms: number; closedRooms: number;
      byType: { live: number; voice: number; party: number };
      totalParticipants: number; totalRoomReports: number;
      roomCreationSeries: { day: string; count: number }[];
      hasDurationData: boolean; note: string;
    }>(`/v1/admin/analytics/live?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("Failed to load")} />;
  const d = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total rooms", value: d.totalRooms }, { label: "Active", value: d.activeRooms },
          { label: "Closed", value: d.closedRooms }, { label: "Participants", value: d.totalParticipants },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="text-2xl font-bold">{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
      <Card title="Room creation trend">
        {d.roomCreationSeries.length === 0 ? <Empty text="No room creation data." /> : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.roomCreationSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#1e293b", border: 0, borderRadius: 8, color: "#e2e8f0" }} />
                <Bar dataKey="count" fill="#8b5cf6" name="Rooms created" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      <Card title="By type">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-rose-50 p-3 dark:bg-rose-900/20"><div className="text-xs text-slate-400">Live</div><div className="text-xl font-bold text-rose-600">{d.byType.live}</div></div>
          <div className="rounded-lg bg-violet-50 p-3 dark:bg-violet-900/20"><div className="text-xs text-slate-400">Voice</div><div className="text-xl font-bold text-violet-600">{d.byType.voice}</div></div>
          <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20"><div className="text-xs text-slate-400">Party</div><div className="text-xl font-bold text-amber-600">{d.byType.party}</div></div>
        </div>
      </Card>
      {!d.hasDurationData && <p className="text-xs text-slate-400">{d.note}</p>}
    </div>
  );
}

export function GamesTab({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-games", qs],
    queryFn: () => api<{
      totalGames: number; activeGames: number; maintenanceGames: number;
      totalSessions: number; activeSessions: number;
      totalBets: number; placedBets: number; wonBets: number; lostBets: number;
      totalBetVolume: number; totalPayoutVolume: number; netGamingMargin: number;
      sessionSeries: { day: string; count: number }[]; note: string;
    }>(`/v1/admin/analytics/games?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("Failed to load")} />;
  const d = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Games", value: `${d.activeGames}/${d.totalGames}`, sub: `${d.maintenanceGames} maint` },
          { label: "Sessions", value: d.totalSessions, sub: `${d.activeSessions} active` },
          { label: "Bets", value: d.totalBets, sub: `${d.wonBets} won · ${d.lostBets} lost` },
          { label: "Bet volume", value: d.totalBetVolume.toLocaleString(), sub: "coins" },
          { label: "Payout volume", value: d.totalPayoutVolume.toLocaleString(), sub: "coins" },
          { label: "Net margin", value: d.netGamingMargin.toLocaleString(), sub: "bets−wins", tone: d.netGamingMargin >= 0 ? "text-emerald-600" : "text-rose-600" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className={`text-xl font-bold ${c.tone ?? ""}`}>{c.value}</div>
            {c.sub && <div className="text-xs text-slate-400">{c.sub}</div>}
          </div>
        ))}
      </div>
      <Card title="Session launch trend">
        {d.sessionSeries.length === 0 ? <Empty text="No session data." /> : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.sessionSeries}>
                <defs><linearGradient id="gSess" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#34d399" stopOpacity={0.6} /><stop offset="95%" stopColor="#34d399" stopOpacity={0.05} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#1e293b", border: 0, borderRadius: 8, color: "#e2e8f0" }} />
                <Area type="monotone" dataKey="count" stroke="#34d399" fill="url(#gSess)" name="Sessions" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-400">{d.note}</p>
    </div>
  );
}

export function FinancialTab({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-financial", qs],
    queryFn: () => api<{
      currency: string; rechargeVolume: number; betDebitVolume: number; winCreditVolume: number;
      giftDebitVolume: number; giftCreditVolume: number; refundVolume: number;
      adminAdjustVolume: number; agencyCommissionVolume: number;
      pendingRecharges: number; failedRecharges: number;
      pendingWithdrawals: number; approvedWithdrawals: number;
      netGamingMargin: number; note: string;
    }>(`/v1/admin/analytics/financial?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("Failed to load")} />;
  const d = data;
  const rows = [
    { label: "Recharge volume", value: d.rechargeVolume, tone: "text-emerald-600" },
    { label: "Bet debit volume", value: d.betDebitVolume, tone: "text-rose-600" },
    { label: "Win credit volume", value: d.winCreditVolume, tone: "text-emerald-600" },
    { label: "Gift debit volume", value: d.giftDebitVolume, tone: "text-rose-600" },
    { label: "Gift credit volume", value: d.giftCreditVolume, tone: "text-emerald-600" },
    { label: "Refund volume", value: d.refundVolume, tone: "text-rose-600" },
    { label: "Admin adjustments", value: d.adminAdjustVolume, tone: "text-amber-600" },
    { label: "Agency commission", value: d.agencyCommissionVolume, tone: "text-violet-600" },
    { label: "Net gaming margin", value: d.netGamingMargin, tone: d.netGamingMargin >= 0 ? "text-emerald-600" : "text-rose-600" },
  ];
  return (
    <div className="space-y-4">
      <Card title={`Financial summary (${d.currency})`}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700"><th className="py-2">Metric</th><th className="text-right">Volume ({d.currency})</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 font-medium">{r.label}</td>
                <td className={`text-right font-semibold tabular-nums ${r.tone}`}>{r.value.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">Pending recharges</div><div className="text-xl font-bold text-amber-600">{d.pendingRecharges}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">Failed recharges</div><div className="text-xl font-bold text-rose-600">{d.failedRecharges}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">Pending withdrawals</div><div className="text-xl font-bold text-amber-600">{d.pendingWithdrawals}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">Approved withdrawals</div><div className="text-xl font-bold text-emerald-600">{d.approvedWithdrawals}</div></div>
      </div>
      <p className="text-xs text-slate-400">{d.note}</p>
    </div>
  );
}

function ProvidersTab({ qs }: { qs: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-providers", qs],
    queryFn: () => api<{
      totalProviders: number; enabledProviders: number; disabledProviders: number;
      totalApiErrors: number; providerErrors: number;
      providers: { id: number; name: string; code: string; enabled: boolean; gameCount: number }[];
      hasResponseTimeData: boolean; note: string;
    }>(`/v1/admin/analytics/providers?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("Failed to load")} />;
  const d = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">Total providers</div><div className="text-xl font-bold">{d.totalProviders}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">Enabled</div><div className="text-xl font-bold text-emerald-600">{d.enabledProviders}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">API errors</div><div className="text-xl font-bold text-rose-600">{d.totalApiErrors}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="text-[11px] uppercase text-slate-400">Provider errors</div><div className="text-xl font-bold text-amber-600">{d.providerErrors}</div></div>
      </div>
      <Card title="Provider list">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700"><th className="py-2">Provider</th><th>Code</th><th>Status</th><th className="text-right">Games</th></tr></thead>
          <tbody>
            {d.providers.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 font-medium">{p.name}</td>
                <td className="font-mono text-xs text-slate-400">{p.code}</td>
                <td><Badge tone={p.enabled ? "green" : "red"}>{p.enabled ? "enabled" : "disabled"}</Badge></td>
                <td className="text-right tabular-nums">{p.gameCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {!d.hasResponseTimeData && <p className="text-xs text-slate-400">{d.note}</p>}
    </div>
  );
}

function SystemTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-system"],
    queryFn: () => api<{
      uptimeSeconds: number; nodeVersion: string; platform: string;
      memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
      cpu: { userMicros: number; systemMicros: number };
      pid: number; time: string;
      hasExternalMonitoring: boolean; hasDatabaseMetrics: boolean; hasCacheMetrics: boolean; note: string;
    }>("/v1/admin/analytics/system"),
    refetchInterval: 10_000,
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("Failed to load")} />;
  const d = data;
  const uptime = `${Math.floor(d.uptimeSeconds / 3600)}h ${Math.floor((d.uptimeSeconds % 3600) / 60)}m`;
  return (
    <div className="space-y-4">
      <Card title="Server status">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-400">Uptime</dt><dd>{uptime}</dd>
          <dt className="text-slate-400">Node version</dt><dd>{d.nodeVersion}</dd>
          <dt className="text-slate-400">Platform</dt><dd>{d.platform}</dd>
          <dt className="text-slate-400">PID</dt><dd>{d.pid}</dd>
          <dt className="text-slate-400">Time</dt><dd>{d.time.replace("T", " ").slice(0, 19)}Z</dd>
        </dl>
      </Card>
      <Card title="Memory usage">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50"><div className="text-xs text-slate-400">RSS</div><div className="text-xl font-bold">{d.memory.rssMb} MB</div></div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50"><div className="text-xs text-slate-400">Heap used</div><div className="text-xl font-bold">{d.memory.heapUsedMb} MB</div></div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50"><div className="text-xs text-slate-400">Heap total</div><div className="text-xl font-bold">{d.memory.heapTotalMb} MB</div></div>
          <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50"><div className="text-xs text-slate-400">External</div><div className="text-xl font-bold">{d.memory.externalMb} MB</div></div>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="External monitoring"><div className={`text-sm font-medium ${d.hasExternalMonitoring ? "text-emerald-600" : "text-slate-400"}`}>{d.hasExternalMonitoring ? "Configured" : "Not configured"}</div></Card>
        <Card title="Database metrics"><div className={`text-sm font-medium ${d.hasDatabaseMetrics ? "text-emerald-600" : "text-slate-400"}`}>{d.hasDatabaseMetrics ? "Available" : "Not instrumented"}</div></Card>
        <Card title="Cache metrics"><div className={`text-sm font-medium ${d.hasCacheMetrics ? "text-emerald-600" : "text-slate-400"}`}>{d.hasCacheMetrics ? "Available" : "Not instrumented"}</div></Card>
      </div>
      <p className="text-xs text-slate-400">{d.note}</p>
    </div>
  );
}

// Suppress unused import warning
void Skeleton;
