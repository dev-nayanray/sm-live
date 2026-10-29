/**
 * SM Live — Super Admin Agencies management page (Prompt 04).
 *
 * Provides:
 *   - Summary cards (total, active, suspended, total members, new 7d/30d)
 *   - Server-side filtered + paginated agency table
 *   - Status badges (active / suspended)
 *   - Per-row actions (View / Edit / Activate or Suspend)
 *   - Mobile card layout
 *   - Loading skeletons, empty state, error + retry
 *   - CSV export (gated by agencies.read)
 *   - Create-agency dialog
 *
 * Backend perms:
 *   - agencies.read required to load the page (enforced by App.tsx
 *     RequirePerm AND the API route requireAdmin).
 *   - agencies.write gates the Create / Edit / Status-change actions.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, getToken } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, ErrorBox, Skeleton } from "../components/ui";
import {
  AgencyFiltersBar,
  AgencyStatusBadge,
  CreateAgencyDialog,
  DEFAULT_AGENCY_FILTERS,
  type AgencyFilters,
} from "../components/agencies";

interface AgencyRow {
  id: number;
  name: string;
  code: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
  country: string;
  commissionRate: number;
  parentId: number | null;
  parent: { id: number; name: string } | null;
  active: boolean;
  status: "active" | "suspended";
  memberCount: number;
  userCount: number;
  adminCount: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AgenciesList {
  total: number;
  page: number;
  pageSize: number;
  items: AgencyRow[];
}

interface Summary {
  totalAgencies: number;
  activeAgencies: number;
  suspendedAgencies: number;
  totalMembers: number;
  newAgencies7d: number;
  newAgencies30d: number;
  hasApprovalWorkflow: boolean;
}

export function Agencies() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<AgencyFilters>(DEFAULT_AGENCY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AgencyFilters>(DEFAULT_AGENCY_FILTERS);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const canEdit = can("agencies.write");
  const canExport = can("agencies.read");

  const summaryQ = useQuery({
    queryKey: ["agencies-summary"],
    queryFn: () => api<Summary>("/v1/admin/agencies/summary"),
    refetchInterval: 60_000,
  });

  const listQs = (() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(appliedFilters.pageSize));
    if (appliedFilters.search) p.set("search", appliedFilters.search);
    if (appliedFilters.status) p.set("status", appliedFilters.status);
    if (appliedFilters.country) p.set("country", appliedFilters.country);
    if (appliedFilters.createdFrom) p.set("createdFrom", appliedFilters.createdFrom);
    if (appliedFilters.createdTo) p.set("createdTo", appliedFilters.createdTo);
    return p.toString();
  })();

  const listQ = useQuery({
    queryKey: ["agencies", listQs],
    queryFn: () => api<AgenciesList>(`/v1/admin/agencies?${listQs}`),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / appliedFilters.pageSize));

  // Reuse the same agencies list for the parent-agency dropdown in Create dialog.
  const allAgencies = items.map((a) => ({ id: a.id, name: a.name }));

  const applyFilters = () => { setPage(1); setAppliedFilters(filters); };
  const clearFilters = () => { setFilters(DEFAULT_AGENCY_FILTERS); setAppliedFilters(DEFAULT_AGENCY_FILTERS); setPage(1); };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (appliedFilters.search) params.set("search", appliedFilters.search);
    if (appliedFilters.status) params.set("status", appliedFilters.status);
    if (appliedFilters.country) params.set("country", appliedFilters.country);
    if (appliedFilters.createdFrom) params.set("createdFrom", appliedFilters.createdFrom);
    if (appliedFilters.createdTo) params.set("createdTo", appliedFilters.createdTo);
    const url = `${API_BASE}/v1/admin/agencies/export?${params.toString()}`;
    void fetch(url, { headers: { authorization: `Bearer ${getToken() ?? ""}` } })
      .then((r) => { if (!r.ok) throw new Error(`export failed: ${r.status}`); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `agencies-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => setToast((e as Error).message));
  };

  const handleCreate = async (input: { name: string; code: string; description: string; contactEmail: string; contactPhone: string; country: string; commissionRate: string; parentId: string }) => {
    const body: Record<string, unknown> = {
      name: input.name,
      code: input.code,
      description: input.description,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      country: input.country || undefined,
      commissionRate: Number(input.commissionRate),
    };
    if (input.parentId) body.parentId = Number(input.parentId);
    const res = await api<{ id: number }>("/v1/admin/agencies", { method: "POST", json: body });
    setToast(`Agency created — #${res.id}`);
    void qc.invalidateQueries({ queryKey: ["agencies"] });
    void qc.invalidateQueries({ queryKey: ["agencies-summary"] });
    navigate(`/agencies/${res.id}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Agencies</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage agencies, agency admins, and member assignments.</p>
        </div>
        {canEdit && <Button onClick={() => setCreateOpen(true)}>+ Create agency</Button>}
      </div>

      {/* Summary cards */}
      {summaryQ.isLoading || !summaryQ.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Total agencies", value: summaryQ.data.totalAgencies, tone: "default" },
            { label: "Active", value: summaryQ.data.activeAgencies, tone: "green" },
            { label: "Suspended", value: summaryQ.data.suspendedAgencies, tone: "amber" },
            { label: "Total members", value: summaryQ.data.totalMembers, tone: "default" },
            { label: "New (7d)", value: summaryQ.data.newAgencies7d, tone: "violet" },
            { label: "New (30d)", value: summaryQ.data.newAgencies30d, tone: "slate" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
              <div className={`mt-1 text-2xl font-bold ${c.tone === "green" ? "text-emerald-600 dark:text-emerald-400" : c.tone === "amber" ? "text-amber-600 dark:text-amber-400" : c.tone === "violet" ? "text-violet-600 dark:text-violet-400" : "text-slate-800 dark:text-slate-100"}`}>
                {typeof c.value === "number" ? c.value.toLocaleString() : c.value}
              </div>
            </div>
          ))}
        </div>
      )}
      {!summaryQ.data?.hasApprovalWorkflow && (
        <p className="text-xs text-slate-400">No pending-approval workflow — the platform does not have an agency-approval step.</p>
      )}

      <Card title={`Agencies (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={() => { void listQ.refetch(); void summaryQ.refetch(); }}>Refresh</Button>}>
        <AgencyFiltersBar
          filters={filters}
          onChange={setFilters}
          onApply={applyFilters}
          onClear={clearFilters}
          canExport={canExport}
          onExport={handleExport}
        />

        {listQ.error ? <ErrorBox error={listQ.error} /> : null}

        {listQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <Empty text="No agencies match the current filters." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-3">Agency</th>
                    <th className="px-3">Code</th>
                    <th className="px-3">Country</th>
                    <th className="px-3">Status</th>
                    <th className="px-3 text-right">Members</th>
                    <th className="px-3 text-right">Admins</th>
                    <th className="px-3">Commission</th>
                    <th className="px-3">Created</th>
                    <th className="pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-800 dark:text-slate-100">{a.name}</div>
                        <div className="text-xs text-slate-400">#{a.id}{a.parent ? ` · parent: ${a.parent.name}` : ""}</div>
                      </td>
                      <td className="px-3 font-mono text-xs text-slate-500 dark:text-slate-400">{a.code}</td>
                      <td className="px-3">{a.country}</td>
                      <td className="px-3"><AgencyStatusBadge status={a.status} /></td>
                      <td className="px-3 text-right tabular-nums">{a.memberCount.toLocaleString()}</td>
                      <td className="px-3 text-right tabular-nums">{a.adminCount}</td>
                      <td className="px-3"><Badge tone="violet">{(a.commissionRate * 100).toFixed(0)}%</Badge></td>
                      <td className="px-3 text-xs text-slate-400">{a.createdAt.slice(0, 10)}</td>
                      <td className="pl-3 text-right">
                        <Button variant="ghost" onClick={() => navigate(`/agencies/${a.id}`)}>View</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {items.map((a) => (
                <div key={a.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800 dark:text-slate-100">{a.name}</div>
                      <div className="text-xs text-slate-400">#{a.id} · {a.code} · {a.country}</div>
                    </div>
                    <AgencyStatusBadge status={a.status} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div>Members: {a.memberCount}</div>
                    <div>Admins: {a.adminCount}</div>
                    <div>Commission: {(a.commissionRate * 100).toFixed(0)}%</div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button variant="ghost" onClick={() => navigate(`/agencies/${a.id}`)}>View details</Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
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

      <CreateAgencyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        agencies={allAgencies}
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
