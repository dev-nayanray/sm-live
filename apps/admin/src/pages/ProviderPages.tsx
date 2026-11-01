/**
 * SM Live — Provider integration pages.
 *
 * Three focused views over provider plumbing:
 *   - ApiIntegration: overall integration posture (providers, keys, sessions)
 *   - WebhookMonitoring: webhook-settled rounds feed
 *   - ApiErrorLogs: API error log feed (provider failures, bad signatures)
 *   - SandboxStatus: enabled/disabled split + recent provider health
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading } from "../components/ui";

interface IntegrationSummary {
  providers: { total: number; enabled: number; disabled: number };
  apiKeys: { total: number; enabled: number };
  apiErrors24h: number;
  providerErrors24h: number;
  gameSessions: { total: number; active: number };
  webhookSettlements: number;
}

export function ApiIntegration() {
  const { data, isLoading } = useQuery({
    queryKey: ["integration-summary"],
    queryFn: () => api<IntegrationSummary>("/v1/admin/integration/summary"),
    refetchInterval: 60_000,
  });
  if (isLoading) return <Loading />;
  if (!data) return <ErrorBox error={new Error("failed to load integration summary")} />;
  const cards = [
    { label: "Providers", value: `${data.providers.enabled}/${data.providers.total}`, sub: `${data.providers.disabled} disabled` },
    { label: "API keys", value: `${data.apiKeys.enabled}/${data.apiKeys.total}`, sub: "enabled" },
    { label: "API errors (24h)", value: data.apiErrors24h, sub: `${data.providerErrors24h} provider-side` },
    { label: "Game sessions", value: data.gameSessions.total.toLocaleString(), sub: `${data.gameSessions.active} active` },
    { label: "Webhook settlements", value: data.webhookSettlements.toLocaleString() },
  ];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">API Integration</h1>
      <p className="text-sm text-slate-400 mb-4">Provider integration posture — keys, sessions and error counters.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{c.value}</div>
            {c.sub && <div className="text-xs text-slate-400 mt-0.5">{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function WebhookMonitoring() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["webhooks", page, applied],
    queryFn: () => api<{ total: number; items: { id: number; roundId: string; game: { code: string } | null; provider: { name: string } | null; status: string; settledAt: string | null; createdAt: string }[] }>(
      `/v1/admin/integration/webhooks?page=${page}&pageSize=20${applied ? `&search=${encodeURIComponent(applied)}` : ""}`
    ),
  });
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Webhook Monitoring</h1>
      <p className="text-sm text-slate-400 mb-4">Rounds settled through provider webhooks.</p>
      <Card
        title={`Webhook settlements (${data?.total.toLocaleString() ?? "…"})`}
        actions={
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(search); setPage(1); }}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="round id" className="!w-40" />
            <Button variant="subtle" type="submit">Search</Button>
          </form>
        }
      >
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no webhook settlements" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Round</th><th>Game</th><th>Provider</th><th>Status</th><th>Settled</th>
            </tr></thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-mono text-xs">{w.roundId}</td>
                  <td>{w.game?.code ?? "—"}</td>
                  <td>{w.provider?.name ?? "—"}</td>
                  <td><Badge tone={w.status === "settled" ? "green" : "amber"}>{w.status}</Badge></td>
                  <td className="text-xs text-slate-400">{w.settledAt ? w.settledAt.slice(0, 16).replace("T", " ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-400">page {page}</span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
            <Button variant="ghost" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next →</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function ApiErrorLogs() {
  const [page, setPage] = useState(1);
  const [source, setSource] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["api-errors", page, source],
    queryFn: () => api<{ total: number; items: { id: number; source: string; route: string; message: string; createdAt: string }[] }>(
      `/v1/admin/api-errors?page=${page}&pageSize=20${source ? `&source=${encodeURIComponent(source)}` : ""}`
    ),
    refetchInterval: 30_000,
  });
  const items = data?.items ?? [];
  const sources = Array.from(new Set(items.map((i) => i.source)));
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">API Error Logs</h1>
      <p className="text-sm text-slate-400 mb-4">Provider call failures, bad signatures and upstream errors.</p>
      <Card
        title={`API errors (${data?.total.toLocaleString() ?? "…"})`}
        actions={
          <select
            value={source}
            onChange={(e) => { setSource(e.target.value); setPage(1); }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        }
      >
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no API errors recorded 🎉" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Source</th><th>Route</th><th>Message</th><th>Time</th>
            </tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Badge tone="red">{e.source}</Badge></td>
                  <td className="font-mono text-xs">{e.route}</td>
                  <td className="max-w-md truncate text-slate-500 dark:text-slate-400" title={e.message}>{e.message}</td>
                  <td className="text-xs text-slate-400">{e.createdAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-400">page {page}</span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
            <Button variant="ghost" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next →</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function SandboxStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ["sandbox-status"],
    queryFn: () => api<{ items: { id: number; name: string; code: string; enabled: boolean; sandbox: boolean; baseUrl: string }[] }>(
      "/v1/admin/providers?page=1&pageSize=50"
    ),
  });
  const summaryQ = useQuery({
    queryKey: ["integration-summary"],
    queryFn: () => api<IntegrationSummary>("/v1/admin/integration/summary"),
  });
  if (isLoading) return <Loading />;
  const providers = data?.items ?? [];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Sandbox &amp; Live Status</h1>
      <p className="text-sm text-slate-400 mb-4">Which providers are live vs sandboxed, and current enablement.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-4">
        {[
          { label: "Enabled providers", value: summaryQ.data?.providers.enabled ?? "…" },
          { label: "Disabled providers", value: summaryQ.data?.providers.disabled ?? "…" },
          { label: "Provider errors (24h)", value: summaryQ.data?.providerErrors24h ?? "…" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{typeof c.value === "number" ? c.value.toLocaleString() : c.value}</div>
          </div>
        ))}
      </div>
      <Card title="Providers">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
            <th className="py-2">Provider</th><th>Mode</th><th>State</th><th>Base URL</th>
          </tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2"><div className="font-medium">{p.name}</div><div className="text-xs text-slate-400">{p.code}</div></td>
                <td><Badge tone={p.sandbox ? "amber" : "green"}>{p.sandbox ? "sandbox" : "live"}</Badge></td>
                <td><Badge tone={p.enabled ? "green" : "slate"}>{p.enabled ? "enabled" : "disabled"}</Badge></td>
                <td className="font-mono text-xs text-slate-400">{p.baseUrl || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
