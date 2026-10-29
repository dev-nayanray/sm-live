/**
 * Dashboard sub-components for the SM Live Super Admin.
 *
 * One file per logical group keeps the page itself readable while reusing
 * the shared `Card`, `Badge`, `Button`, `Skeleton` primitives from `ui.tsx`.
 *
 *   - DateRangePicker ........ preset + custom range, controlled
 *   - KpiCard ................ 8-KPI grid card with delta pill + link
 *   - DeltaPill .............. up/down/neutral percentage chip
 *   - ActivityChart ......... daily-series recharts area chart with skeletons
 *   - FinancialSummary ...... table of canonical financial figures
 *   - RecentActivity ........ merged audit/recharge/bet/security feed
 *   - OperationalAlerts ..... severity-bucketed alerts panel
 *   - QuickActions .......... permission-aware shortcuts to existing pages
 *
 * All components are presentational: they receive data + callbacks and do
 * NOT fetch data themselves — the page owns the single React Query call so
 * one network round-trip powers every section and the date filter is applied
 * consistently everywhere.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData } from "../../pages/Dashboard";
import { Badge, Button, Card, Empty, Skeleton } from "../ui";
import { Icon } from "../Icon";

// --------------------------------------------------------------------------
// Date range picker
// --------------------------------------------------------------------------
export type DashboardPreset = "today" | "yesterday" | "last7" | "last30" | "this_month" | "prev_month" | "custom";

const PRESETS: { value: DashboardPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "prev_month", label: "Previous month" },
  { value: "custom", label: "Custom" },
];

interface DateRangePickerProps {
  preset: DashboardPreset;
  from: string;
  to: string;
  onPreset: (p: DashboardPreset) => void;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onApply: () => void;
}

export function DateRangePicker({ preset, from, to, onPreset, onFrom, onTo, onApply }: DateRangePickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onPreset(p.value)}
            aria-pressed={preset === p.value}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              preset === p.value
                ? "bg-violet-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => onFrom(e.target.value)}
              max={to || undefined}
              className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
          <label className="text-xs text-slate-500 dark:text-slate-400">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => onTo(e.target.value)}
              min={from || undefined}
              className="ml-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
          <Button variant="subtle" onClick={onApply}>Apply</Button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Delta pill — up/down/flat percentage
// --------------------------------------------------------------------------
export function DeltaPill({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="text-[11px] text-slate-400">—</span>;
  const up = pct > 0;
  const flat = pct === 0;
  const tone = flat ? "slate" : up ? "green" : "red";
  return (
    <Badge tone={tone}>
      {flat ? "0%" : `${up ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}%`}
    </Badge>
  );
}

// --------------------------------------------------------------------------
// KPI card — single tile in the 8-card grid
// --------------------------------------------------------------------------
interface KpiCardProps {
  title: string;
  icon: string;
  // Primary big number
  value: string | number;
  // Optional secondary line (e.g. "12 active now")
  secondary?: React.ReactNode;
  // Optional delta pill (percentage vs previous period)
  deltaPct?: number | null;
  // Optional link to existing route
  link?: string | null;
  // Optional footer note (e.g. metric definition)
  note?: string;
  loading?: boolean;
}

export function KpiCard({ title, icon, value, secondary, deltaPct, link, note, loading }: KpiCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-5" />
        </div>
        <Skeleton className="mt-3 h-7 w-24" />
        <Skeleton className="mt-2 h-3 w-32" />
      </div>
    );
  }
  return (
    <div className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</span>
        {deltaPct !== undefined && <DeltaPill pct={deltaPct} />}
      </div>
      {secondary && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{secondary}</div>}
      {note && <div className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">{note}</div>}
      {link && (
        <Link
          to={link}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-300"
        >
          View details
          <Icon name="chevronRight" className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Activity chart — daily series
// --------------------------------------------------------------------------
interface SeriesPoint {
  day: string;
  newUsers: number;
  bets: number;
  payouts: number;
  recharges: number;
  gifts: number;
  ledger: number;
}

interface ActivityChartProps {
  data: SeriesPoint[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function ActivityChart({ data, loading, error, onRetry }: ActivityChartProps) {
  // Limit to last 60 days for readability on long ranges.
  const chartData = useMemo(() => data.slice(-60), [data]);
  const hasData = chartData.length > 0 && chartData.some((p) => p.newUsers + p.bets + p.payouts + p.recharges + p.gifts + p.ledger > 0);

  return (
    <Card
      title="Platform activity"
      actions={<span className="text-xs text-slate-400">Daily series · last {chartData.length} days</span>}
    >
      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : error ? (
        <div className="py-6 text-center">
          <p className="mb-2 text-sm text-rose-600">Failed to load activity series.</p>
          <Button variant="ghost" onClick={onRetry}>Retry</Button>
        </div>
      ) : !hasData ? (
        <Empty text="No activity recorded in the selected period." />
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gBets" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gRecharges" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickFormatter={(v: string) => v.slice(5)}
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} width={48} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#1e293b", border: 0, borderRadius: 8, color: "#e2e8f0", fontSize: 12 }}
                labelStyle={{ color: "#cbd5e1" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="newUsers" stroke="#8b5cf6" fill="url(#gUsers)" name="New users" />
              <Area type="monotone" dataKey="bets" stroke="#34d399" fill="url(#gBets)" name="Bet volume" />
              <Area type="monotone" dataKey="recharges" stroke="#f59e0b" fill="url(#gRecharges)" name="Recharges" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------
// Financial summary
// --------------------------------------------------------------------------
interface FinancialSummaryProps {
  data: DashboardData["financial"] | undefined;
  loading: boolean;
}

export function FinancialSummary({ data, loading }: FinancialSummaryProps) {
  if (loading) {
    return (
      <Card title="Financial summary">
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }
  if (!data) return null;
  const currency = data.currency ?? "coins";
  const rows: { label: string; count: number; amount: number; deltaPct?: number | null; note?: string; tone?: "default" | "good" | "bad" }[] = [
    { label: "Recharges (succeeded)", count: data.recharges.count, amount: data.recharges.amount, deltaPct: data.recharges.deltaPct, tone: "good" },
    { label: "Refunds", count: data.refunds.count, amount: data.refunds.amount, deltaPct: data.refunds.deltaPct, tone: "bad" },
    { label: "Bets / stakes", count: data.bets.count, amount: data.bets.amount, deltaPct: data.bets.deltaPct },
    { label: "Payouts / winnings", count: data.payouts.count, amount: data.payouts.amount, deltaPct: data.payouts.deltaPct, tone: "bad" },
    { label: "Gifts (gross volume)", count: data.gifts.count, amount: data.gifts.amount, deltaPct: data.gifts.deltaPct },
    {
      label: "Net gaming margin",
      count: 0,
      amount: data.netGaming.amount,
      note: data.netGaming.note,
      tone: data.netGaming.amount >= 0 ? "good" : "bad",
    },
  ];
  const fmt = (n: number) => n.toLocaleString();
  return (
    <Card
      title="Financial summary"
      actions={<span className="text-xs text-slate-400">All amounts in {currency}</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2 pr-3">Metric</th>
              <th className="px-3 text-right">Count</th>
              <th className="px-3 text-right">Amount</th>
              <th className="px-3 text-right">Δ vs prev period</th>
              <th className="pl-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-3 font-medium text-slate-700 dark:text-slate-200">{r.label}</td>
                <td className="px-3 text-right tabular-nums text-slate-600 dark:text-slate-300">{r.count > 0 ? fmt(r.count) : "—"}</td>
                <td className={`px-3 text-right tabular-nums font-semibold ${r.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : r.tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"}`}>
                  {fmt(r.amount)}
                </td>
                <td className="px-3 text-right"><DeltaPill pct={r.deltaPct ?? null} /></td>
                <td className="pl-3 text-xs text-slate-400 dark:text-slate-500">{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
        Pending and failed recharges are excluded from the deposit total. Payouts are
        independent rows written at settlement time, so a single bet's lifetime
        is never double-counted across the selected date range.
      </p>
    </Card>
  );
}

// --------------------------------------------------------------------------
// Recent activity feed
// --------------------------------------------------------------------------
interface ActivityRow {
  id: string;
  ts: string;
  category: string;
  label: string;
  status: string | null;
  actor: string | null;
}

const CATEGORY_TONE: Record<string, "slate" | "violet" | "amber" | "red" | "green"> = {
  audit: "violet",
  security: "red",
  recharge: "green",
  bet: "slate",
};

export function RecentActivity({ data, loading }: { data: ActivityRow[]; loading: boolean }) {
  return (
    <Card title="Recent platform activity" actions={<span className="text-xs text-slate-400">Last 12 records · mixed sources</span>}>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : data.length === 0 ? (
        <Empty text="No recent activity yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                <th className="py-2 pr-3">Category</th>
                <th className="px-3">Event</th>
                <th className="px-3">Actor</th>
                <th className="px-3">Status</th>
                <th className="pl-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={`${r.category}-${r.id}`} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-3">
                    <Badge tone={CATEGORY_TONE[r.category] ?? "slate"}>{r.category}</Badge>
                  </td>
                  <td className="px-3 text-slate-700 dark:text-slate-200">{r.label}</td>
                  <td className="px-3 text-slate-500 dark:text-slate-400">{r.actor ?? "—"}</td>
                  <td className="px-3">{r.status ? <Badge tone="slate">{r.status}</Badge> : <span className="text-slate-400">—</span>}</td>
                  <td className="pl-3 text-right text-xs text-slate-400 dark:text-slate-500">{r.ts.slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------
// Operational alerts
// --------------------------------------------------------------------------
const SEVERITY_BORDER: Record<string, string> = {
  info: "border-l-sky-400",
  warning: "border-l-amber-400",
  critical: "border-l-rose-500",
};

const SEVERITY_ICON: Record<string, string> = {
  info: "bell",
  warning: "alert",
  critical: "alert",
};

const SEVERITY_TEXT: Record<string, string> = {
  info: "text-sky-500",
  warning: "text-amber-500",
  critical: "text-rose-500",
};

const SEVERITY_LABEL_TONE: Record<string, "slate" | "amber" | "red"> = {
  info: "slate",
  warning: "amber",
  critical: "red",
};

export function OperationalAlerts({ alerts, loading }: { alerts: DashboardData["alerts"]; loading: boolean }) {
  return (
    <Card title="Operational alerts">
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : alerts.length === 0 ? (
        <Empty text="No active alerts — all clear." />
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`flex items-start gap-3 rounded-lg border border-l-4 border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50 ${SEVERITY_BORDER[a.severity] ?? "border-l-slate-400"}`}
            >
              <span className={`mt-0.5 ${SEVERITY_TEXT[a.severity] ?? "text-slate-500"}`}>
                <Icon name={SEVERITY_ICON[a.severity] ?? "bell"} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-slate-800 dark:text-slate-100">{a.title}</span>
                  <Badge tone={SEVERITY_LABEL_TONE[a.severity] ?? "slate"}>{a.severity}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{a.detail}</p>
                {a.link && (
                  <Link to={a.link} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-300">
                    Open <Icon name="chevronRight" className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------
// Quick actions
// --------------------------------------------------------------------------
interface QuickAction {
  label: string;
  to: string;
  perm: string;
  icon: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Manage Users", to: "/users", perm: "users.read", icon: "users" },
  { label: "Manage Agencies", to: "/users", perm: "agencies.read", icon: "users" },
  { label: "Monitor Live Rooms", to: "/live", perm: "rooms.read", icon: "broadcast" },
  { label: "Manage Games", to: "/games", perm: "games.read", icon: "joystick" },
  { label: "Wallet Transactions", to: "/wallet", perm: "wallet.read", icon: "wallet" },
  { label: "Provider Status", to: "/providers", perm: "providers.read", icon: "plug" },
  { label: "View Reports", to: "/reports", perm: "reports.read", icon: "chart" },
  { label: "Audit Logs", to: "/security", perm: "security.read", icon: "shield" },
];

export function QuickActions({ can }: { can: (perm: string) => boolean }) {
  const allowed = QUICK_ACTIONS.filter((a) => can(a.perm));
  if (allowed.length === 0) return null;
  return (
    <Card title="Quick actions">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {allowed.map((a) => (
          <Link
            key={`${a.label}-${a.to}`}
            to={a.to}
            className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm font-medium text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:text-slate-200 dark:hover:border-violet-700 dark:hover:bg-violet-500/10 dark:hover:text-violet-200"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
              <Icon name={a.icon} className="h-4 w-4" />
            </span>
            <span>{a.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
