/**
 * SM Live — Provider Management page (Prompt 06).
 *
 * Summary cards + filtered/paginated provider table (secrets NEVER shown).
 * Provider detail drawer with games list + recent errors.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, Select, Skeleton } from "../components/ui";

interface ProviderRow {
  id: number; name: string; code: string; apiBase: string;
  commissionPct: number; enabled: boolean; gameCount: number;
  apiKeyMasked: string; apiSecretSet: boolean;
}
interface ProvidersList { total: number; page: number; pageSize: number; items: ProviderRow[]; }
interface Summary { total: number; enabled: number; disabled: number; withErrors24h: number; totalGames: number; hasEnvironments: boolean; hasHealthChecks: boolean; }
interface ProviderDetail {
  profile: { id: number; name: string; code: string; apiBase: string; commissionPct: number; enabled: boolean; apiKeyMasked: string; apiSecretSet: boolean; };
  games: { id: number; code: string; name: string; status: string; isPro: boolean; sortOrder: number }[];
  counts: { games: number; apiKeys: number; bills: number };
  recentErrors: { id: number; route: string; message: string; createdAt: string }[];
  errorCount24h: number;
}

export function ProviderManagement() {
  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [detailTarget, setDetailTarget] = useState<number | null>(null);

  const summaryQ = useQuery({
    queryKey: ["providers-summary"],
    queryFn: () => api<Summary>("/v1/admin/providers/summary"),
    refetchInterval: 30_000,
  });

  const qs = (() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    if (search) p.set("search", search);
    if (enabledFilter) p.set("enabled", enabledFilter);
    return p.toString();
  })();

  const listQ = useQuery({
    queryKey: ["admin-providers", qs],
    queryFn: () => api<ProvidersList>(`/v1/admin/providers?${qs}`),
  });

  const detailQ = useQuery({
    queryKey: ["provider-detail", detailTarget],
    queryFn: () => api<ProviderDetail>(`/v1/admin/providers/${detailTarget}`),
    enabled: detailTarget != null,
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Game Providers</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Manage provider integrations, monitor health, and review API errors.</p>
      </div>

      {/* Summary */}
      {summaryQ.isLoading || !summaryQ.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Total providers", value: summaryQ.data.total, tone: "default" },
              { label: "Enabled", value: summaryQ.data.enabled, tone: "green" },
              { label: "Disabled", value: summaryQ.data.disabled, tone: "red" },
              { label: "Errors (24h)", value: summaryQ.data.withErrors24h, tone: "amber" },
              { label: "Provider games", value: summaryQ.data.totalGames, tone: "violet" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
                <div className={`mt-1 text-2xl font-bold ${c.tone === "green" ? "text-emerald-600 dark:text-emerald-400" : c.tone === "red" ? "text-rose-600 dark:text-rose-400" : c.tone === "amber" ? "text-amber-600 dark:text-amber-400" : c.tone === "violet" ? "text-violet-600 dark:text-violet-400" : "text-slate-800 dark:text-slate-100"}`}>{c.value}</div>
              </div>
            ))}
          </div>
          {!summaryQ.data.hasEnvironments && <p className="text-xs text-slate-400">No separate sandbox/production environment model — provider uses a single configured apiBase.</p>}
          {!summaryQ.data.hasHealthChecks && <p className="text-xs text-slate-400">No dedicated health-check endpoint — provider status is inferred from enabled flag + API error log activity.</p>}
        </>
      )}

      <Card title={`Providers (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={() => { void listQ.refetch(); void summaryQ.refetch(); }}>Refresh</Button>}>
        <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
          <Input placeholder="search name / code" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-56" />
          <Select value={enabledFilter} onChange={(e) => setEnabledFilter(e.target.value)} className="!w-32">
            <option value="">All</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </Select>
          <Button variant="subtle" type="submit">Apply</Button>
          <Button variant="ghost" onClick={() => { setSearch(""); setEnabledFilter(""); setPage(1); }}>Clear</Button>
        </form>

        {listQ.error ? <ErrorBox error={listQ.error} /> : null}
        {listQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : items.length === 0 ? (
          <Empty text="No providers configured." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-3">Provider</th><th className="px-3">Code</th><th className="px-3">Status</th>
                    <th className="px-3">API Base</th><th className="px-3 text-right">Games</th>
                    <th className="px-3">API Key</th><th className="pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-100">{p.name}</td>
                      <td className="px-3 font-mono text-xs text-slate-500 dark:text-slate-400">{p.code}</td>
                      <td className="px-3"><Badge tone={p.enabled ? "green" : "red"}>{p.enabled ? "enabled" : "disabled"}</Badge></td>
                      <td className="px-3 text-xs text-slate-400 truncate max-w-[200px]">{p.apiBase}</td>
                      <td className="px-3 text-right tabular-nums">{p.gameCount}</td>
                      <td className="px-3 font-mono text-xs text-slate-400">{p.apiKeyMasked}</td>
                      <td className="pl-3 text-right"><Button variant="ghost" onClick={() => setDetailTarget(p.id)}>View</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {items.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="font-medium text-slate-800 dark:text-slate-100">{p.name}</div><div className="text-xs text-slate-400">{p.code}</div></div>
                    <Badge tone={p.enabled ? "green" : "red"}>{p.enabled ? "enabled" : "disabled"}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div>Games: {p.gameCount}</div>
                    <div>Key: {p.apiKeyMasked}</div>
                  </div>
                  <div className="mt-2 flex justify-end"><Button variant="ghost" onClick={() => setDetailTarget(p.id)}>View details</Button></div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">page {page} / {pages}</span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
                <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Provider detail modal */}
      <Modal open={detailTarget != null} title={detailQ.data?.profile.name ?? "Provider detail"} onClose={() => setDetailTarget(null)}>
        {detailQ.isLoading ? <Skeleton className="h-40 w-full" /> : detailQ.data ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-400">ID</dt><dd className="font-mono">{detailQ.data.profile.id}</dd>
              <dt className="text-slate-400">Code</dt><dd className="font-mono">{detailQ.data.profile.code}</dd>
              <dt className="text-slate-400">Status</dt><dd><Badge tone={detailQ.data.profile.enabled ? "green" : "red"}>{detailQ.data.profile.enabled ? "enabled" : "disabled"}</Badge></dd>
              <dt className="text-slate-400">API base</dt><dd className="text-xs break-all">{detailQ.data.profile.apiBase}</dd>
              <dt className="text-slate-400">Commission</dt><dd>{detailQ.data.profile.commissionPct}%</dd>
              <dt className="text-slate-400">API key</dt><dd className="font-mono text-xs">{detailQ.data.profile.apiKeyMasked}</dd>
              <dt className="text-slate-400">Secret set</dt><dd>{detailQ.data.profile.apiSecretSet ? "✅ Yes" : "❌ No"}</dd>
            </dl>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><div className="text-slate-400">Games</div><div className="text-lg font-bold">{detailQ.data.counts.games}</div></div>
              <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><div className="text-slate-400">API keys</div><div className="text-lg font-bold">{detailQ.data.counts.apiKeys}</div></div>
              <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><div className="text-slate-400">Errors 24h</div><div className="text-lg font-bold text-amber-600 dark:text-amber-400">{detailQ.data.errorCount24h}</div></div>
            </div>
            {detailQ.data.games.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-400">Associated games</div>
                <ul className="space-y-1 text-xs">
                  {detailQ.data.games.slice(0, 10).map((g) => (
                    <li key={g.id} className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
                      <span>{g.name} <span className="font-mono text-slate-400">({g.code})</span></span>
                      <Badge tone={g.status === "active" ? "green" : "amber"}>{g.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detailQ.data.recentErrors.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-400">Recent API errors</div>
                <ul className="space-y-1 text-xs">
                  {detailQ.data.recentErrors.slice(0, 5).map((e) => (
                    <li key={e.id} className="border-b border-slate-100 py-1 dark:border-slate-800">
                      <span className="font-mono text-slate-400">{e.route}</span>: {e.message}
                      <span className="ml-2 text-slate-400">{e.createdAt.slice(0, 19)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : <Empty text="Provider not found." />}
      </Modal>
    </div>
  );
}
