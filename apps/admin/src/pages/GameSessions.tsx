/**
 * SM Live — Game Sessions monitoring page (Prompt 06).
 *
 * Paginated session list with filters (game, user, status, provider).
 * Read-only — no session termination (not supported by the existing backend).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, Button, Card, Empty, ErrorBox, Input, Select, Skeleton } from "../components/ui";
import { Link } from "react-router-dom";

interface SessionRow {
  id: number; sessionKey: string; userId: number; displayName: string;
  gameId: number; gameCode: string; gameName: string;
  providerId: number | null; providerName: string | null;
  marketCode: string; status: "open" | "closed";
  openedAt: string; closedAt: string | null;
}
interface SessionsList { total: number; page: number; pageSize: number; items: SessionRow[]; }

export function GameSessions() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const qs = (() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    if (search) p.set("search", search);
    if (statusFilter) p.set("status", statusFilter);
    return p.toString();
  })();

  const listQ = useQuery({
    queryKey: ["admin-sessions", qs],
    queryFn: () => api<SessionsList>(`/v1/admin/sessions?${qs}`),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Game Sessions</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Monitor active and historical game launch sessions.</p>
      </div>

      <Card title={`Sessions (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={() => void listQ.refetch()}>Refresh</Button>}>
        <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
          <Input placeholder="search session key" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-56" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-32">
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </Select>
          <Button variant="subtle" type="submit">Apply</Button>
          <Button variant="ghost" onClick={() => { setSearch(""); setStatusFilter(""); setPage(1); }}>Clear</Button>
        </form>

        {listQ.error ? <ErrorBox error={listQ.error} /> : null}
        {listQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : items.length === 0 ? (
          <Empty text="No sessions found." />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-3">Session</th><th className="px-3">Player</th><th className="px-3">Game</th>
                    <th className="px-3">Provider</th><th className="px-3">Status</th>
                    <th className="px-3">Opened</th><th className="px-3">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 pr-3">
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]">{s.sessionKey}</div>
                        <div className="text-xs text-slate-400">#{s.id} · {s.marketCode}</div>
                      </td>
                      <td className="px-3"><Link to={`/users/${s.userId}`} className="text-violet-600 hover:underline dark:text-violet-300">{s.displayName}</Link></td>
                      <td className="px-3">{s.gameName} <span className="font-mono text-xs text-slate-400">({s.gameCode})</span></td>
                      <td className="px-3 text-slate-500 dark:text-slate-400">{s.providerName ?? "—"}</td>
                      <td className="px-3"><Badge tone={s.status === "open" ? "green" : "slate"}>{s.status}</Badge></td>
                      <td className="px-3 text-xs text-slate-400">{s.openedAt.slice(0, 19).replace("T", " ")}</td>
                      <td className="px-3 text-xs text-slate-400">{s.closedAt ? s.closedAt.slice(0, 19).replace("T", " ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-2 md:hidden">
              {items.slice(0, 20).map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div><div className="font-medium text-slate-800 dark:text-slate-100">{s.gameName}</div><div className="text-xs text-slate-400">#{s.id} · {s.displayName}</div></div>
                    <Badge tone={s.status === "open" ? "green" : "slate"}>{s.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">Provider: {s.providerName ?? "—"} · Opened: {s.openedAt.slice(0, 19).replace("T", " ")}</div>
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
    </div>
  );
}
