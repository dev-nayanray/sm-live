/**
 * SM Live — Content Moderation queue.
 *
 * Two feeds:
 *   - Room reports (/v1/admin/room-reports) — in-room abuse reports with a
 *     review state machine (open → in_review → resolved | dismissed).
 *   - Suspicious events (/v1/admin/suspicious) — automated risk signals.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Loading, Modal, Select, Input } from "../components/ui";

interface RoomReportRow {
  id: number; roomId: number; reporterId: number | null; reportedUserId: number | null;
  category: string; description: string; status: string; reviewNote: string;
  createdAt: string;
  room: { id: number; title: string; type: string } | null;
}
interface SuspiciousRow {
  id: number; userId: number | null; kind: string; severity: string; message: string; createdAt: string;
}

const STATUS_TONE: Record<string, "red" | "amber" | "green" | "slate"> = {
  open: "red", in_review: "amber", resolved: "green", dismissed: "slate",
};

export function ContentModeration() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"reports" | "suspicious">("reports");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<RoomReportRow | null>(null);
  const [review, setReview] = useState({ status: "in_review", reviewNote: "" });

  const qs = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (status) qs.set("status", status);

  const reportsQ = useQuery({
    queryKey: ["room-reports", qs.toString()],
    queryFn: () => api<{ total: number; open: number; items: RoomReportRow[] }>(`/v1/admin/room-reports?${qs.toString()}`),
  });
  const suspiciousQ = useQuery({
    queryKey: ["suspicious-feed"],
    queryFn: () => api<{ items: SuspiciousRow[] }>(`/v1/admin/suspicious?page=1&pageSize=50`),
  });

  const submitReview = async () => {
    if (!reviewing) return;
    await api(`/v1/admin/room-reports/${reviewing.id}`, { method: "PATCH", json: review });
    setReviewing(null);
    void qc.invalidateQueries({ queryKey: ["room-reports"] });
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Content Moderation</h1>
      <p className="text-sm text-slate-400 mb-4">Review room reports and automated suspicious-activity signals.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        {[
          { label: "Open reports", value: reportsQ.data?.open ?? "…" },
          { label: "Total reports", value: reportsQ.data?.total ?? "…" },
          { label: "Suspicious (recent)", value: suspiciousQ.data?.items.length ?? "…" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{typeof c.value === "number" ? c.value.toLocaleString() : c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {([["reports", "Room reports"], ["suspicious", "Suspicious activity"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
        {tab === "reports" && (
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!w-36">
            <option value="">All statuses</option>
            {["open", "in_review", "resolved", "dismissed"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        )}
      </div>

      {tab === "reports" && (
        <Card title="Room reports">
          {reportsQ.isLoading ? <Loading /> : (reportsQ.data?.items.length ?? 0) === 0 ? (
            <Empty text="No room reports in this view." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                  <th className="py-2 pr-3">Room</th><th className="px-3">Category</th><th className="px-3">Description</th>
                  <th className="px-3">Reported user</th><th className="px-3">Status</th><th className="px-3">Created</th>
                  {can("rooms.write") && <th className="pl-3 text-right">Action</th>}
                </tr></thead>
                <tbody>
                  {reportsQ.data!.items.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{r.room?.title ?? `room #${r.roomId}`}</div>
                        <div className="text-xs text-slate-400">{r.room?.type ?? ""}</div>
                      </td>
                      <td className="px-3"><Badge tone={r.category === "harassment" || r.category === "inappropriate_content" ? "red" : "slate"}>{r.category}</Badge></td>
                      <td className="px-3 max-w-xs truncate text-slate-500 dark:text-slate-400" title={r.description}>{r.description || "—"}</td>
                      <td className="px-3 text-slate-400">{r.reportedUserId ? `#${r.reportedUserId}` : "—"}</td>
                      <td className="px-3"><Badge tone={STATUS_TONE[r.status] ?? "slate"}>{r.status}</Badge></td>
                      <td className="px-3 text-xs text-slate-400">{r.createdAt.slice(0, 10)}</td>
                      {can("rooms.write") && (
                        <td className="pl-3 text-right">
                          <Button variant="ghost" onClick={() => { setReviewing(r); setReview({ status: r.status === "open" ? "in_review" : r.status, reviewNote: r.reviewNote }); }}>Review</Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-400">page {page}</span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
              <Button variant="ghost" disabled={page * 20 >= (reportsQ.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next →</Button>
            </div>
          </div>
        </Card>
      )}

      {tab === "suspicious" && (
        <Card title="Suspicious activity signals">
          {suspiciousQ.isLoading ? <Loading /> : (suspiciousQ.data?.items.length ?? 0) === 0 ? (
            <Empty text="nothing recorded" />
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                <th className="py-2">User</th><th>Severity</th><th>Kind</th><th>Message</th><th>Time</th>
              </tr></thead>
              <tbody>
                {suspiciousQ.data!.items.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">{s.userId ? `#${s.userId}` : "—"}</td>
                    <td><Badge tone={s.severity === "high" ? "red" : s.severity === "medium" ? "amber" : "slate"}>{s.severity}</Badge></td>
                    <td>{s.kind}</td>
                    <td className="max-w-md truncate text-slate-500 dark:text-slate-400">{s.message}</td>
                    <td className="text-xs text-slate-400">{s.createdAt.slice(0, 16).replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Modal open={reviewing !== null} title={`Review report #${reviewing?.id ?? ""}`} onClose={() => setReviewing(null)}>
        {reviewing && (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
              Room <strong>{reviewing.room?.title ?? reviewing.roomId}</strong> · reported user {reviewing.reportedUserId ? `#${reviewing.reportedUserId}` : "—"} · by {reviewing.reporterId ? `#${reviewing.reporterId}` : "—"}
            </p>
            <p className="text-sm mb-3 rounded-lg bg-slate-100 dark:bg-slate-800 p-2">{reviewing.description || "(no description)"}</p>
            <label className="block text-sm mb-3">Resolution
              <Select value={review.status} onChange={(e) => setReview({ ...review, status: e.target.value })} className="w-full mt-1">
                {["in_review", "resolved", "dismissed"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </label>
            <label className="block text-sm mb-3">Review note
              <Input value={review.reviewNote} onChange={(e) => setReview({ ...review, reviewNote: e.target.value })} placeholder="what action was taken" className="w-full mt-1" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReviewing(null)}>Cancel</Button>
              <Button onClick={() => void submitReview()}>Save decision</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
