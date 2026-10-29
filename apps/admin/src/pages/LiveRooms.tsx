/**
 * SM Live — Super Admin Live Room Monitoring page (Prompt 05).
 *
 * Replaces the minimal Rooms tab in LiveVoice with a full monitoring system:
 *   - Summary cards (active live/voice/party, total participants, open reports)
 *   - Filtered + paginated room table (search, type, status, reports filter)
 *   - Per-row actions (View details, Close room)
 *   - Mobile card layout
 *   - CSV export
 *   - Polling refresh (15s) + manual refresh with last-updated timestamp
 *
 * Backend perms:
 *   - rooms.read  — view the page (enforced by App.tsx RequirePerm + API route)
 *   - rooms.write — close rooms, kick/mute, manage reports
 *
 * Real-time approach: polling (15s). The existing socket.io uses user JWT
 * auth — admin socket subscriptions would need a separate auth path. Manual
 * refresh is always available. The `hasRealtimePresence: false` flag from
 * the API response is surfaced in the UI.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, getToken } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, ErrorBox, Skeleton } from "../components/ui";
import {
  CloseRoomDialog,
  DEFAULT_ROOM_FILTERS,
  RoomFiltersBar,
  RoomStatusBadge,
  RoomTypeBadge,
  type RoomFilters,
} from "../components/live";

interface RoomRow {
  id: number;
  title: string;
  type: string;
  slots: number;
  country: string;
  hostId: number;
  host: { id: number; displayName: string; avatarUrl: string };
  isLocked: boolean;
  closedAt: string | null;
  status: "active" | "closed";
  participantCount: number;
  openReportCount: number;
  createdAt: string;
}

interface RoomsList { total: number; page: number; pageSize: number; items: RoomRow[]; }
interface Summary {
  activeLiveRooms: number; activeVoiceRooms: number; activePartyRooms: number;
  totalActiveRooms: number; totalParticipants: number; openReports: number;
  hasRealtimePresence: boolean; hasStreamHealthMetrics: boolean;
}

export function LiveRooms() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<RoomFilters>(DEFAULT_ROOM_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<RoomFilters>(DEFAULT_ROOM_FILTERS);
  const [page, setPage] = useState(1);
  const [closeTarget, setCloseTarget] = useState<{ id: number; title: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const canWrite = can("rooms.write");

  const summaryQ = useQuery({
    queryKey: ["rooms-summary"],
    queryFn: () => api<Summary>("/v1/admin/rooms/summary"),
    refetchInterval: 15_000,
  });

  const listQs = (() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(appliedFilters.pageSize));
    if (appliedFilters.search) p.set("search", appliedFilters.search);
    if (appliedFilters.type) p.set("type", appliedFilters.type);
    if (appliedFilters.status) p.set("status", appliedFilters.status);
    if (appliedFilters.hasReports) p.set("hasReports", appliedFilters.hasReports);
    if (appliedFilters.createdFrom) p.set("createdFrom", appliedFilters.createdFrom);
    if (appliedFilters.createdTo) p.set("createdTo", appliedFilters.createdTo);
    return p.toString();
  })();

  const listQ = useQuery({
    queryKey: ["admin-rooms", listQs],
    queryFn: () => api<RoomsList>(`/v1/admin/rooms?${listQs}`),
    refetchInterval: 15_000,
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / appliedFilters.pageSize));
  const updatedAt = listQ.dataUpdatedAt ? new Date(listQ.dataUpdatedAt).toLocaleTimeString() : "—";

  const applyFilters = () => { setPage(1); setAppliedFilters(filters); };
  const clearFilters = () => { setFilters(DEFAULT_ROOM_FILTERS); setAppliedFilters(DEFAULT_ROOM_FILTERS); setPage(1); };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (appliedFilters.search) params.set("search", appliedFilters.search);
    if (appliedFilters.type) params.set("type", appliedFilters.type);
    if (appliedFilters.status) params.set("status", appliedFilters.status);
    const url = `${API_BASE}/v1/admin/rooms/export?${params.toString()}`;
    void fetch(url, { headers: { authorization: `Bearer ${getToken() ?? ""}` } })
      .then((r) => { if (!r.ok) throw new Error(`export failed: ${r.status}`); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `rooms-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => setToast((e as Error).message));
  };

  const handleClose = async (reason: string) => {
    if (!closeTarget) return;
    await api(`/v1/admin/rooms/${closeTarget.id}/close`, { method: "POST", json: { reason } });
    setToast(`Room "${closeTarget.title}" closed`);
    void qc.invalidateQueries({ queryKey: ["admin-rooms"] });
    void qc.invalidateQueries({ queryKey: ["rooms-summary"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Live Room Monitoring</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Monitor active rooms, participants, reports, and moderation actions.</p>
        </div>
        <div className="text-right text-xs text-slate-400">
          <div>Auto-refresh: 15s</div>
          <div>Last updated: {updatedAt}</div>
        </div>
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
              { label: "Active rooms", value: summaryQ.data.totalActiveRooms, tone: "default" },
              { label: "Live rooms", value: summaryQ.data.activeLiveRooms, tone: "red" },
              { label: "Voice rooms", value: summaryQ.data.activeVoiceRooms, tone: "violet" },
              { label: "Party rooms", value: summaryQ.data.activePartyRooms, tone: "amber" },
              { label: "Participants", value: summaryQ.data.totalParticipants, tone: "default" },
              { label: "Open reports", value: summaryQ.data.openReports, tone: "amber" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
                <div className={`mt-1 text-2xl font-bold ${c.tone === "red" ? "text-rose-600 dark:text-rose-400" : c.tone === "violet" ? "text-violet-600 dark:text-violet-400" : c.tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-slate-800 dark:text-slate-100"}`}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>
          {!summaryQ.data.hasRealtimePresence && (
            <p className="text-xs text-slate-400">
              No real-time presence infrastructure — participant counts reflect last-known database state. Stream-health metrics are not available.
            </p>
          )}
        </>
      )}

      <Card title={`Rooms (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={() => { void listQ.refetch(); void summaryQ.refetch(); }}>Refresh</Button>}>
        <RoomFiltersBar
          filters={filters}
          onChange={setFilters}
          onApply={applyFilters}
          onClear={clearFilters}
          canExport={can("rooms.read")}
          onExport={handleExport}
        />
        {listQ.error ? <ErrorBox error={listQ.error} /> : null}
        {listQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : items.length === 0 ? (
          <Empty text="No rooms match the current filters." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-3">Room</th><th className="px-3">Type</th><th className="px-3">Status</th>
                    <th className="px-3 text-right">Participants</th><th className="px-3 text-right">Reports</th>
                    <th className="px-3">Host</th><th className="px-3">Created</th><th className="pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-800 dark:text-slate-100">{r.title}</div>
                        <div className="text-xs text-slate-400">#{r.id} · {r.country} · {r.slots} slots{r.isLocked && " · 🔒"}</div>
                      </td>
                      <td className="px-3"><RoomTypeBadge type={r.type} /></td>
                      <td className="px-3"><RoomStatusBadge status={r.status} /></td>
                      <td className="px-3 text-right tabular-nums">{r.participantCount}</td>
                      <td className="px-3 text-right tabular-nums">{r.openReportCount > 0 ? <Badge tone="amber">{r.openReportCount}</Badge> : "—"}</td>
                      <td className="px-3 text-slate-500 dark:text-slate-400">{r.host?.displayName ?? "—"}</td>
                      <td className="px-3 text-xs text-slate-400">{r.createdAt.slice(0, 19).replace("T", " ")}</td>
                      <td className="pl-3 text-right whitespace-nowrap">
                        <Button variant="ghost" onClick={() => navigate(`/live/${r.id}`)}>View</Button>
                        {canWrite && r.status === "active" && <Button variant="ghost" onClick={() => setCloseTarget({ id: r.id, title: r.title })}>Close</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {items.map((r) => (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800 dark:text-slate-100">{r.title}</div>
                      <div className="text-xs text-slate-400">#{r.id} · {r.host?.displayName ?? "—"}</div>
                    </div>
                    <div className="flex gap-1"><RoomTypeBadge type={r.type} /><RoomStatusBadge status={r.status} /></div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div>Participants: {r.participantCount}</div>
                    <div>Reports: {r.openReportCount}</div>
                    <div>{r.createdAt.slice(0, 10)}</div>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => navigate(`/live/${r.id}`)}>View</Button>
                    {canWrite && r.status === "active" && <Button variant="ghost" onClick={() => setCloseTarget({ id: r.id, title: r.title })}>Close</Button>}
                  </div>
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

      <CloseRoomDialog
        open={closeTarget !== null}
        roomTitle={closeTarget?.title ?? ""}
        onClose={() => setCloseTarget(null)}
        onConfirm={handleClose}
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
          <button type="button" className="ml-3 text-slate-300 hover:text-white" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}
