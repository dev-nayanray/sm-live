/**
 * SM Live — Super Admin Dashboard (Prompt 02).
 *
 * A single React Query call to `GET /v1/admin/dashboard?preset=...&from=...&to=...`
 * powers every section of this page. The date filter applies consistently to
 * KPIs, financial summary, activity series, recent activity and alerts.
 *
 * Permissions:
 *   The `/dashboard` route is already gated by `RequirePerm perm="dashboard.view"`
 *   in App.tsx, so reaching this page guarantees the admin has the permission.
 *   Per-section permissions (e.g.QuickActions) are still enforced client-side
 *   via `useAuth().can(...)` for the action buttons, AND the backend
 *   independently enforces `dashboard.view` on the API route itself.
 *
 * No financial mutations are performed from this page — it is read-only by
 * design. Every figure is derived from canonical, immutable ledger records.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, ErrorBox, Retry, Skeleton } from "../components/ui";
import {
  ActivityChart,
  DateRangePicker,
  FinancialSummary,
  KpiCard,
  OperationalAlerts,
  QuickActions,
  RecentActivity,
  type DashboardPreset,
} from "../components/dashboard";

export interface DashboardData {
  // Legacy shape (back-compat)
  totals: {
    betsCount: number;
    betsAmount: number;
    winsCount: number;
    winsAmount: number;
    revenue: number;
    giftsAmount: number;
    recharges: number;
    activeRooms: number;
    newUsers24h: number;
    apiErrors24h: number;
  };
  range: { from: string; to: string; preset: string; label: string };
  generatedAt: string;
  currency: string;
  ledgerKinds: string[];
  kpis: {
    users: { total: number; newInPeriod: number; previousPeriod: number; deltaPct: number | null; link: string; available: boolean };
    activeUsers: { value: number; previousPeriod: number; deltaPct: number | null; label: string; link: string; available: boolean };
    agencies: { total: number; newInPeriod: number; previousPeriod: number; deltaPct: number | null; link: string; available: boolean };
    liveRooms: { activeNow: number; total: number; openedInPeriod: number; closedInPeriod: number; link: string; available: boolean };
    games: { total: number; active: number; maintenance: number; disabled: number; link: string; available: boolean };
    walletTx: { totalInPeriod: number; previousPeriod: number; deltaPct: number | null; rechargesSucceeded: number; rechargesFailed: number; link: string; available: boolean };
    providers: { total: number; enabled: number; errors24h: number; link: string; available: boolean };
  };
  financial: {
    currency: string;
    bets: { count: number; amount: number; prevAmount: number; deltaPct: number | null };
    payouts: { count: number; amount: number; prevAmount: number; deltaPct: number | null };
    gifts: { count: number; amount: number; prevAmount: number; deltaPct: number | null };
    recharges: { count: number; amount: number; prevAmount: number; deltaPct: number | null; failed: number };
    refunds: { count: number; amount: number; prevAmount: number; deltaPct: number | null };
    netGaming: { amount: number; prevAmount: number; note: string };
  };
  series: { day: string; newUsers: number; bets: number; payouts: number; recharges: number; gifts: number; ledger: number }[];
  activity: { id: string; ts: string; category: string; label: string; status: string | null; actor: string | null }[];
  alerts: { id: string; severity: "info" | "warning" | "critical"; title: string; detail: string; ts: string; link: string | null }[];
}

const fmt = (n: number) => n.toLocaleString();

/** Build the query string for the dashboard endpoint. */
function buildQuery(preset: DashboardPreset, from: string, to: string): string {
  if (preset === "custom") {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }
  return `preset=${preset}`;
}

export function Dashboard() {
  const { can } = useAuth();

  // Date range state (controlled). Default = last 30 days.
  const [preset, setPreset] = useState<DashboardPreset>("last30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // `appliedRange` is what we actually fetch with. The picker edits the
  // visible state, but only `onApply` commits it. This avoids refetching
  // mid-typing and prevents duplicate requests during date entry.
  const [appliedPreset, setAppliedPreset] = useState<DashboardPreset>("last30");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  const queryString = buildQuery(appliedPreset, appliedFrom, appliedTo);

  const { data, error, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["dashboard", appliedPreset, appliedFrom, appliedTo],
    queryFn: () => api<DashboardData>(`/v1/admin/dashboard?${queryString}`),
    // 30s background refresh keeps the dashboard fresh without polling the
    // server aggressively. The user can also force a refresh manually.
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const handlePreset = (p: DashboardPreset) => {
    setPreset(p);
    if (p !== "custom") {
      // Apply non-custom presets immediately — no Apply button needed.
      setAppliedPreset(p);
      setAppliedFrom("");
      setAppliedTo("");
      setFrom("");
      setTo("");
    }
  };

  const handleApply = () => {
    setAppliedPreset("custom");
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const updatedAtLabel = updatedAt
    ? updatedAt.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "short" })
    : "—";

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    [],
  );

  // Page-level error: show the legacy ErrorBox at the top so partial loads
  // are still possible if a future refactor splits sections per-query.
  if (error && !data) {
    return (
      <div>
        <DashboardHeader
          preset={preset}
          from={from}
          to={to}
          onPreset={handlePreset}
          onFrom={setFrom}
          onTo={setTo}
          onApply={handleApply}
          rangeLabel=""
          todayLabel={todayLabel}
          updatedAtLabel={updatedAtLabel}
          onRefresh={refresh}
          refreshing={isFetching}
        />
        <ErrorBox error={error} />
        <Retry onRetry={refresh} />
      </div>
    );
  }

  const k = data?.kpis;

  return (
    <div className="space-y-4">
      <DashboardHeader
        preset={preset}
        from={from}
        to={to}
        onPreset={handlePreset}
        onFrom={setFrom}
        onTo={setTo}
        onApply={handleApply}
        rangeLabel={data?.range.label ?? ""}
        todayLabel={todayLabel}
        updatedAtLabel={updatedAtLabel}
        onRefresh={refresh}
        refreshing={isFetching}
      />

      {/* KPI grid */}
      <section aria-label="Key performance indicators" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total users"
          icon="users"
          value={k ? fmt(k.users.total) : "—"}
          secondary={k ? <>{fmt(k.users.newInPeriod)} new in period</> : null}
          deltaPct={k?.users.deltaPct}
          link={k?.users.link}
          loading={isLoading && !k}
        />
        <KpiCard
          title="Active users"
          icon="activity"
          value={k ? fmt(k.activeUsers.value) : "—"}
          secondary={k ? <span title={k.activeUsers.label}>Wallet-active in period</span> : null}
          deltaPct={k?.activeUsers.deltaPct}
          link={k?.activeUsers.link}
          note={k ? k.activeUsers.label : undefined}
          loading={isLoading && !k}
        />
        <KpiCard
          title="Total agencies"
          icon="users"
          value={k ? fmt(k.agencies.total) : "—"}
          secondary={k ? <>{fmt(k.agencies.newInPeriod)} new in period</> : null}
          deltaPct={k?.agencies.deltaPct}
          link={k?.agencies.link}
          loading={isLoading && !k}
        />
        <KpiCard
          title="Live rooms"
          icon="broadcast"
          value={k ? fmt(k.liveRooms.activeNow) : "—"}
          secondary={k ? <>Active now · {fmt(k.liveRooms.total)} total</> : null}
          link={k?.liveRooms.link}
          note={k ? `${fmt(k.liveRooms.openedInPeriod)} opened in period` : undefined}
          loading={isLoading && !k}
        />
        <KpiCard
          title="Games"
          icon="joystick"
          value={k ? fmt(k.games.total) : "—"}
          secondary={
            k ? (
              <span className="flex flex-wrap items-center gap-1">
                <Badge tone="green">{fmt(k.games.active)} active</Badge>
                {k.games.maintenance > 0 && <Badge tone="amber">{fmt(k.games.maintenance)} maintenance</Badge>}
                {k.games.disabled > 0 && <Badge tone="slate">{fmt(k.games.disabled)} disabled</Badge>}
              </span>
            ) : null
          }
          link={k?.games.link}
          loading={isLoading && !k}
        />
        <KpiCard
          title="Wallet transactions"
          icon="wallet"
          value={k ? fmt(k.walletTx.totalInPeriod) : "—"}
          secondary={
            k ? (
              <>
                {fmt(k.walletTx.rechargesSucceeded)} succeeded recharges
                {k.walletTx.rechargesFailed > 0 && <span className="text-rose-600"> · {fmt(k.walletTx.rechargesFailed)} failed</span>}
              </>
            ) : null
          }
          deltaPct={k?.walletTx.deltaPct}
          link={k?.walletTx.link}
          loading={isLoading && !k}
        />
        <KpiCard
          title="Providers"
          icon="plug"
          value={k ? fmt(k.providers.total) : "—"}
          secondary={
            k ? (
              <span className="flex flex-wrap items-center gap-1">
                <Badge tone="green">{fmt(k.providers.enabled)} enabled</Badge>
                {k.providers.errors24h > 0 && <Badge tone="red">{fmt(k.providers.errors24h)} errors · 24h</Badge>}
              </span>
            ) : null
          }
          link={k?.providers.link}
          note={k ? "Operational signal: API errors in last 24h. We do not mark a provider healthy just because it is configured." : undefined}
          loading={isLoading && !k}
        />
        <KpiCard
          title="Net gaming margin"
          icon="trend"
          value={data ? `${fmt(data.financial.netGaming.amount)} ${data.currency}` : "—"}
          secondary={data ? <>Bets − payouts (period)</> : null}
          deltaPct={data ? pctDeltaNum(data.financial.netGaming.amount, data.financial.netGaming.prevAmount) : null}
          note="House coin margin. Not platform profit — commission is settled separately."
          loading={isLoading && !data}
        />
      </section>

      {/* Activity chart */}
      <ActivityChart
        data={data?.series ?? []}
        loading={isLoading && !data}
        error={error && !data ? error : null}
        onRetry={refresh}
      />

      {/* Financial summary */}
      <FinancialSummary data={data?.financial} loading={isLoading && !data} />

      {/* Two-column layout: recent activity + alerts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RecentActivity data={data?.activity ?? []} loading={isLoading && !data} />
        <OperationalAlerts alerts={data?.alerts ?? []} loading={isLoading && !data} />
      </div>

      {/* Quick actions */}
      <QuickActions can={can} />

      {/* Subtle loading bar at the bottom when refetching in background */}
      {isFetching && data && (
        <div className="flex items-center justify-center gap-2 pb-2 text-xs text-slate-400">
          <Skeleton className="h-1 w-12" />
          Refreshing…
        </div>
      )}
    </div>
  );
}

/** Local helper to render a percentage delta pill for the net-gaming card. */
function pctDeltaNum(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

// --------------------------------------------------------------------------
// Page header — title, subtitle, date range picker, refresh, last updated
// --------------------------------------------------------------------------
interface DashboardHeaderProps {
  preset: DashboardPreset;
  from: string;
  to: string;
  onPreset: (p: DashboardPreset) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onApply: () => void;
  rangeLabel: string;
  todayLabel: string;
  updatedAtLabel: string;
  onRefresh: () => void;
  refreshing: boolean;
}

function DashboardHeader(props: DashboardHeaderProps) {
  return (
    <Card>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Monitor platform activity, financial operations, and system health.
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{props.todayLabel}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={props.onRefresh} disabled={props.refreshing} title="Refresh dashboard">
              {props.refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <span className="text-xs text-slate-400">Updated {props.updatedAtLabel}</span>
          </div>
          {props.rangeLabel && (
            <Badge tone="violet">{props.rangeLabel}</Badge>
          )}
        </div>
      </div>
      <div className="mt-4">
        <DateRangePicker
          preset={props.preset}
          from={props.from}
          to={props.to}
          onPreset={props.onPreset}
          onFrom={props.onFrom}
          onTo={props.onTo}
          onApply={props.onApply}
        />
      </div>
    </Card>
  );
}
