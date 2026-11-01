/**
 * SM Live — Administration & Security pages.
 *
 * Dedicated consoles that previously only existed as tabs inside the
 * API & Security page:
 *   - Administrators: admin-user CRUD (/v1/admin/admin-users)
 *   - RolesPermissions: role list + per-role permission matrix (/v1/admin/roles PATCH)
 *   - AuditLogs: admin audit trail (/v1/admin/security/audit)
 *   - SecurityEvents: security event feed (/v1/admin/security-events)
 *   - IpAccess: API access keys / IP allow lists (resources api-access-keys)
 */
import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Input, Loading, Modal, Select } from "../components/ui";
import { ResourceTable } from "../components/Resource";

interface AdminUserRow {
  id: number; username: string; email: string; displayName: string;
  role: { key: string; name: string } | null; isActive: boolean; createdAt: string;
}
interface RoleRow { id: number; key: string; name: string; isSystem: boolean; permissions: { key: string }[] }
interface AuditRow { id: number; admin: { username: string } | null; action: string; entity: string; entityId: number; createdAt: string; before: unknown; after: unknown }
interface SecurityEventRow { id: number; kind: string; message: string; ip: string; createdAt: string }

export function Administrators() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AdminUserRow | null>(null);
  const [form, setForm] = useState({ username: "", email: "", displayName: "", password: "", roleKey: "viewer" });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<{ items: AdminUserRow[] }>("/v1/admin/admin-users?page=1&pageSize=100"),
  });
  const rolesQ = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<RoleRow[]>("/v1/admin/roles"),
  });

  const create = async () => {
    await api("/v1/admin/admin-users", { method: "POST", json: form });
    setCreating(false);
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
  };
  const remove = async () => {
    if (!deleting) return;
    await api(`/v1/admin/admin-users/${deleting.id}`, { method: "DELETE" });
    setDeleting(null);
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Administrator Management</h1>
      <p className="text-sm text-slate-400 mb-4">Back-office admin accounts and their roles.</p>
      <Card
        title={`Admin users (${items.length})`}
        actions={can("security.write") ? <Button onClick={() => setCreating(true)}>+ New admin</Button> : undefined}
      >
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no admins" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Admin</th><th>Role</th><th>Email</th><th>Status</th><th>Created</th>
              {can("security.write") && <th className="text-right">Action</th>}
            </tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><div className="font-medium">{a.displayName}</div><div className="text-xs text-slate-400">@{a.username}</div></td>
                  <td><Badge tone={a.role?.key === "super_admin" ? "violet" : "slate"}>{a.role?.name ?? a.role?.key ?? "—"}</Badge></td>
                  <td className="text-slate-500 dark:text-slate-400">{a.email}</td>
                  <td><Badge tone={a.isActive ? "green" : "red"}>{a.isActive ? "active" : "disabled"}</Badge></td>
                  <td className="text-xs text-slate-400">{a.createdAt.slice(0, 10)}</td>
                  {can("security.write") && (
                    <td className="text-right">
                      {a.role?.key !== "super_admin" && <Button variant="ghost" onClick={() => setDeleting(a)}>Remove</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={creating} title="Create admin user" onClose={() => setCreating(false)}>
        <div className="space-y-3">
          {([["username", "Username"], ["displayName", "Display name"], ["email", "Email"], ["password", "Password"]] as const).map(([k, label]) => (
            <label key={k} className="block text-sm">{label}
              <Input
                type={k === "password" ? "password" : "text"}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                className="w-full mt-1"
              />
            </label>
          ))}
          <label className="block text-sm">Role
            <Select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })} className="w-full mt-1">
              {(rolesQ.data ?? []).filter((r) => r.key !== "super_admin").map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button disabled={!form.username || !form.password} onClick={() => void create()}>Create</Button>
          </div>
        </div>
      </Modal>

      <Confirm open={deleting !== null} text={`Remove admin @${deleting?.username ?? ""}?`} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
    </div>
  );
}

export function RolesPermissions() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<RoleRow[]>("/v1/admin/roles"),
  });
  const permsQ = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api<{ key: string; description: string }[]>("/v1/admin/permissions"),
  });

  const save = async () => {
    if (!editing) return;
    await api(`/v1/admin/roles/${editing.key}`, { method: "PATCH", json: { permissions: selected } });
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["roles"] });
  };

  if (isLoading) return <Loading />;
  const roles = data ?? [];
  const perms = permsQ.data ?? [];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Roles &amp; Permissions</h1>
      <p className="text-sm text-slate-400 mb-4">RBAC roles and their permission grants. System roles can be edited except super_admin.</p>
      <Card title={`Roles (${roles.length})`}>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
            <th className="py-2">Role</th><th>Key</th><th>Permissions</th><th>Type</th>{can("security.write") && <th className="text-right">Action</th>}
          </tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 font-medium">{r.name}</td>
                <td className="font-mono text-xs text-slate-400">{r.key}</td>
                <td><Badge tone="violet">{r.permissions.length} granted</Badge></td>
                <td>{r.isSystem ? <Badge tone="amber">system</Badge> : <Badge>custom</Badge>}</td>
                {can("security.write") && (
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      disabled={r.key === "super_admin"}
                      onClick={() => { setEditing(r); setSelected(r.permissions.map((p) => p.key)); }}
                    >
                      Edit
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={editing !== null} title={`Edit role — ${editing?.name ?? ""}`} onClose={() => setEditing(null)}>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {perms.map((p) => (
            <label key={p.key} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
              <input
                type="checkbox"
                checked={selected.includes(p.key)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, p.key] : selected.filter((k) => k !== p.key))}
              />
              <span className="font-mono text-xs">{p.key}</span>
              <span className="text-xs text-slate-400">{p.description}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={() => void save()}>Save {selected.length} permissions</Button>
        </div>
      </Modal>
    </div>
  );
}

export function AuditLogs() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, action],
    queryFn: () => api<{ total: number; items: AuditRow[] }>(
      `/v1/admin/security/audit?page=${page}&pageSize=20${action ? `&action=${encodeURIComponent(action)}` : ""}`
    ),
  });
  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Audit Logs</h1>
      <p className="text-sm text-slate-400 mb-4">Every admin write action with before/after payloads.</p>
      <Card
        title={`Audit trail (${data?.total.toLocaleString() ?? "…"})`}
        actions={
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
            <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="action filter" className="!w-40" />
          </form>
        }
      >
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no audit entries" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Admin</th><th>Action</th><th>Entity</th><th>Time</th><th />
            </tr></thead>
            <tbody>
              {items.map((a) => (
                <Fragment key={a.id}>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">@{a.admin?.username ?? "system"}</td>
                    <td><Badge>{a.action}</Badge></td>
                    <td className="text-slate-500 dark:text-slate-400">{a.entity} #{a.entityId}</td>
                    <td className="text-xs text-slate-400">{a.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="text-right">
                      <Button variant="ghost" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                        {expanded === a.id ? "Hide" : "Diff"}
                      </Button>
                    </td>
                  </tr>
                  {expanded === a.id && (
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td colSpan={5} className="p-3 bg-slate-50 dark:bg-slate-900">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <div className="font-semibold text-slate-400 mb-1">Before</div>
                            <pre className="overflow-x-auto rounded bg-white p-2 dark:bg-slate-800">{JSON.stringify(a.before, null, 1) ?? "null"}</pre>
                          </div>
                          <div>
                            <div className="font-semibold text-slate-400 mb-1">After</div>
                            <pre className="overflow-x-auto rounded bg-white p-2 dark:bg-slate-800">{JSON.stringify(a.after, null, 1) ?? "null"}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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

export function SecurityEvents() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["security-events", page, kind],
    queryFn: () => api<{ total: number; last24h: number; items: SecurityEventRow[] }>(
      `/v1/admin/security-events?page=${page}&pageSize=20${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`
    ),
    refetchInterval: 30_000,
  });
  const items = data?.items ?? [];
  const kinds = Array.from(new Set(items.map((i) => i.kind)));
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Security Events</h1>
      <p className="text-sm text-slate-400 mb-4">Failed logins, permission denials and other security signals.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        {[
          { label: "Events (24h)", value: data?.last24h ?? "…" },
          { label: "Total", value: data?.total ?? "…" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{typeof c.value === "number" ? c.value.toLocaleString() : c.value}</div>
          </div>
        ))}
      </div>
      <Card
        title="Event feed"
        actions={
          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value); setPage(1); }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="">All kinds</option>
            {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        }
      >
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no security events" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Kind</th><th>Message</th><th>IP</th><th>Time</th>
            </tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Badge tone="red">{e.kind}</Badge></td>
                  <td className="max-w-md truncate text-slate-500 dark:text-slate-400">{e.message}</td>
                  <td className="font-mono text-xs">{e.ip || "—"}</td>
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

export function IpAccess() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">IP Access Restrictions</h1>
      <p className="text-sm text-slate-400 mb-4">API access keys with their IP allow-lists — provider and back-office integrations.</p>
      <Card title="API access keys">
        <ResourceTable resource="api-access-keys" readPerm="security.read" writePerm="security.write" />
      </Card>
    </div>
  );
}
