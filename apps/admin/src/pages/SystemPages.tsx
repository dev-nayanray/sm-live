/**
 * SM Live — System Management pages.
 *
 *   - NotificationCenter: in-app notification broadcast console
 *     (/v1/admin/notifications — new endpoints).
 *   - PlatformStatus: component health board (/v1/admin/operations/health).
 *   - MaintenanceConfig: schedule maintenance windows
 *     (/v1/admin/operations/maintenance POST + action endpoint).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Input, Loading, Modal, Select } from "../components/ui";

interface NotificationRow {
  id: number; userId: number; userName: string | null; category: string;
  title: string; body: string; link: string; readAt: string | null; createdAt: string;
}
interface HealthResult { key: string; label: string; status: string; detail: string; latencyMs: number | null; checkedAt: string }
interface MaintenanceRow {
  id: number; scope: string; module: string | null; reason: string;
  startAt: string; endAt: string; status: string;
}

export function NotificationCenter() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [form, setForm] = useState({
    audience: "all", userIds: "", category: "system", title: "", body: "", link: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["notifications-admin", page],
    queryFn: () => api<{ total: number; sent24h: number; readCount: number; items: NotificationRow[] }>(
      `/v1/admin/notifications?page=${page}&pageSize=20`
    ),
  });

  const send = async () => {
    const json: Record<string, unknown> = {
      category: form.category, title: form.title, body: form.body, link: form.link,
    };
    if (form.audience === "vip") json.vipOnly = true;
    if (form.audience === "users") {
      json.userIds = form.userIds.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
    }
    const res = await api<{ sent: number }>("/v1/admin/notifications", { method: "POST", json });
    setSent(`Sent to ${res.sent} user${res.sent === 1 ? "" : "s"}.`);
    setComposing(false);
    void qc.invalidateQueries({ queryKey: ["notifications-admin"] });
  };

  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Notification Management</h1>
      <p className="text-sm text-slate-400 mb-4">In-app notification centre — broadcast to all users, VIPs or a targeted list.</p>

      {sent && <div className="mb-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">{sent}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        {[
          { label: "Sent (24h)", value: data?.sent24h },
          { label: "Total notifications", value: data?.total },
          { label: "Read", value: data?.readCount },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {c.value === undefined ? (isLoading ? "…" : "—") : Number(c.value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <Card
        title="Recent notifications"
        actions={can("settings.write") ? <Button onClick={() => setComposing(true)}>+ Broadcast</Button> : undefined}
      >
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no notifications sent yet" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Title</th><th>Category</th><th>To</th><th>Read</th><th>Sent</th>
            </tr></thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><div className="font-medium">{n.title}</div><div className="text-xs text-slate-400 truncate max-w-xs">{n.body}</div></td>
                  <td><Badge tone="violet">{n.category}</Badge></td>
                  <td>{n.userName ?? `#${n.userId}`}</td>
                  <td>{n.readAt ? <Badge tone="green">read</Badge> : <Badge>unread</Badge>}</td>
                  <td className="text-xs text-slate-400">{n.createdAt.slice(0, 16).replace("T", " ")}</td>
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

      <Modal open={composing} title="Broadcast notification" onClose={() => setComposing(false)}>
        <div className="space-y-3">
          <label className="block text-sm">Audience
            <Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="w-full mt-1">
              <option value="all">All users</option>
              <option value="vip">VIP users only</option>
              <option value="users">Specific user IDs</option>
            </Select>
          </label>
          {form.audience === "users" && (
            <label className="block text-sm">User IDs (comma separated)
              <Input value={form.userIds} onChange={(e) => setForm({ ...form, userIds: e.target.value })} placeholder="1, 5, 12" className="w-full mt-1" />
            </label>
          )}
          <label className="block text-sm">Category
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full mt-1">
              {["system", "promo", "wallet", "social", "moderation"].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </label>
          <label className="block text-sm">Title
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full mt-1" />
          </label>
          <label className="block text-sm">Body
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <label className="block text-sm">Deep link (optional)
            <Input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="/wallet" className="w-full mt-1" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setComposing(false)}>Cancel</Button>
            <Button disabled={!form.title.trim()} onClick={() => void send()}>Send</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function PlatformStatus() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["platform-status"],
    queryFn: () => api<{ results: HealthResult[] } | HealthResult[]>("/v1/admin/operations/health"),
    refetchInterval: 60_000,
  });
  const results = Array.isArray(data) ? data : data?.results ?? [];
  const up = results.filter((r) => r.status === "up").length;
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Platform Status</h1>
      <p className="text-sm text-slate-400 mb-4">Live health board — backend, database, Redis, providers and background queues.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        {[
          { label: "Components up", value: `${up}/${results.length || "…"}` },
          { label: "Degraded / down", value: results.filter((r) => r.status !== "up").length },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{isLoading ? "…" : c.value}</div>
          </div>
        ))}
      </div>
      <Card title="Components" actions={<Button variant="ghost" onClick={() => void refetch()}>{isFetching ? "Checking…" : "Refresh"}</Button>}>
        {isLoading ? <Loading /> : results.length === 0 ? <Empty text="no health results yet — run a check from Operations" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Component</th><th>Status</th><th>Detail</th><th>Latency</th><th>Checked</th>
            </tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-medium">{r.label || r.key}</td>
                  <td><Badge tone={r.status === "up" ? "green" : r.status === "degraded" ? "amber" : "red"}>{r.status}</Badge></td>
                  <td className="max-w-sm truncate text-slate-500 dark:text-slate-400">{r.detail || "—"}</td>
                  <td className="tabular-nums text-slate-400">{r.latencyMs != null ? `${r.latencyMs} ms` : "—"}</td>
                  <td className="text-xs text-slate-400">{r.checkedAt?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function MaintenanceConfig() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ scope: "platform", module: "", reason: "", startAt: "", endAt: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["maintenance-config"],
    queryFn: () => api<{ items: MaintenanceRow[] }>("/v1/admin/operations/maintenance?page=1&pageSize=50"),
  });

  const create = async () => {
    await api("/v1/admin/operations/maintenance", {
      method: "POST",
      json: {
        scope: form.scope,
        ...(form.module ? { module: form.module } : {}),
        reason: form.reason || "scheduled maintenance",
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
      },
    });
    setCreating(false);
    void qc.invalidateQueries({ queryKey: ["maintenance-config"] });
  };

  const items = data?.items ?? [];
  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Maintenance Configuration</h1>
      <p className="text-sm text-slate-400 mb-4">Schedule platform or module maintenance windows shown to players in-app.</p>
      <Card
        title="Windows"
        actions={can("ops.maintenance") ? <Button onClick={() => setCreating(true)}>+ Schedule window</Button> : undefined}
      >
        {isLoading ? <Loading /> : items.length === 0 ? <Empty text="no maintenance scheduled" /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
              <th className="py-2">Scope</th><th>Module</th><th>Reason</th><th>Start</th><th>End</th><th>Status</th>
            </tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2"><Badge tone={m.scope === "platform" ? "violet" : "slate"}>{m.scope}</Badge></td>
                  <td>{m.module ?? "—"}</td>
                  <td className="max-w-xs truncate text-slate-500 dark:text-slate-400">{m.reason}</td>
                  <td className="text-xs text-slate-400">{m.startAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="text-xs text-slate-400">{m.endAt.slice(0, 16).replace("T", " ")}</td>
                  <td><Badge tone={m.status === "active" ? "amber" : m.status === "completed" ? "green" : "slate"}>{m.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={creating} title="Schedule maintenance window" onClose={() => setCreating(false)}>
        <div className="space-y-3">
          <label className="block text-sm">Scope
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} className="w-full mt-1">
              <option value="platform">platform (whole site)</option>
              <option value="module">single module</option>
            </Select>
          </label>
          {form.scope === "module" && (
            <label className="block text-sm">Module
              <Input value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} placeholder="games / wallet / live" className="w-full mt-1" />
            </label>
          )}
          <label className="block text-sm">Reason
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="database upgrade" className="w-full mt-1" />
          </label>
          <label className="block text-sm">Start
            <Input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} className="w-full mt-1" />
          </label>
          <label className="block text-sm">End
            <Input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} className="w-full mt-1" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button disabled={!form.startAt || !form.endAt} onClick={() => void create()}>Schedule</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
