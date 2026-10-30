/**
 * SM Live — Game Management page (Prompt 06).
 *
 * Summary cards + filtered/paginated game table + status change dialogs.
 * Replaces the existing Games.tsx tab-based page with a dedicated monitoring
 * interface. The existing ResourceTable CRUD for games/configs/providers is
 * preserved via a link to the old /games-content route.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, Select, Skeleton } from "../components/ui";
import { Icon } from "../components/Icon";

interface GameRow {
  id: number; code: string; name: string; version: string; status: string;
  isPro: boolean; thumbnailUrl: string; sortOrder: number;
  providerId: number | null;
  provider: { id: number; name: string; code: string; enabled: boolean } | null;
  configCount: number; sessionCount: number;
}
interface GamesList { total: number; page: number; pageSize: number; items: GameRow[]; }
interface Summary {
  total: number; active: number; maintenance: number; disabled: number;
  isPro: number; errorGames24h: number; hasGameCategories: boolean;
}

export function GameManagement() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [statusTarget, setStatusTarget] = useState<{ id: number; name: string; currentStatus: string; action: "activate" | "disable" | "maintenance" } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const canWrite = can("games.write");

  const summaryQ = useQuery({
    queryKey: ["games-summary"],
    queryFn: () => api<Summary>("/v1/admin/games/summary"),
    refetchInterval: 30_000,
  });

  const providersQ = useQuery({
    queryKey: ["providers-for-filter"],
    queryFn: () => api<{ items: { id: number; name: string; code: string }[] }>("/v1/admin/providers?pageSize=100"),
    staleTime: 5 * 60_000,
  });

  const qs = (() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    if (search) p.set("search", search);
    if (statusFilter) p.set("status", statusFilter);
    if (providerFilter) p.set("providerId", providerFilter);
    return p.toString();
  })();

  const listQ = useQuery({
    queryKey: ["admin-games", qs],
    queryFn: () => api<GamesList>(`/v1/admin/games?${qs}`),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const handleStatusChange = async () => {
    if (!statusTarget) return;
    if (statusReason.trim().length < 1) return;
    setBusy(true);
    try {
      await api(`/v1/admin/games/${statusTarget.id}/status`, {
        method: "POST",
        json: { action: statusTarget.action, reason: statusReason.trim() },
      });
      setToast(`Game "${statusTarget.name}" → ${statusTarget.action}d`);
      setStatusTarget(null);
      setStatusReason("");
      void qc.invalidateQueries({ queryKey: ["admin-games"] });
      void qc.invalidateQueries({ queryKey: ["games-summary"] });
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusTone = (s: string) => s === "active" ? "green" : s === "maintenance" ? "amber" : "red";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Game Management</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Manage game catalog, availability, and maintenance status.</p>
      </div>

      {/* Summary cards */}
      {summaryQ.isLoading || !summaryQ.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Total games", value: summaryQ.data.total, tone: "default" },
              { label: "Active", value: summaryQ.data.active, tone: "green" },
              { label: "Maintenance", value: summaryQ.data.maintenance, tone: "amber" },
              { label: "Disabled", value: summaryQ.data.disabled, tone: "red" },
              { label: "Pro games", value: summaryQ.data.isPro, tone: "violet" },
              { label: "Errors (24h)", value: summaryQ.data.errorGames24h, tone: "red" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
                <div className={`mt-1 text-2xl font-bold ${c.tone === "green" ? "text-emerald-600 dark:text-emerald-400" : c.tone === "amber" ? "text-amber-600 dark:text-amber-400" : c.tone === "red" ? "text-rose-600 dark:text-rose-400" : c.tone === "violet" ? "text-violet-600 dark:text-violet-400" : "text-slate-800 dark:text-slate-100"}`}>{c.value}</div>
              </div>
            ))}
          </div>
          {!summaryQ.data.hasGameCategories && <p className="text-xs text-slate-400">No game-category model in the current schema — games are organized by code + provider.</p>}
        </>
      )}

      <Card title={`Games (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={() => { void listQ.refetch(); void summaryQ.refetch(); }}>Refresh</Button>}>
        <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
          <Input placeholder="search name / code / id" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-56" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-32">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="disabled">Disabled</option>
          </Select>
          <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className="!w-40">
            <option value="">All providers</option>
            {(providersQ.data?.items ?? []).map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
          </Select>
          <Button variant="subtle" type="submit">Apply</Button>
          <Button variant="ghost" onClick={() => { setSearch(""); setStatusFilter(""); setProviderFilter(""); setPage(1); }}>Clear</Button>
        </form>

        {listQ.error ? <ErrorBox error={listQ.error} /> : null}
        {listQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : items.length === 0 ? (
          <Empty text="No games match the current filters." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-3">Game</th><th className="px-3">Code</th><th className="px-3">Status</th>
                    <th className="px-3">Provider</th><th className="px-3 text-right">Configs</th>
                    <th className="px-3 text-right">Sessions</th><th className="pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((g) => (
                    <tr key={g.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          {g.thumbnailUrl ? <img src={g.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 dark:bg-slate-700"><Icon name="joystick" className="h-4 w-4 text-slate-400" /></span>}
                          <div>
                            <div className="font-medium text-slate-800 dark:text-slate-100">{g.name}</div>
                            <div className="text-xs text-slate-400">#{g.id} · v{g.version}{g.isPro && " · PRO"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 font-mono text-xs text-slate-500 dark:text-slate-400">{g.code}</td>
                      <td className="px-3"><Badge tone={statusTone(g.status) as "green" | "amber" | "red"}>{g.status}</Badge></td>
                      <td className="px-3">{g.provider ? <span className={g.provider.enabled ? "" : "text-rose-500"}>{g.provider.name}</span> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 text-right tabular-nums">{g.configCount}</td>
                      <td className="px-3 text-right tabular-nums">{g.sessionCount}</td>
                      <td className="pl-3 text-right whitespace-nowrap">
                        {canWrite && g.status !== "active" && <Button variant="ghost" onClick={() => { setStatusTarget({ id: g.id, name: g.name, currentStatus: g.status, action: "activate" }); }}>Activate</Button>}
                        {canWrite && g.status === "active" && <Button variant="ghost" onClick={() => { setStatusTarget({ id: g.id, name: g.name, currentStatus: g.status, action: "maintenance" }); }}>Maintenance</Button>}
                        {canWrite && g.status !== "disabled" && <Button variant="ghost" onClick={() => { setStatusTarget({ id: g.id, name: g.name, currentStatus: g.status, action: "disable" }); }}>Disable</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {items.map((g) => (
                <div key={g.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800 dark:text-slate-100">{g.name}</div>
                      <div className="text-xs text-slate-400">#{g.id} · {g.code}</div>
                    </div>
                    <Badge tone={statusTone(g.status) as "green" | "amber" | "red"}>{g.status}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div>Provider: {g.provider?.name ?? "—"}</div>
                    <div>Configs: {g.configCount}</div>
                    <div>Sessions: {g.sessionCount}</div>
                  </div>
                  {canWrite && (
                    <div className="mt-2 flex justify-end gap-2">
                      {g.status !== "active" && <Button variant="ghost" onClick={() => setStatusTarget({ id: g.id, name: g.name, currentStatus: g.status, action: "activate" })}>Activate</Button>}
                      {g.status === "active" && <Button variant="ghost" onClick={() => setStatusTarget({ id: g.id, name: g.name, currentStatus: g.status, action: "maintenance" })}>Maintenance</Button>}
                      {g.status !== "disabled" && <Button variant="ghost" onClick={() => setStatusTarget({ id: g.id, name: g.name, currentStatus: g.status, action: "disable" })}>Disable</Button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">page {page} / {pages} · {total.toLocaleString()} total</span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
                <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Status change dialog */}
      <Modal open={statusTarget !== null} title={`${statusTarget?.action ?? ""} — ${statusTarget?.name ?? ""}`} onClose={() => { setStatusTarget(null); setStatusReason(""); }}>
        <div className="space-y-3">
          <div className={`rounded-lg p-2 text-xs ${statusTarget?.action === "disable" ? "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" : statusTarget?.action === "maintenance" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"}`}>
            <strong>Consequence:</strong> {statusTarget?.action === "disable" ? "New game launches will be rejected by the backend launchGame service. Existing sessions are NOT terminated." : statusTarget?.action === "maintenance" ? "New game launches will be rejected. Existing sessions continue normally." : "Game becomes available for new launches."}
          </div>
          <label className="block text-sm">Reason <span className="text-rose-500">*</span>
            <Input value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="required — recorded in audit log" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => { setStatusTarget(null); setStatusReason(""); }}>Cancel</Button>
            <Button variant={statusTarget?.action === "disable" ? "danger" : "primary"} disabled={busy || statusReason.trim().length < 1} onClick={handleStatusChange}>
              {busy ? "Applying…" : `Confirm ${statusTarget?.action ?? ""}`}
            </Button>
          </div>
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
          <button type="button" className="ml-3 text-slate-300 hover:text-white" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}
