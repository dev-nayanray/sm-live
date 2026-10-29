import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Input, Loading, Modal } from "../components/ui";
import { ResourceTable } from "../components/Resource";

interface AuditRow { id: number; action: string; entity: string; entityId: string | null; admin: { username: string } | null; ip: string; createdAt: string; before: unknown; after: unknown }
interface ApiErr { id: number; source: string; route: string; message: string; createdAt: string }
interface SecEvent { id: number; kind: string; message: string; ip: string; createdAt: string }
interface ServerStatus { uptimeSeconds: number; nodeVersion: string; platform: string; memoryMb: number; heapMb: number; pid: number; time: string }
interface Role { id: number; key: string; name: string; permissions: { permission: { key: string } }[] }

export function Security() {
  const [tab, setTab] = useState<"keys" | "errors" | "events" | "audit" | "status" | "roles">("keys");
  const tabs = [
    ["keys", "API keys & IP allow list"],
    ["errors", "API errors"],
    ["events", "Security log"],
    ["audit", "Audit trail"],
    ["status", "Server status"],
    ["roles", "Roles & permissions"],
  ] as const;
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">API &amp; Security</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map(([k, l]) => <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>)}
      </div>

      {tab === "keys" && <Card title="API access keys — provider keys with IP allow lists"><ResourceTable resource="api-access-keys" readPerm="security.read" writePerm="security.write" /></Card>}
      {tab === "errors" && <Table<ApiErr> url="/v1/admin/security/api-errors" header={["Source", "Route", "Message", "Time"]} row={(e) => (<>
        <td className="py-2">{e.source}</td><td className="font-mono text-xs">{e.route}</td><td>{e.message}</td>
        <td className="text-slate-400">{e.createdAt.slice(0, 19).replace("T", " ")}</td>
      </>)} />}
      {tab === "events" && <Table<SecEvent> url="/v1/admin/security/events" header={["Kind", "Message", "IP", "Time"]} row={(e) => (<>
        <td className="py-2"><Badge tone="red">{e.kind}</Badge></td><td>{e.message}</td><td className="font-mono text-xs">{e.ip}</td>
        <td className="text-slate-400">{e.createdAt.slice(0, 19).replace("T", " ")}</td>
      </>)} />}
      {tab === "audit" && <AuditTable />}
      {tab === "status" && <StatusTab />}
      {tab === "roles" && <RolesTab />}
    </div>
  );
}

function Table<T extends { id: number }>({ url, header, row }: { url: string; header: string[]; row: (r: T) => React.ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: [url], queryFn: () => api<{ items: T[] }>(`${url}?page=1&pageSize=50`) });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  if (items.length === 0) return <Card><Empty text="nothing recorded" /></Card>;
  return (
    <Card>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
          {header.map((h) => <th key={h} className="py-2">{h}</th>)}
        </tr></thead>
        <tbody>{items.map((r) => <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">{row(r)}</tr>)}</tbody>
      </table>
    </Card>
  );
}

function AuditTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["audit", page],
    queryFn: () => api<{ total: number; items: AuditRow[] }>(`/v1/admin/security/audit?page=${page}&pageSize=20`),
  });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  return (
    <Card title={`Admin audit trail (${data?.total ?? 0}) — every admin write lands here`}>
      {items.length === 0 ? <Empty text="no entries yet" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2">Admin</th><th>Action</th><th>Entity</th><th>ID</th><th>IP</th><th>Time</th>
          </tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2">{a.admin?.username ?? "system"}</td>
                <td><Badge tone="violet">{a.action}</Badge></td>
                <td>{a.entity}</td>
                <td className="text-slate-400">{a.entityId ?? "—"}</td>
                <td className="font-mono text-xs">{a.ip}</td>
                <td className="text-slate-400">{a.createdAt.slice(0, 19).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex justify-between items-center mt-3 text-sm">
        <span className="text-slate-400">page {page}</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button variant="ghost" disabled={items.length < 20} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>
    </Card>
  );
}

function StatusTab() {
  const { data, isLoading } = useQuery({ queryKey: ["server-status"], queryFn: () => api<ServerStatus>("/v1/admin/security/status"), refetchInterval: 10_000 });
  if (isLoading) return <Loading />;
  const s = data!;
  const fields: [string, string | number][] = [
    ["uptime", `${Math.floor(s.uptimeSeconds / 3600)}h ${Math.floor((s.uptimeSeconds % 3600) / 60)}m`],
    ["node", s.nodeVersion],
    ["platform", s.platform],
    ["rss memory", `${s.memoryMb} MB`],
    ["heap used", `${s.heapMb} MB`],
    ["pid", s.pid],
    ["server time", s.time.replace("T", " ").slice(0, 19) + "Z"],
    ["metrics", "GET /metrics (prometheus)"],
  ];
  return (
    <Card title="Server status">
      <table className="text-sm">
        <tbody>{fields.map(([k, v]) => (
          <tr key={k}><td className="py-1.5 pr-8 text-slate-400">{k}</td><td className="font-medium">{v}</td></tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

const ALL_PERMS = [
  "dashboard.view", "rooms.read", "rooms.write", "users.read", "users.write", "agencies.read", "agencies.write",
  "games.read", "games.write", "rounds.read", "rounds.write", "wallet.read", "wallet.write", "players.read", "players.write",
  "reports.read", "providers.read", "providers.write", "security.read", "security.write", "settings.read", "settings.write",
];

function RolesTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/v1/admin/roles") });
  const [editing, setEditing] = useState<Role | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [newAdmin, setNewAdmin] = useState({ username: "", password: "", displayName: "", roleKey: "support" });
  const [msg, setMsg] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  const roles = data ?? [];

  const openEdit = (r: Role) => {
    setEditing(r);
    setSel(new Set(r.permissions.map((p) => p.permission.key)));
  };

  return (
    <>
      <Card title="Roles & permissions">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2">Role</th><th>Key</th><th>Permissions</th><th />
          </tr></thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 font-medium">{r.name}</td>
                <td className="font-mono text-xs">{r.key}</td>
                <td>{r.permissions.length}</td>
                <td className="text-right">
                  {can("security.write") && r.key !== "super_admin" && <Button variant="ghost" onClick={() => openEdit(r)}>Edit</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {can("security.write") && (
        <Card title="Create admin user">
          <form className="flex flex-wrap gap-2 items-end" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/v1/admin/admin-users", { method: "POST", json: { ...newAdmin, email: `${newAdmin.username}@sm-live.local` } });
              setMsg(`created ${newAdmin.username}`);
              setNewAdmin({ username: "", password: "", displayName: "", roleKey: "support" });
            } catch (err) { setMsg((err as Error).message); }
          }}>
            <label className="text-xs">username<br /><Input value={newAdmin.username} onChange={(e) => setNewAdmin({ ...newAdmin, username: e.target.value })} /></label>
            <label className="text-xs">display name<br /><Input value={newAdmin.displayName} onChange={(e) => setNewAdmin({ ...newAdmin, displayName: e.target.value })} /></label>
            <label className="text-xs">password<br /><Input type="password" value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} /></label>
            <label className="text-xs">role<br />
              <select value={newAdmin.roleKey} onChange={(e) => setNewAdmin({ ...newAdmin, roleKey: e.target.value })}
                className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm">
                {roles.filter((r) => r.key !== "super_admin").map((r) => <option key={r.key} value={r.key}>{r.key}</option>)}
              </select>
            </label>
            <Button>Create</Button>
            {msg && <span className="text-sm text-violet-500">{msg}</span>}
          </form>
        </Card>
      )}

      {editing && (
        <Modal open title={`Permissions — ${editing.key}`} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-1 max-h-80 overflow-auto">
            {ALL_PERMS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm p-1">
                <input type="checkbox" checked={sel.has(p)} onChange={(e) => {
                  const next = new Set(sel);
                  if (e.target.checked) next.add(p); else next.delete(p);
                  setSel(next);
                }} />
                <span className="font-mono text-xs">{p}</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={async () => {
              await api(`/v1/admin/roles/${editing.id}/permissions`, { method: "PATCH", json: { permissions: [...sel] } });
              setEditing(null);
              void qc.invalidateQueries({ queryKey: ["roles"] });
            }}>Save permissions</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
