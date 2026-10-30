/**
 * SM Live — Platform Operations, Monitoring, Maintenance & Backup (Prompt 12).
 *
 * Multi-tab dashboard exposing the 10 operations groups backed by the new
 * /v1/admin/operations/* endpoints. All data is real (DB rows / process.* /
 * live BullMQ state); there are no fake metrics.
 *
 * Tabs:
 *   1. Dashboard      — platform health, infra status, recent activity
 *   2. Health         — per-component probe results (cached + on-demand run)
 *   3. Maintenance    — schedule / activate / cancel maintenance windows
 *   4. Backups       — verified backup history + create / verify / delete
 *   5. Recovery       — restore workflow with explicit confirm gate
 *   6. Incidents     — CRUD + assignee + status workflow
 *   7. Alerts         — ack / resolve state machine
 *   8. Logs           — redacted API errors + audit trail
 *   9. Jobs           — live BullMQ queue + scheduled repeat jobs
 *  10. Reports        — CSV export of any operations table
 *
 * Permission-aware: every tab hides its write buttons when the current
 * admin lacks the corresponding `ops.*` permission. The backend re-checks
 * every permission, so even a hand-crafted request is rejected.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, Select } from "../components/ui";

type Tab = "dashboard" | "health" | "maintenance" | "backups" | "recovery" | "incidents" | "alerts" | "logs" | "jobs" | "reports";

const TABS: Array<[Tab, string, string]> = [
  ["dashboard", "Dashboard", "ops.view"],
  ["health", "Health", "ops.view"],
  ["maintenance", "Maintenance", "ops.maintenance"],
  ["backups", "Backups", "ops.backups"],
  ["recovery", "Recovery", "ops.restore"],
  ["incidents", "Incidents", "ops.incidents"],
  ["alerts", "Alerts", "ops.incidents"],
  ["logs", "Logs", "ops.logs"],
  ["jobs", "Jobs", "ops.jobs"],
  ["reports", "Reports", "ops.view"],
];

export function Operations() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const visibleTabs = TABS.filter(([, , perm]) => can(perm));
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Platform Operations</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {visibleTabs.map(([k, label]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{label}</Button>
        ))}
      </div>
      {tab === "dashboard" && <DashboardTab />}
      {tab === "health" && <HealthTab />}
      {tab === "maintenance" && <MaintenanceTab />}
      {tab === "backups" && <BackupsTab />}
      {tab === "recovery" && <RecoveryTab />}
      {tab === "incidents" && <IncidentsTab />}
      {tab === "alerts" && <AlertsTab />}
      {tab === "logs" && <LogsTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "reports" && <ReportsTab />}
    </div>
  );
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function StatusBadge({ status }: { status: string }) {
  const tone: "green" | "amber" | "red" | "slate" | "violet" =
    status === "healthy" || status === "succeeded" || status === "verified" || status === "resolved" || status === "completed" ? "green"
    : status === "degraded" || status === "warning" || status === "scheduled" || status === "acknowledged" || status === "investigating" || status === "monitoring" ? "amber"
    : status === "down" || status === "failed" || status === "critical" || status === "open" ? "red"
    : status === "not_configured" || status === "unknown" || status === "cancelled" ? "slate"
    : "violet";
  return <Badge tone={tone}>{status}</Badge>;
}

function fmtDate(s: string | Date | null | undefined): string {
  if (!s) return "—";
  const d = typeof s === "string" ? new Date(s) : s;
  return d.toISOString().slice(0, 19).replace("T", " ") + "Z";
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ===========================================================================
// 1. Dashboard
// ===========================================================================
interface DashboardData {
  platformHealth: "healthy" | "warning" | "critical" | "unknown";
  generatedAt: string;
  infra: {
    uptimeSeconds: number; nodeVersion: string; platform: string; hostname: string;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
    cpu: { userMicros: number; systemMicros: number };
    pid: number; loadAvg: number[]; time: string;
  };
  activeSessions: number; activeRooms: number; activeGameSessions: number;
  apiErrors24h: number; securityEvents24h: number; auditActions24h: number;
  activeMaintenance: { id: number; title: string; scope: string; startAt: string; endAt: string; message: string } | null;
  upcomingMaintenance: Array<{ id: number; title: string; scope: string; startAt: string; endAt: string }>;
  openIncidents: Array<{ id: number; title: string; severity: string; status: string; affectedService: string; createdAt: string }>;
  openAlerts: Array<{ id: number; source: string; severity: string; message: string; createdAt: string }>;
  latestBackups: Array<{ id: number; kind: string; status: string; completedAt: string | null; sizeBytes: number | null }>;
  latestFailedBackup: { id: number; kind: string; completedAt: string | null; error: string } | null;
  recentRecoveries: Array<{ id: number; status: string; targetEnvironment: string; completedAt: string | null }>;
  health: Array<{ component: string; status: string; responseTimeMs: number | null; details: string; checkedAt: string }>;
  backupCapabilities: { discoveryConfigured: boolean; createConfigured: boolean; restoreConfigured: boolean };
  maintenanceStrict: boolean;
}

function DashboardTab() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ops-dashboard"],
    queryFn: () => api<DashboardData>("/v1/admin/operations/dashboard"),
    refetchInterval: 30_000,
  });
  if (isLoading) return <Loading />;
  if (error) return <><ErrorBox error={error} /><Button variant="ghost" onClick={() => refetch()}>Retry</Button></>;
  if (!data) return <Empty text="no data" />;
  const d = data;

  const infraCards: Array<[string, string]> = [
    ["Platform health", d.platformHealth],
    ["Uptime", fmtUptime(d.infra.uptimeSeconds)],
    ["Node", d.infra.nodeVersion],
    ["Platform", d.infra.platform],
    ["Hostname", d.infra.hostname],
    ["PID", String(d.infra.pid)],
    ["RSS memory", `${d.infra.memory.rssMb} MB`],
    ["Heap used", `${d.infra.memory.heapUsedMb} / ${d.infra.memory.heapTotalMb} MB`],
    ["Load avg (1/5/15)", d.infra.loadAvg.slice(0, 3).map((n) => n.toFixed(2)).join(" / ")],
    ["Server time", fmtDate(d.infra.time)],
  ];

  const activityCards: Array<[string, number]> = [
    ["Active sessions", d.activeSessions],
    ["Active live rooms", d.activeRooms],
    ["Active game sessions", d.activeGameSessions],
    ["API errors (24h)", d.apiErrors24h],
    ["Security events (24h)", d.securityEvents24h],
    ["Audit actions (24h)", d.auditActions24h],
  ];

  return (
    <div className="space-y-4">
      <Card title="Platform health summary" actions={<span className="text-xs text-slate-400">refreshed every 30s · {fmtDate(d.generatedAt)}</span>}>
        <div className="flex items-center gap-4">
          <StatusBadge status={d.platformHealth} />
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {d.platformHealth === "healthy" && "All systems operational."}
            {d.platformHealth === "warning" && "One or more components degraded — review the list below."}
            {d.platformHealth === "critical" && "Active critical incident or downed component — investigate immediately."}
            {d.platformHealth === "unknown" && "No health probes have been run yet — switch to the Health tab and click Run probes."}
          </span>
          <span className="ml-auto text-xs text-slate-400">
            Maintenance strict mode: {d.maintenanceStrict ? "on" : "off"}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {infraCards.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
            <div className="mt-1 text-base font-semibold text-slate-800 dark:text-slate-100 break-all">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {activityCards.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Active maintenance">
          {d.activeMaintenance ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status="active" />
                <span className="font-semibold">{d.activeMaintenance.title}</span>
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                Scope: <code>{d.activeMaintenance.scope}</code> · {fmtDate(d.activeMaintenance.startAt)} → {fmtDate(d.activeMaintenance.endAt)}
              </div>
              {d.activeMaintenance.message && <p className="mt-2 text-sm">{d.activeMaintenance.message}</p>}
            </div>
          ) : (
            <Empty text="no active maintenance window" />
          )}
        </Card>
        <Card title={`Upcoming maintenance (${d.upcomingMaintenance.length})`}>
          {d.upcomingMaintenance.length === 0 ? <Empty text="nothing scheduled" /> : (
            <ul className="text-sm space-y-1">
              {d.upcomingMaintenance.map((m) => (
                <li key={m.id} className="flex justify-between">
                  <span>{m.title}</span>
                  <span className="text-slate-400">{fmtDate(m.startAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Open incidents (${d.openIncidents.length})`}>
          {d.openIncidents.length === 0 ? <Empty text="no open incidents" /> : (
            <ul className="text-sm space-y-1">
              {d.openIncidents.map((i) => (
                <li key={i.id} className="flex justify-between items-center gap-2">
                  <span className="truncate">{i.title}</span>
                  <StatusBadge status={i.severity} />
                  <span className="text-slate-400 text-xs">{fmtDate(i.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Open alerts (${d.openAlerts.length})`}>
          {d.openAlerts.length === 0 ? <Empty text="no open alerts" /> : (
            <ul className="text-sm space-y-1">
              {d.openAlerts.map((a) => (
                <li key={a.id} className="flex justify-between items-center gap-2">
                  <span className="truncate"><code className="text-xs">{a.source}</code> · {a.message}</span>
                  <StatusBadge status={a.severity} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Latest successful backups">
          {d.latestBackups.length === 0 ? <Empty text="no backups recorded" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5">Kind</th><th>Status</th><th>Size</th><th>Completed</th>
              </tr></thead>
              <tbody>
                {d.latestBackups.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1.5">{b.kind}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>{fmtBytes(b.sizeBytes)}</td>
                    <td className="text-slate-400">{fmtDate(b.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d.latestFailedBackup && (
            <div className="mt-3 p-2 rounded bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-sm">
              Latest failed backup ({d.latestFailedBackup.kind}): {d.latestFailedBackup.error}
            </div>
          )}
        </Card>
        <Card title="Backup capabilities">
          <ul className="text-sm space-y-1.5">
            <li>Discovery (read filesystem): <StatusBadge status={d.backupCapabilities.discoveryConfigured ? "healthy" : "not_configured"} /></li>
            <li>Create (run backup script): <StatusBadge status={d.backupCapabilities.createConfigured ? "healthy" : "not_configured"} /></li>
            <li>Restore (run restore script): <StatusBadge status={d.backupCapabilities.restoreConfigured ? "healthy" : "not_configured"} /></li>
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            Capabilities are gated by env vars (<code>BACKUP_DIR_PATH</code>, <code>BACKUP_SCRIPT_PATH</code>, <code>RESTORE_SCRIPT_PATH</code>).
            See <code>apps/api/.env.example</code> for details.
          </p>
        </Card>
      </div>

      <Card title="Health checks (latest)">
        {d.health.length === 0 ? <Empty text="no probes run yet — switch to the Health tab and click 'Run probes'" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-1.5">Component</th><th>Status</th><th>Response</th><th>Details</th><th>Checked</th>
            </tr></thead>
            <tbody>
              {d.health.map((h) => (
                <tr key={h.component} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 font-medium">{h.component}</td>
                  <td><StatusBadge status={h.status} /></td>
                  <td>{h.responseTimeMs != null ? `${h.responseTimeMs}ms` : "—"}</td>
                  <td className="text-slate-500 dark:text-slate-400 max-w-[280px] truncate">{h.details}</td>
                  <td className="text-slate-400">{fmtDate(h.checkedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// 2. Health
// ===========================================================================
interface HealthRow {
  id: number; component: string; status: string;
  responseTimeMs: number | null; details: string; error: string; checkedAt: string;
}

function HealthTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-health"],
    queryFn: () => api<{ checks: HealthRow[]; generatedAt: string; lastRefresh: string | null }>("/v1/admin/operations/health"),
    refetchInterval: 60_000,
  });
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);

  const runProbes = async () => {
    setRunning(true); setRunErr(null);
    try {
      await api("/v1/admin/operations/health/run", { method: "POST" });
      void qc.invalidateQueries({ queryKey: ["ops-health"] });
      void qc.invalidateQueries({ queryKey: ["ops-dashboard"] });
    } catch (e) {
      setRunErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const checks = data?.checks ?? [];
  return (
    <Card
      title="System health checks"
      actions={<Button onClick={runProbes} disabled={running}>{running ? "Running…" : "Run probes"}</Button>}
    >
      {runErr && <ErrorBox error={new Error(runErr)} />}
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
        Probes hit the real database, Redis, BullMQ, and provider tables. Each probe is wrapped in a 1.5s timeout so a
        missing dependency doesn't hang the dashboard. Results are persisted for {`{HEALTH_CHECK_RETENTION_DAYS}`} days.
      </p>
      {checks.length === 0 ? <Empty text="no probes run yet — click 'Run probes'" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-1.5">Component</th><th>Status</th><th>Response</th><th>Details / Error</th><th>Checked</th>
          </tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.component} className="border-b border-slate-100 dark:border-slate-800 align-top">
                <td className="py-1.5 font-medium">{c.component}</td>
                <td><StatusBadge status={c.status} /></td>
                <td>{c.responseTimeMs != null ? `${c.responseTimeMs}ms` : "—"}</td>
                <td className="text-slate-600 dark:text-slate-300">
                  <div>{c.details}</div>
                  {c.error && <div className="text-rose-600 dark:text-rose-400 text-xs mt-0.5">{c.error}</div>}
                </td>
                <td className="text-slate-400">{fmtDate(c.checkedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ===========================================================================
// 3. Maintenance
// ===========================================================================
interface MaintenanceRow {
  id: number; scope: string; title: string; message: string; status: string;
  startAt: string; endAt: string; internalNotes: string;
  createdBy: { id: number; username: string; displayName: string } | null;
  events: Array<{ id: number; type: string; note: string; createdAt: string }>;
}

function MaintenanceTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ id: number; action: "activate" | "deactivate" | "cancel"; title: string } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-maintenance"],
    queryFn: () => api<{ total: number; items: MaintenanceRow[] }>("/v1/admin/operations/maintenance?page=1&pageSize=50"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data?.items ?? [];
  return (
    <>
      <Card title={`Maintenance schedules (${data?.total ?? 0})`} actions={can("ops.maintenance") && <Button onClick={() => setCreating(true)}>+ New schedule</Button>}>
        {items.length === 0 ? <Empty text="no maintenance windows scheduled" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5">Title</th><th>Scope</th><th>Status</th><th>Window</th><th>Created by</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-1.5 font-medium">
                      {m.title}
                      {m.message && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-[280px] truncate">{m.message}</div>}
                    </td>
                    <td><code>{m.scope}</code></td>
                    <td><StatusBadge status={m.status} /></td>
                    <td className="text-slate-500 dark:text-slate-400 text-xs">
                      {fmtDate(m.startAt)}<br />→ {fmtDate(m.endAt)}
                    </td>
                    <td className="text-slate-500 dark:text-slate-400">{m.createdBy?.username ?? "—"}</td>
                    <td>
                      {can("ops.maintenance") && m.status !== "completed" && m.status !== "cancelled" && (
                        <div className="flex gap-1 flex-wrap">
                          {m.status === "scheduled" && <Button variant="ghost" onClick={() => setActionTarget({ id: m.id, action: "activate", title: m.title })}>Activate</Button>}
                          {m.status === "active" && <Button variant="ghost" onClick={() => setActionTarget({ id: m.id, action: "deactivate", title: m.title })}>End</Button>}
                          <Button variant="ghost" onClick={() => setActionTarget({ id: m.id, action: "cancel", title: m.title })}>Cancel</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && <CreateMaintenanceModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["ops-maintenance"] }); void qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); }} />}

      {actionTarget && <ActionMaintenanceModal target={actionTarget} onClose={() => setActionTarget(null)} onDone={() => { setActionTarget(null); void qc.invalidateQueries({ queryKey: ["ops-maintenance"] }); void qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); }} />}
    </>
  );
}

function CreateMaintenanceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ scope: "platform", title: "", message: "", startAt: "", endAt: "", internalNotes: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await api("/v1/admin/operations/maintenance", {
        method: "POST",
        json: { ...form, startAt: new Date(form.startAt).toISOString(), endAt: new Date(form.endAt).toISOString() },
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title="Schedule maintenance" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Title *</span><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Scope</span>
          <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
            <option value="platform">platform</option>
            <option value="live">live</option>
            <option value="games">games</option>
            <option value="wallet">wallet</option>
            <option value="integration">integration</option>
          </Select>
        </label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Reason (audit) *</span><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Start at *</span><Input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">End at *</span><Input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></label>
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Public message</span><Input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Internal notes (admin only)</span><Input value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} /></label>
      </div>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving || !form.title || !form.reason || !form.startAt || !form.endAt}>{saving ? "Saving…" : "Schedule"}</Button>
      </div>
    </Modal>
  );
}

function ActionMaintenanceModal({ target, onClose, onDone }: { target: { id: number; action: "activate" | "deactivate" | "cancel"; title: string }; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const verb = target.action === "activate" ? "activate" : target.action === "deactivate" ? "end" : "cancel";
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api(`/v1/admin/operations/maintenance/${target.id}/action`, { method: "POST", json: { action: target.action, reason } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title={`${verb} maintenance — ${target.title}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
        You are about to <strong>{verb}</strong> the maintenance window <em>{target.title}</em>.
        This action is recorded in the audit log with your admin ID and reason.
      </p>
      <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Reason (required) *</span><Input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={target.action === "cancel" ? "danger" : "primary"} onClick={go} disabled={saving || !reason}>{saving ? "Working…" : `Confirm ${verb}`}</Button>
      </div>
    </Modal>
  );
}

// ===========================================================================
// 4. Backups
// ===========================================================================
interface BackupRow {
  id: number; kind: string; scope: string; status: string; location: string;
  sizeBytes: number | null; checksum: string | null;
  startedAt: string | null; completedAt: string | null;
  createdById: number | null; note: string; error: string;
  createdBy: { id: number; username: string; displayName: string } | null;
  createdAt: string;
}

function BackupsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<BackupRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-backups"],
    queryFn: () => api<{ total: number; items: BackupRow[]; capabilities: { discoveryConfigured: boolean; createConfigured: boolean } }>("/v1/admin/operations/backups?page=1&pageSize=50"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const items = data?.items ?? [];
  const caps = data?.capabilities;

  const discover = async () => {
    setDiscovering(true); setBusy(null);
    try {
      await api("/v1/admin/operations/backups/discover", { method: "POST" });
      void qc.invalidateQueries({ queryKey: ["ops-backups"] });
    } catch (e) {
      setBusy((e as Error).message);
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <>
      <Card title="Backup capabilities" actions={can("ops.backups") && caps?.discoveryConfigured && (
        <Button variant="ghost" onClick={discover} disabled={discovering}>{discovering ? "Discovering…" : "Discover now"}</Button>
      )}>
        <ul className="text-sm space-y-1.5">
          <li>Filesystem discovery (<code>BACKUP_DIR_PATH</code>): <StatusBadge status={caps?.discoveryConfigured ? "healthy" : "not_configured"} /></li>
          <li>Backup creation (<code>BACKUP_SCRIPT_PATH</code>): <StatusBadge status={caps?.createConfigured ? "healthy" : "not_configured"} /></li>
        </ul>
        {!caps?.discoveryConfigured && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            Discovery is not configured. Set <code>BACKUP_DIR_PATH</code> in the API env to enable auto-discovery of
            existing <code>sm_live_*.sql.gz</code> files (see <code>infra/backup.sh</code>).
          </p>
        )}
        {busy && <ErrorBox error={new Error(busy)} />}
      </Card>

      <Card title={`Backup history (${data?.total ?? 0})`} actions={can("ops.backups.write") && caps?.createConfigured && <Button onClick={() => setCreating(true)}>+ Run backup</Button>}>
        {items.length === 0 ? <Empty text="no backups recorded" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5">Kind</th><th>Status</th><th>Location</th><th>Size</th><th>Started</th><th>Completed</th><th>By</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-1.5">{b.kind}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="font-mono text-xs max-w-[200px] truncate" title={b.location}>{b.location || "—"}</td>
                    <td>{fmtBytes(b.sizeBytes)}</td>
                    <td className="text-slate-400 text-xs">{fmtDate(b.startedAt)}</td>
                    <td className="text-slate-400 text-xs">{fmtDate(b.completedAt)}</td>
                    <td className="text-slate-500 dark:text-slate-400">{b.createdBy?.username ?? "—"}</td>
                    <td>
                      {can("ops.backups.write") && (
                        <div className="flex gap-1">
                          {b.status === "succeeded" && <Button variant="ghost" onClick={() => setVerifyTarget(b)}>Verify</Button>}
                          {(b.status === "expired" || b.status === "failed") && <Button variant="ghost" onClick={() => setDeleteTarget(b)}>Delete</Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.some((b) => b.error) && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-slate-500">Show backup errors</summary>
            <ul className="mt-2 space-y-1">
              {items.filter((b) => b.error).map((b) => (
                <li key={b.id} className="text-rose-600 dark:text-rose-400">#{b.id} ({b.kind}): {b.error}</li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {creating && <CreateBackupModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["ops-backups"] }); void qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); }} />}
      {verifyTarget && <VerifyBackupModal target={verifyTarget} onClose={() => setVerifyTarget(null)} onSaved={() => { setVerifyTarget(null); void qc.invalidateQueries({ queryKey: ["ops-backups"] }); void qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); }} />}
      {deleteTarget && <DeleteBackupModal target={deleteTarget} onClose={() => setDeleteTarget(null)} onSaved={() => { setDeleteTarget(null); void qc.invalidateQueries({ queryKey: ["ops-backups"] }); }} />}
    </>
  );
}

function CreateBackupModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ kind: "database", note: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api("/v1/admin/operations/backups/run", { method: "POST", json: form });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title="Run a backup" onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
        This invokes <code>BACKUP_SCRIPT_PATH</code> on the API host. The script must produce a new
        <code> sm_live_*.sql.gz </code> file in <code>BACKUP_DIR_PATH</code>; otherwise the run is recorded as <em>failed</em>.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Kind</span>
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="database">database</option>
            <option value="config">config</option>
            <option value="media">media</option>
            <option value="application">application</option>
          </Select>
        </label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Note (audit)</span><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
      </div>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={saving}>{saving ? "Running…" : "Run backup"}</Button>
      </div>
    </Modal>
  );
}

function VerifyBackupModal({ target, onClose, onSaved }: { target: BackupRow; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api(`/v1/admin/operations/backups/${target.id}/verify`, { method: "POST", json: { note } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title={`Verify backup #${target.id}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
        Promotes this <code>{target.kind}</code> backup from <em>succeeded</em> to <em>verified</em>. Only verified
        backups are eligible for restore.
      </p>
      <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Verification note</span><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. checksum verified, restore-tested in staging" /></label>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={saving}>{saving ? "Verifying…" : "Mark verified"}</Button>
      </div>
    </Modal>
  );
}

function DeleteBackupModal({ target, onClose, onSaved }: { target: BackupRow; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api(`/v1/admin/operations/backups/${target.id}`, { method: "DELETE", json: { reason } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title={`Delete backup #${target.id}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
        Marks this <code>{target.kind}</code> backup as <em>deleted</em> in the database. The last verified backup of
        each kind is protected from deletion — if this is the last one, the request will be refused.
      </p>
      <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Reason (required) *</span><Input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={go} disabled={saving || !reason}>{saving ? "Deleting…" : "Delete backup"}</Button>
      </div>
    </Modal>
  );
}

// ===========================================================================
// 5. Recovery
// ===========================================================================
interface RecoveryRow {
  id: number; backupId: number; status: string; targetEnvironment: string;
  impact: string; notes: string; result: string; requestedById: number | null;
  startedAt: string | null; completedAt: string | null; createdAt: string;
  backup: { id: number; kind: string; location: string; status: string; completedAt: string | null };
  requestedBy: { id: number; username: string; displayName: string } | null;
}

function RecoveryTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-recoveries"],
    queryFn: () => api<{ total: number; items: RecoveryRow[] }>("/v1/admin/operations/recoveries?page=1&pageSize=50"),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data?.items ?? [];
  return (
    <>
      <Card title={`Recovery history (${data?.total ?? 0})`} actions={can("ops.restore") && <Button onClick={() => setCreating(true)}>+ Initiate restore</Button>}>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
          Restores can target <strong>staging</strong> or <strong>sandbox</strong> environments only. Production
          restores must be performed manually on the server via <code>infra/restore.sh</code> — the API refuses any
          production restore request.
        </p>
        {items.length === 0 ? <Empty text="no recovery operations recorded" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5">Status</th><th>Target</th><th>Backup</th><th>Impact</th><th>Requested by</th><th>Started</th><th>Completed</th><th>Result</th>
              </tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-1.5"><StatusBadge status={r.status} /></td>
                    <td><code>{r.targetEnvironment}</code></td>
                    <td className="font-mono text-xs">#{r.backup.id} ({r.backup.kind})</td>
                    <td className="text-slate-500 dark:text-slate-400 max-w-[200px]">{r.impact}</td>
                    <td className="text-slate-500 dark:text-slate-400">{r.requestedBy?.username ?? "—"}</td>
                    <td className="text-slate-400 text-xs">{fmtDate(r.startedAt)}</td>
                    <td className="text-slate-400 text-xs">{fmtDate(r.completedAt)}</td>
                    <td className="text-slate-500 dark:text-slate-400 max-w-[280px]">{r.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <CreateRecoveryModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["ops-recoveries"] }); void qc.invalidateQueries({ queryKey: ["ops-dashboard"] }); }} />}
    </>
  );
}

function CreateRecoveryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [backupId, setBackupId] = useState("");
  const [target, setTarget] = useState<"staging" | "sandbox">("staging");
  const [notes, setNotes] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: backupsData } = useQuery({
    queryKey: ["ops-backups-verified"],
    queryFn: () => api<{ items: BackupRow[] }>("/v1/admin/operations/backups?status=verified&page=1&pageSize=100"),
  });
  const verified = backupsData?.items ?? [];
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api("/v1/admin/operations/recoveries", { method: "POST", json: { backupId: Number(backupId), targetEnvironment: target, notes, confirm } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title="Initiate recovery" onClose={onClose}>
      <p className="text-sm text-rose-700 dark:text-rose-300 mb-3">
        ⚠ Restore operations overwrite the entire target environment's database. This action is rate-limited and
        audited. Production restores are <strong>not</strong> permitted from this UI.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Verified backup *</span>
          <Select value={backupId} onChange={(e) => setBackupId(e.target.value)}>
            <option value="">— select a verified backup —</option>
            {verified.map((b) => <option key={b.id} value={b.id}>#{b.id} · {b.kind} · {fmtDate(b.completedAt)} · {fmtBytes(b.sizeBytes)}</option>)}
          </Select>
        </label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Target environment</span>
          <Select value={target} onChange={(e) => setTarget(e.target.value as "staging" | "sandbox")}>
            <option value="staging">staging</option>
            <option value="sandbox">sandbox</option>
          </Select>
        </label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Notes</span><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="text-sm col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>I understand this overwrites all tables in the target environment.</span>
        </label>
      </div>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={go} disabled={saving || !backupId || !confirm}>{saving ? "Working…" : "Initiate restore"}</Button>
      </div>
    </Modal>
  );
}

// ===========================================================================
// 6. Incidents
// ===========================================================================
interface IncidentRow {
  id: number; title: string; description: string; severity: string; status: string;
  affectedService: string; assigneeId: number | null; internalNotes: string;
  resolutionDetails: string; createdById: number | null;
  createdAt: string; updatedAt: string; closedAt: string | null;
  assignee: { id: number; username: string; displayName: string } | null;
  createdBy: { id: number; username: string; displayName: string } | null;
}

function IncidentsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<IncidentRow | null>(null);
  const [filter, setFilter] = useState({ status: "", severity: "" });
  const qs = new URLSearchParams({ page: "1", pageSize: "50" });
  if (filter.status) qs.set("status", filter.status);
  if (filter.severity) qs.set("severity", filter.severity);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-incidents", filter],
    queryFn: () => api<{ total: number; items: IncidentRow[] }>(`/v1/admin/operations/incidents?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data?.items ?? [];
  return (
    <>
      <Card title={`Operational incidents (${data?.total ?? 0})`} actions={can("ops.incidents") && <Button onClick={() => setCreating(true)}>+ New incident</Button>}>
        <div className="flex gap-2 mb-3 flex-wrap">
          <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className="!w-40">
            <option value="">all statuses</option>
            <option value="open">open</option>
            <option value="investigating">investigating</option>
            <option value="identified">identified</option>
            <option value="monitoring">monitoring</option>
            <option value="resolved">resolved</option>
            <option value="closed">closed</option>
          </Select>
          <Select value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })} className="!w-40">
            <option value="">all severities</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </Select>
        </div>
        {items.length === 0 ? <Empty text="no incidents match the filter" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5">Title</th><th>Severity</th><th>Status</th><th>Service</th><th>Assignee</th><th>Created</th><th />
              </tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-1.5 font-medium max-w-[280px] truncate" title={i.title}>{i.title}</td>
                    <td><StatusBadge status={i.severity} /></td>
                    <td><StatusBadge status={i.status} /></td>
                    <td className="text-slate-500 dark:text-slate-400">{i.affectedService || "—"}</td>
                    <td className="text-slate-500 dark:text-slate-400">{i.assignee?.username ?? "—"}</td>
                    <td className="text-slate-400 text-xs">{fmtDate(i.createdAt)}</td>
                    <td>{can("ops.incidents") && <Button variant="ghost" onClick={() => setEditing(i)}>Edit</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <IncidentFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["ops-incidents", filter] }); }} />}
      {editing && <IncidentFormModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ["ops-incidents", filter] }); }} />}
    </>
  );
}

function IncidentFormModal({ initial, onClose, onSaved }: { initial?: IncidentRow; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    severity: initial?.severity ?? "medium",
    status: initial?.status ?? "open",
    affectedService: initial?.affectedService ?? "",
    internalNotes: initial?.internalNotes ?? "",
    resolutionDetails: initial?.resolutionDetails ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      if (initial) {
        await api(`/v1/admin/operations/incidents/${initial.id}`, { method: "PATCH", json: form });
      } else {
        await api("/v1/admin/operations/incidents", { method: "POST", json: form });
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title={initial ? `Edit incident #${initial.id}` : "New incident"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Title *</span><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Severity</span>
          <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </Select>
        </label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Status</span>
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="open">open</option>
            <option value="investigating">investigating</option>
            <option value="identified">identified</option>
            <option value="monitoring">monitoring</option>
            <option value="resolved">resolved</option>
            <option value="closed">closed</option>
          </Select>
        </label>
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Affected service</span><Input value={form.affectedService} onChange={(e) => setForm({ ...form, affectedService: e.target.value })} placeholder="e.g. postgres / livekit / mockcorp-provider" /></label>
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Description</span><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" /></label>
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Internal notes (admin only)</span><textarea rows={2} value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" /></label>
        <label className="text-sm col-span-2"><span className="text-slate-500 dark:text-slate-400">Resolution details</span><textarea rows={2} value={form.resolutionDetails} onChange={(e) => setForm({ ...form, resolutionDetails: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" /></label>
      </div>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={saving || !form.title}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

// ===========================================================================
// 7. Alerts
// ===========================================================================
interface AlertRow {
  id: number; source: string; severity: string; status: string; message: string;
  occurrenceCount: number; lastOccurredAt: string; createdAt: string;
  ackedBy: { id: number; username: string } | null;
  resolvedBy: { id: number; username: string } | null;
  resolutionNotes: string;
}

function AlertsTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [ackTarget, setAckTarget] = useState<AlertRow | null>(null);
  const [resolveTarget, setResolveTarget] = useState<AlertRow | null>(null);
  const [filter, setFilter] = useState({ status: "", severity: "" });
  const qs = new URLSearchParams({ page: "1", pageSize: "50" });
  if (filter.status) qs.set("status", filter.status);
  if (filter.severity) qs.set("severity", filter.severity);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-alerts", filter],
    queryFn: () => api<{ total: number; items: AlertRow[] }>(`/v1/admin/operations/alerts?${qs}`),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data?.items ?? [];
  return (
    <>
      <Card title={`Operational alerts (${data?.total ?? 0})`}>
        <div className="flex gap-2 mb-3 flex-wrap">
          <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} className="!w-40">
            <option value="">all statuses</option>
            <option value="open">open</option>
            <option value="acknowledged">acknowledged</option>
            <option value="resolved">resolved</option>
          </Select>
          <Select value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })} className="!w-40">
            <option value="">all severities</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </Select>
        </div>
        {items.length === 0 ? <Empty text="no alerts match the filter" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5">Source</th><th>Severity</th><th>Status</th><th>Message</th><th>Occurrences</th><th>Last seen</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-1.5 font-mono text-xs">{a.source}</td>
                    <td><StatusBadge status={a.severity} /></td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="max-w-[280px]">{a.message}</td>
                    <td>{a.occurrenceCount}</td>
                    <td className="text-slate-400 text-xs">{fmtDate(a.lastOccurredAt)}</td>
                    <td>
                      {can("ops.incidents") && a.status === "open" && <Button variant="ghost" onClick={() => setAckTarget(a)}>Ack</Button>}
                      {can("ops.incidents") && a.status !== "resolved" && <Button variant="ghost" onClick={() => setResolveTarget(a)}>Resolve</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {ackTarget && <AlertAckModal target={ackTarget} onClose={() => setAckTarget(null)} onSaved={() => { setAckTarget(null); void qc.invalidateQueries({ queryKey: ["ops-alerts", filter] }); }} />}
      {resolveTarget && <AlertResolveModal target={resolveTarget} onClose={() => setResolveTarget(null)} onSaved={() => { setResolveTarget(null); void qc.invalidateQueries({ queryKey: ["ops-alerts", filter] }); }} />}
    </>
  );
}

function AlertAckModal({ target, onClose, onSaved }: { target: AlertRow; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api(`/v1/admin/operations/alerts/${target.id}/ack`, { method: "POST", json: { note } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title={`Acknowledge alert #${target.id}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{target.message}</p>
      <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Note (optional)</span><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. investigating — jdoe" /></label>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={saving}>{saving ? "Working…" : "Acknowledge"}</Button>
      </div>
    </Modal>
  );
}

function AlertResolveModal({ target, onClose, onSaved }: { target: AlertRow; onClose: () => void; onSaved: () => void }) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api(`/v1/admin/operations/alerts/${target.id}/resolve`, { method: "POST", json: { resolutionNotes: notes } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title={`Resolve alert #${target.id}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{target.message}</p>
      <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Resolution notes (required) *</span><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" placeholder="e.g. connection pool restarted at 14:32 — verified metrics returned to baseline" /></label>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={saving || !notes}>{saving ? "Working…" : "Resolve"}</Button>
      </div>
    </Modal>
  );
}

// ===========================================================================
// 8. Logs
// ===========================================================================
interface LogRow {
  id: number; level: string; service: string; route: string; message: string;
  payload: unknown; createdAt: string;
}
interface AuditRow {
  id: number; action: string; entity: string; entityId: string | null;
  admin: { id: number; username: string; displayName: string } | null;
  ip: string; before: unknown; after: unknown; createdAt: string;
}

function LogsTab() {
  const [view, setView] = useState<"api" | "audit">("api");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState({ service: "", search: "", from: "", to: "" });
  const qs = new URLSearchParams({ page: String(page), pageSize: "30" });
  if (filter.service) qs.set("service", filter.service);
  if (filter.search) qs.set("search", filter.search);
  if (filter.from) qs.set("from", filter.from);
  if (filter.to) qs.set("to", filter.to);
  // Note: the two endpoints return slightly different shapes (the API log
  // endpoint adds a `note` field). We union them here and access fields
  // defensively below so a single useQuery hook can serve both views.
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-logs", view, qs.toString()],
    queryFn: async () => {
      if (view === "api") {
        return api<{ total: number; items: LogRow[]; note: string }>(`/v1/admin/operations/logs?${qs}`);
      }
      return api<{ total: number; items: AuditRow[] }>(`/v1/admin/operations/audit?${qs}`);
    },
  });
  const total = (data as { total?: number } | undefined)?.total ?? 0;
  const items = (data as { items?: unknown[] } | undefined)?.items ?? [];
  const apiNote = view === "api" ? (data as { note?: string } | undefined)?.note : undefined;
  return (
    <>
      <Card>
        <div className="flex gap-2 mb-3 flex-wrap items-end">
          <Button variant={view === "api" ? "primary" : "ghost"} onClick={() => { setView("api"); setPage(1); }}>API errors</Button>
          <Button variant={view === "audit" ? "primary" : "ghost"} onClick={() => { setView("audit"); setPage(1); }}>Audit trail</Button>
          <span className="flex-1" />
          {view === "api" && (
            <Select value={filter.service} onChange={(e) => { setFilter({ ...filter, service: e.target.value }); setPage(1); }} className="!w-36">
              <option value="">all services</option>
              <option value="api">api</option>
              <option value="database">database</option>
              <option value="provider">provider</option>
              <option value="webhook">webhook</option>
              <option value="wallet">wallet</option>
            </Select>
          )}
          <Input type="date" value={filter.from} onChange={(e) => { setFilter({ ...filter, from: e.target.value }); setPage(1); }} className="!w-36" />
          <Input type="date" value={filter.to} onChange={(e) => { setFilter({ ...filter, to: e.target.value }); setPage(1); }} className="!w-36" />
          <Input placeholder="search message" value={filter.search} onChange={(e) => { setFilter({ ...filter, search: e.target.value }); setPage(1); }} className="!w-48" />
        </div>
        {view === "api" && (
          <p className="text-xs text-slate-400 mb-2">
            {apiNote ?? "Sensitive payload fields (password, secret, token, apiKey) are redacted server-side."}
          </p>
        )}
      </Card>
      <Card title={view === "api" ? `API error log (${total})` : `Audit trail (${total})`}>
        {isLoading ? <Loading /> : error ? <ErrorBox error={error} /> : (
          items.length === 0 ? <Empty text="no entries" /> : (
            <div className="overflow-x-auto">
              {view === "api" ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-1.5">Level</th><th>Service</th><th>Route</th><th>Message</th><th>Payload</th><th>Time</th>
                  </tr></thead>
                  <tbody>
                    {(items as LogRow[]).map((l) => (
                      <tr key={l.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                        <td className="py-1.5"><Badge tone={l.level === "error" ? "red" : "amber"}>{l.level}</Badge></td>
                        <td className="font-mono text-xs">{l.service}</td>
                        <td className="font-mono text-xs">{l.route}</td>
                        <td className="max-w-[280px]">{l.message}</td>
                        <td className="font-mono text-xs text-slate-500 dark:text-slate-400 max-w-[200px] truncate">{l.payload ? JSON.stringify(l.payload) : "—"}</td>
                        <td className="text-slate-400 text-xs">{fmtDate(l.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-1.5">Admin</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>IP</th><th>Time</th>
                  </tr></thead>
                  <tbody>
                    {(items as AuditRow[]).map((a) => (
                      <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                        <td className="py-1.5">{a.admin?.username ?? "system"}</td>
                        <td><Badge tone="violet">{a.action}</Badge></td>
                        <td>{a.entity}</td>
                        <td className="text-slate-400">{a.entityId ?? "—"}</td>
                        <td className="font-mono text-xs">{a.ip}</td>
                        <td className="text-slate-400 text-xs">{fmtDate(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        )}
        <div className="flex justify-between items-center mt-3 text-sm">
          <span className="text-slate-400">page {page}</span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
            <Button variant="ghost" disabled={items.length < 30} onClick={() => setPage(page + 1)}>Next →</Button>
          </div>
        </div>
      </Card>
    </>
  );
}

// ===========================================================================
// 9. Jobs
// ===========================================================================
interface JobRow {
  id: string; name: string; status: string; attempts: number;
  createdAt?: number; processedAt?: number; finishedAt?: number;
  lastFailedReason?: string; nextRepeat?: string | null;
}
interface ScheduledRow { name: string; pattern?: string; every?: number; next?: string }

function JobsTab() {
  const { can } = useAuth();
  const [retryTarget, setRetryTarget] = useState<JobRow | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ops-jobs"],
    queryFn: () => api<{ jobs: JobRow[]; scheduled: ScheduledRow[]; queueError: string | null; note: string }>("/v1/admin/operations/jobs?page=1&pageSize=50"),
    refetchInterval: 15_000,
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const jobs = data?.jobs ?? [];
  const scheduled = data?.scheduled ?? [];
  return (
    <>
      <Card title="Scheduled repeat jobs (BullMQ scheduler)">
        {scheduled.length === 0 ? <Empty text="no repeat jobs registered" /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="py-1.5">Name</th><th>Pattern</th><th>Every</th><th>Next run</th>
            </tr></thead>
            <tbody>
              {scheduled.map((s) => (
                <tr key={`${s.name}-${s.pattern ?? s.every ?? ""}`} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 font-mono text-xs">{s.name}</td>
                  <td className="font-mono text-xs">{s.pattern ?? "—"}</td>
                  <td>{s.every ? `${s.every}ms` : "—"}</td>
                  <td className="text-slate-400">{s.next ? fmtDate(s.next) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Recent jobs">
        {data?.queueError && (
          <div className="mb-3 p-2 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-xs">
            Queue probe error: <code>{data.queueError}</code>
          </div>
        )}
        <p className="text-xs text-slate-400 mb-3">{data?.note}</p>
        {jobs.length === 0 ? <Empty text="no jobs in the queue" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-1.5">ID</th><th>Name</th><th>Status</th><th>Attempts</th><th>Created</th><th>Finished</th><th>Failure</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-slate-100 dark:border-slate-800 align-top">
                    <td className="py-1.5 font-mono text-xs">{j.id.slice(0, 10)}</td>
                    <td className="font-mono text-xs">{j.name}</td>
                    <td><StatusBadge status={j.status} /></td>
                    <td>{j.attempts}</td>
                    <td className="text-slate-400 text-xs">{j.createdAt ? fmtDate(new Date(j.createdAt)) : "—"}</td>
                    <td className="text-slate-400 text-xs">{j.finishedAt ? fmtDate(new Date(j.finishedAt)) : "—"}</td>
                    <td className="text-rose-600 dark:text-rose-400 text-xs max-w-[200px] truncate" title={j.lastFailedReason ?? ""}>{j.lastFailedReason ?? "—"}</td>
                    <td>
                      {can("ops.jobs") && j.status === "failed" && (
                        <Button variant="ghost" onClick={() => setRetryTarget(j)}>Retry</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {retryTarget && <RetryJobModal target={retryTarget} onClose={() => setRetryTarget(null)} onSaved={() => setRetryTarget(null)} />}
    </>
  );
}

function RetryJobModal({ target, onClose, onSaved }: { target: JobRow; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setSaving(true); setErr(null);
    try {
      await api(`/v1/admin/operations/jobs/${encodeURIComponent(target.id)}/retry`, { method: "POST", json: { reason } });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open title={`Retry job ${target.name}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
        Retrying this job re-queues it for execution. Financial / wallet / payout / settlement jobs cannot be retried
        from here — they must be re-driven through the original idempotent entry point so the existing <code>txKey</code>
        / <code>providerTxId</code> guards prevent double-debits.
      </p>
      <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Reason (required) *</span><Input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <ErrorBox error={new Error(err)} />}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go} disabled={saving || !reason}>{saving ? "Working…" : "Retry job"}</Button>
      </div>
    </Modal>
  );
}

// ===========================================================================
// 10. Reports
// ===========================================================================
function ReportsTab() {
  const [kind, setKind] = useState<"incidents" | "alerts" | "maintenance" | "backups" | "recoveries" | "audit" | "api_errors">("incidents");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const download = () => {
    const qs = new URLSearchParams({ kind });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    // Use the admin api client so the auth header is attached; trigger a
    // download by following the response as a blob.
    const token = localStorage.getItem("admin_token") ?? "";
    const base = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";
    fetch(`${base}/v1/admin/operations/reports/export?${qs}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `operations-${kind}.csv`;
        a.click(); URL.revokeObjectURL(url);
      });
  };
  return (
    <Card title="Operational reports — CSV export">
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
        Reports are generated server-side from real DB rows. CSV cells that begin with <code>=</code>, <code>+</code>,
        <code>-</code>, <code>@</code>, or tab/CR are prefixed with a single quote to mitigate formula injection.
      </p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">Report kind</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="incidents">Incidents</option>
            <option value="alerts">Alerts</option>
            <option value="maintenance">Maintenance schedules</option>
            <option value="backups">Backups</option>
            <option value="recoveries">Recoveries</option>
            <option value="audit">Audit trail</option>
            <option value="api_errors">API errors</option>
          </Select>
        </label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">From</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-40" /></label>
        <label className="text-sm"><span className="text-slate-500 dark:text-slate-400">To</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-40" /></label>
        <Button onClick={download}>Download CSV</Button>
      </div>
    </Card>
  );
}
