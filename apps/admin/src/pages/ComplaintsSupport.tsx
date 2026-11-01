/**
 * SM Live — Complaints & Support ticketing queue.
 *
 * Merges the two support channels into one queue:
 *   - user-level Complaints (/v1/admin/complaints)
 *   - support SupportTickets (/v1/admin/support/tickets)
 * Agents can update status / assignee notes (complaints) and reply to
 * tickets (messages endpoint) without leaving the page.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Loading, Modal, Select, Input } from "../components/ui";

interface ComplaintRow {
  id: number; userId: number; subject: string; body: string;
  status: string; assigneeNote: string;
  user: { displayName: string } | null; createdAt: string;
}
interface TicketRow {
  id: number; subject: string; body: string; status: string; priority: string;
  userId: number; assigneeId: number | null; createdAt: string;
}
interface Summary {
  tickets: { total: number; new: number; open: number; inProgress: number; resolved: number; unassigned: number };
  complaints: { total: number; open: number; resolved: number; rejected: number };
}

const STATUS_TONE: Record<string, "red" | "amber" | "green" | "slate" | "violet"> = {
  open: "red", new: "red", in_progress: "amber", in_review: "amber", pending: "amber",
  resolved: "green", closed: "green", rejected: "slate",
};

export function ComplaintsSupport() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"overview" | "complaints" | "tickets">("overview");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Complaints &amp; Support</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["overview", "Queue overview"], ["complaints", "User complaints"], ["tickets", "Support tickets"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "complaints" && <ComplaintsQueue canWrite={can("players.write")} />}
      {tab === "tickets" && <TicketsQueue canWrite={can("players.write")} />}
    </div>
  );
}

function Overview() {
  const { data, isLoading } = useQuery({
    queryKey: ["support-summary"],
    queryFn: () => api<Summary>("/v1/admin/support/summary"),
    refetchInterval: 30_000,
  });
  if (isLoading) return <Loading />;
  const s = data;
  const cards = s ? [
    { label: "Tickets total", value: s.tickets.total },
    { label: "Unassigned", value: s.tickets.unassigned, tone: "text-rose-500" },
    { label: "Tickets in progress", value: s.tickets.inProgress },
    { label: "New tickets", value: s.tickets.new },
    { label: "Complaints open", value: s.complaints.open, tone: "text-rose-500" },
    { label: "Complaints total", value: s.complaints.total },
  ] : [];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
          <div className={`mt-1 text-2xl font-bold ${c.tone ?? "text-slate-800 dark:text-slate-100"}`}>{c.value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

function ComplaintsQueue({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ComplaintRow | null>(null);
  const [form, setForm] = useState({ status: "in_progress", assigneeNote: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["complaints-queue", page],
    queryFn: () => api<{ total: number; items: ComplaintRow[] }>(`/v1/admin/complaints?page=${page}&pageSize=20`),
  });

  const save = async () => {
    if (!editing) return;
    await api(`/v1/admin/complaints/${editing.id}`, { method: "PATCH", json: form });
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["complaints-queue"] });
  };

  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  if (items.length === 0) return <Card><Empty text="no complaints" /></Card>;

  return (
    <Card title={`User complaints (${data?.total ?? 0})`}>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
          <th className="py-2">From</th><th>Subject</th><th>Status</th><th>Note</th><th>Created</th>{canWrite && <th className="text-right">Action</th>}
        </tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2">{c.user?.displayName ?? `#${c.userId}`} <span className="text-xs text-slate-400">#{c.userId}</span></td>
              <td className="max-w-xs"><div className="truncate font-medium" title={c.body}>{c.subject}</div></td>
              <td><Badge tone={STATUS_TONE[c.status] ?? "slate"}>{c.status}</Badge></td>
              <td className="max-w-xs truncate text-slate-400">{c.assigneeNote || "—"}</td>
              <td className="text-xs text-slate-400">{c.createdAt.slice(0, 10)}</td>
              {canWrite && (
                <td className="text-right">
                  <Button variant="ghost" onClick={() => { setEditing(c); setForm({ status: c.status === "open" ? "in_progress" : c.status, assigneeNote: c.assigneeNote }); }}>Handle</Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-slate-400">page {page} · {data?.total ?? 0} total</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button variant="ghost" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>

      <Modal open={editing !== null} title={`Complaint #${editing?.id ?? ""} — ${editing?.subject ?? ""}`} onClose={() => setEditing(null)}>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{editing?.body}</p>
        <label className="block text-sm mb-3">Status
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full mt-1">
            {["open", "in_progress", "resolved", "rejected"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </label>
        <label className="block text-sm mb-3">Assignee note
          <Input value={form.assigneeNote} onChange={(e) => setForm({ ...form, assigneeNote: e.target.value })} placeholder="internal handling note" className="w-full mt-1" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={() => void save()}>Save</Button>
        </div>
      </Modal>
    </Card>
  );
}

function TicketsQueue({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [replyTo, setReplyTo] = useState<TicketRow | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tickets-queue", page],
    queryFn: () => api<{ total: number; items: TicketRow[] }>(`/v1/admin/support/tickets?page=${page}&pageSize=20`),
  });

  const sendReply = async () => {
    if (!replyTo || !reply.trim()) return;
    setSending(true);
    try {
      await api(`/v1/admin/support/tickets/${replyTo.id}/messages`, { method: "POST", json: { body: reply } });
      await api(`/v1/admin/support/tickets/${replyTo.id}`, { method: "PATCH", json: { status: "in_progress" } }).catch(() => undefined);
      setReplyTo(null); setReply("");
      void qc.invalidateQueries({ queryKey: ["tickets-queue"] });
    } finally { setSending(false); }
  };

  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  if (items.length === 0) return <Card><Empty text="no tickets" /></Card>;

  return (
    <Card title={`Support tickets (${data?.total ?? 0})`}>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
          <th className="py-2">#</th><th>Subject</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Created</th>{canWrite && <th className="text-right">Action</th>}
        </tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 text-slate-400">{t.id}</td>
              <td className="max-w-xs"><div className="truncate font-medium" title={t.body}>{t.subject}</div></td>
              <td><Badge tone={t.priority === "high" ? "red" : t.priority === "medium" ? "amber" : "slate"}>{t.priority}</Badge></td>
              <td><Badge tone={STATUS_TONE[t.status] ?? "slate"}>{t.status}</Badge></td>
              <td className="text-slate-400">{t.assigneeId ? `admin #${t.assigneeId}` : <span className="text-rose-400">unassigned</span>}</td>
              <td className="text-xs text-slate-400">{t.createdAt.slice(0, 10)}</td>
              {canWrite && (
                <td className="text-right"><Button variant="ghost" onClick={() => setReplyTo(t)}>Reply</Button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-slate-400">page {page} · {data?.total ?? 0} total</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button variant="ghost" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>

      <Modal open={replyTo !== null} title={`Reply — ticket #${replyTo?.id ?? ""}`} onClose={() => setReplyTo(null)}>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{replyTo?.subject}: {replyTo?.body}</p>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={4}
          placeholder="Write a reply to the user…"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => setReplyTo(null)}>Cancel</Button>
          <Button disabled={sending || !reply.trim()} onClick={() => void sendReply()}>Send reply</Button>
        </div>
      </Modal>
    </Card>
  );
}
