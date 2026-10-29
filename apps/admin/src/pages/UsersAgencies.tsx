/**
 * SM Live — Super Admin Users & Players management page (Prompt 03).
 *
 * Provides:
 *   - Summary cards (total users, active, restricted, banned, new 7d/30d)
 *   - Server-side filtered + paginated user table
 *   - Status badges derived from live PlayerRestriction records
 *   - Per-row actions (view / edit / restrict / wallet)
 *   - Mobile card layout
 *   - Loading skeletons, empty state, error + retry
 *   - CSV export (gated by users.read; balance column gated by wallet.read)
 *
 * Backend perms:
 *   - users.read required to load the page (enforced by App.tsx RequirePerm
 *     AND the API route requireAdmin).
 *   - wallet.read gates the Balance column (returns null otherwise).
 *   - players.read gates unmasked phone/email (returns masked otherwise).
 *   - users.write gates the Edit + Add-note actions.
 *   - players.write gates the Restrict action.
 *   - wallet.write gates the Wallet actions (kept for back-compat with the
 *     existing /recharge and /adjust endpoints).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE, getToken } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, Skeleton } from "../components/ui";
import { ResourceTable } from "../components/Resource";
import {
  Avatar,
  DEFAULT_FILTERS,
  EditUserDialog,
  RestrictionDialog,
  UserActionMenu,
  UserFiltersBar,
  UserStatusBadge,
  buildExportUrl,
  type UserFilters,
} from "../components/users";

interface UserRow {
  id: number;
  displayName: string;
  avatarUrl: string;
  phone: string | null;
  email: string | null;
  marketCode: string;
  country: string;
  vipLevel: number;
  nobleLevel: number;
  balance: number | null;
  walletFrozen: boolean;
  agencyId: number | null;
  agency: string | null;
  status: "active" | "restricted" | "banned" | "muted" | "frozen";
  restrictions: { type: string; reason: string; expiresAt: string | null }[];
  createdAt: string;
}

interface UsersList {
  total: number;
  page: number;
  pageSize: number;
  items: UserRow[];
}

interface Summary {
  totalUsers: number;
  active: number;
  restricted: number;
  banned: number;
  muted: number;
  frozen: number;
  newUsers7d: number;
  newUsers30d: number;
}

interface AgencyNode {
  id: number;
  name: string;
  code: string;
  commissionRate: number;
  parentId: number | null;
  _count?: { users: number; children: number };
  parent?: { name: string } | null;
  userCount?: number;
  children?: AgencyNode[];
}

export function UsersAgencies() {
  const [tab, setTab] = useState<"users" | "agencies" | "country" | "restrictions">("users");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Users &amp; Agencies</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["users", "Users"], ["agencies", "Agency tree & commission"], ["country", "Country filters"], ["restrictions", "Restrictions"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>
            {l}
          </Button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "agencies" && <AgenciesTab />}
      {tab === "country" && <Card title="Country filters (per market)"><ResourceTable resource="country-filters" readPerm="settings.read" writePerm="settings.write" /></Card>}
      {tab === "restrictions" && <Card title="Player restrictions"><ResourceTable resource="restrictions" readPerm="players.read" writePerm="players.write" /></Card>}
    </div>
  );
}

// --------------------------------------------------------------------------
// Summary cards
// --------------------------------------------------------------------------
function SummaryCards({ data, loading }: { data: Summary | undefined; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  const cards: { label: string; value: number | string; tone?: "green" | "amber" | "red" | "violet" | "slate" }[] = [
    { label: "Total users", value: data.totalUsers },
    { label: "Active", value: data.active, tone: "green" },
    { label: "Restricted", value: data.restricted, tone: "amber" },
    { label: "Banned", value: data.banned, tone: "red" },
    { label: "Wallet frozen", value: data.frozen, tone: "violet" },
    { label: "New (7d)", value: data.newUsers7d, tone: "slate" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
          <div className={`mt-1 text-2xl font-bold ${c.tone === "green" ? "text-emerald-600 dark:text-emerald-400" : c.tone === "amber" ? "text-amber-600 dark:text-amber-400" : c.tone === "red" ? "text-rose-600 dark:text-rose-400" : c.tone === "violet" ? "text-violet-600 dark:text-violet-400" : "text-slate-800 dark:text-slate-100"}`}>
            {typeof c.value === "number" ? c.value.toLocaleString() : c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
// Users tab
// --------------------------------------------------------------------------
function UsersTab() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<UserFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<UserFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [restrictTarget, setRestrictTarget] = useState<{ id: number; displayName: string } | null>(null);
  const [walletTarget, setWalletTarget] = useState<UserRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const canExport = can("users.read");
  const canEdit = can("users.write");
  const canRestrict = can("players.write");
  const canWalletWrite = can("wallet.write");
  const canViewWallet = can("wallet.read");

  // Summary
  const summaryQ = useQuery({
    queryKey: ["users-summary"],
    queryFn: () => api<Summary>("/v1/admin/users/summary"),
    refetchInterval: 60_000,
  });

  // Agencies (for the filter dropdown)
  const agenciesQ = useQuery({
    queryKey: ["agencies-flat"],
    queryFn: () => api<AgencyNode[]>("/v1/admin/agencies"),
    staleTime: 5 * 60_000,
  });
  const agencies = (agenciesQ.data ?? []).map((a) => ({ id: a.id, name: a.name }));

  // Build the query string for the list endpoint.
  const listQs = (() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("pageSize", String(appliedFilters.pageSize));
    if (appliedFilters.search) p.set("search", appliedFilters.search);
    if (appliedFilters.status) p.set("status", appliedFilters.status);
    if (appliedFilters.country) p.set("country", appliedFilters.country);
    if (appliedFilters.agencyId) p.set("agencyId", appliedFilters.agencyId);
    if (appliedFilters.registeredFrom) p.set("registeredFrom", appliedFilters.registeredFrom);
    if (appliedFilters.registeredTo) p.set("registeredTo", appliedFilters.registeredTo);
    return p.toString();
  })();

  const listQ = useQuery({
    queryKey: ["admin-users", listQs],
    queryFn: () => api<UsersList>(`/v1/admin/users?${listQs}`),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / appliedFilters.pageSize));

  const applyFilters = () => {
    setPage(1);
    setAppliedFilters(filters);
  };
  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const handleExport = () => {
    // Trigger a browser download with the auth header attached via fetch.
    const url = `${API_BASE}${buildExportUrl(appliedFilters)}`;
    void fetch(url, { headers: { authorization: `Bearer ${getToken() ?? ""}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`export failed: ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `users-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e) => setToast((e as Error).message));
  };

  const handleRestrict = async (input: { type: "ban" | "mute" | "freeze_wallet" | "kick"; reason: string; durationDays: string; note: string }) => {
    if (!restrictTarget) return;
    const days = input.durationDays ? Number(input.durationDays) : undefined;
    await api(`/v1/admin/users/${restrictTarget.id}/restrict`, {
      method: "POST",
      json: { type: input.type, reason: input.reason, ...(days ? { durationDays: days } : {}), note: input.note },
    });
    setToast(`Restriction applied to ${restrictTarget.displayName}`);
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
    void qc.invalidateQueries({ queryKey: ["users-summary"] });
  };

  const handleEdit = async (input: { displayName: string; country: string; agencyId: number | null; vipLevel: number; nobleLevel: number; avatarUrl: string }) => {
    if (!editTarget) return;
    await api(`/v1/admin/users/${editTarget.id}`, {
      method: "PUT",
      json: input,
    });
    setToast(`Profile updated for ${editTarget.displayName}`);
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  return (
    <div className="space-y-4">
      <SummaryCards data={summaryQ.data} loading={summaryQ.isLoading} />

      <Card title={`Users (${total.toLocaleString()})`} actions={<Button variant="ghost" onClick={() => { void listQ.refetch(); void summaryQ.refetch(); }}>Refresh</Button>}>
        <UserFiltersBar
          filters={filters}
          onChange={setFilters}
          onApply={applyFilters}
          onClear={clearFilters}
          agencies={agencies}
          canExport={canExport}
          onExport={handleExport}
        />

        {listQ.error ? <ErrorBox error={listQ.error} /> : null}

        {listQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty text="No users match the current filters." />
        ) : (
          <>
            {/* Desktop / tablet table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-3">User</th>
                    <th className="px-3">Contact</th>
                    <th className="px-3">Country</th>
                    <th className="px-3">Status</th>
                    <th className="px-3">Agency</th>
                    {canViewWallet && <th className="px-3 text-right">Balance</th>}
                    <th className="px-3">Joined</th>
                    <th className="pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={u.displayName} url={u.avatarUrl || undefined} size={28} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800 dark:text-slate-100">{u.displayName}</div>
                            <div className="text-xs text-slate-400">#{u.id}{u.vipLevel > 0 && ` · VIP${u.vipLevel}`}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 text-slate-500 dark:text-slate-400">
                        <div className="text-xs">{u.phone ?? "—"}</div>
                        <div className="text-xs">{u.email ?? "—"}</div>
                      </td>
                      <td className="px-3">{u.country}</td>
                      <td className="px-3"><UserStatusBadge status={u.status} /></td>
                      <td className="px-3 text-slate-500 dark:text-slate-400">{u.agency ?? "—"}</td>
                      {canViewWallet && (
                        <td className="px-3 text-right tabular-nums">
                          {u.balance == null ? "—" : <span className={u.walletFrozen ? "text-violet-600 dark:text-violet-400" : ""}>{u.balance.toLocaleString()}</span>}
                          {u.walletFrozen && <Badge tone="violet">frozen</Badge>}
                        </td>
                      )}
                      <td className="px-3 text-xs text-slate-400">{u.createdAt.slice(0, 10)}</td>
                      <td className="pl-3 text-right">
                        <UserActionMenu
                          canEdit={canEdit}
                          canRestrict={canRestrict}
                          canWalletWrite={canWalletWrite}
                          onView={() => navigate(`/users/${u.id}`)}
                          onEdit={() => setEditTarget(u)}
                          onRestrict={() => setRestrictTarget({ id: u.id, displayName: u.displayName })}
                          onWallet={() => setWalletTarget(u)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {items.map((u) => (
                <div key={u.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={u.displayName} url={u.avatarUrl || undefined} size={36} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-800 dark:text-slate-100">{u.displayName}</div>
                        <div className="text-xs text-slate-400">#{u.id} · {u.country}</div>
                      </div>
                    </div>
                    <UserStatusBadge status={u.status} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div>{u.phone ?? "no phone"}</div>
                    <div>{u.agency ?? "no agency"}</div>
                    {canViewWallet && <div>Balance: {u.balance == null ? "—" : u.balance.toLocaleString()}</div>}
                    <div>Joined: {u.createdAt.slice(0, 10)}</div>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => navigate(`/users/${u.id}`)}>View</Button>
                    {canEdit && <Button variant="ghost" onClick={() => setEditTarget(u)}>Edit</Button>}
                    {canRestrict && <Button variant="ghost" onClick={() => setRestrictTarget({ id: u.id, displayName: u.displayName })}>Restrict</Button>}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">
                page {page} / {pages} · {total.toLocaleString()} total
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
                <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <EditUserDialog
        open={editTarget !== null}
        user={editTarget}
        agencies={agencies}
        onClose={() => setEditTarget(null)}
        onSave={handleEdit}
      />
      <RestrictionDialog
        open={restrictTarget !== null}
        user={restrictTarget}
        onClose={() => setRestrictTarget(null)}
        onApply={handleRestrict}
      />
      {walletTarget && <WalletModal user={walletTarget} onClose={() => setWalletTarget(null)} onDone={() => { void qc.invalidateQueries({ queryKey: ["admin-users"] }); }} />}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
          <button type="button" className="ml-3 text-slate-300 hover:text-white" onClick={() => setToast(null)}>×</button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Wallet modal — kept from the original UsersAgencies, slightly tightened
// --------------------------------------------------------------------------
function WalletModal({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (path: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ balance: number }>(`/v1/admin/users/${user.id}/${path}`, {
        method: "POST",
        json: { amount: Number(amount), reason: reason || "admin action" },
      });
      setMsg(`done — new balance ${res.balance.toLocaleString()}`);
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Wallet — ${user.displayName} (${(user.balance ?? 0).toLocaleString()} 🪙)`} onClose={onClose}>
      <div className="flex gap-2 items-end">
        <label className="text-sm flex-1">Amount
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="text-sm flex-1">Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="note" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
      </div>
      {msg && <div className="text-sm text-violet-500 mt-3">{msg}</div>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" disabled={busy} onClick={() => void act("recharge")}>Recharge (agency panel)</Button>
        <Button disabled={busy} onClick={() => void act("adjust")}>Adjust balance</Button>
      </div>
      <p className="text-xs text-slate-400 mt-2">Both go through the ledger with an audit entry.</p>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Agencies tab — preserved from original
// --------------------------------------------------------------------------
function AgenciesTab() {
  const { can } = useAuth();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["agencies"], queryFn: () => api<AgencyNode[]>("/v1/admin/agencies") });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", commissionRate: "0.1", parentId: "" });
  if (isLoading) return <Loading />;
  const nodes = data ?? [];
  if (nodes.length === 0) return <Empty text="no agencies" />;

  return (
    <Card title="Agency tree" actions={can("agencies.write") ? <Button onClick={() => setCreating(!creating)}>+ New agency</Button> : undefined}>
      {creating && (
        <form className="flex flex-wrap gap-2 mb-4 items-end" onSubmit={async (e) => {
          e.preventDefault();
          await api("/v1/admin/agencies", {
            method: "POST",
            json: { name: form.name, code: form.code, commissionRate: Number(form.commissionRate), ...(form.parentId ? { parentId: Number(form.parentId) } : {}) },
          });
          setCreating(false);
          void refetch();
        }}>
          <label className="text-xs">name<br /><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
          <label className="text-xs">code<br /><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
          <label className="text-xs">commission<br /><input type="number" step="0.01" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
          <label className="text-xs">parent id<br /><input type="number" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900" /></label>
          <Button>Create</Button>
        </form>
      )}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
          <th className="py-2">Agency</th><th>Code</th><th>Parent</th><th>Commission</th><th>Users</th>
        </tr></thead>
        <tbody>
          {nodes.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 font-medium">{a.parentId ? <span className="text-slate-400 mr-1">└</span> : null}{a.name}</td>
              <td>{a.code}</td>
              <td>{a.parent?.name ?? "—"}</td>
              <td><Badge tone="violet">{(a.commissionRate * 100).toFixed(0)}%</Badge></td>
              <td>{a._count?.users ?? a.userCount ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
