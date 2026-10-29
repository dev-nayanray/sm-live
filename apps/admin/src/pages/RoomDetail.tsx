/**
 * SM Live — Super Admin Room Detail page (Prompt 05).
 *
 * Route: /live/:id (under the existing Layout + RequirePerm perm="rooms.read")
 *
 * Four sections:
 *   A. Room overview       — profile fields, host, status, slots
 *   B. Participants         — live participant list with kick/mute actions
 *   C. Reports              — room-level reports with create + status update
 *   D. Event timeline       — room events (created, closed, kicked, muted, etc.)
 *
 * Single GET /v1/admin/rooms/:id fetches profile + participants + open reports
 * + recent events. Events have a separate paginated endpoint for full history.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal } from "../components/ui";
import { Avatar } from "../components/users";
import {
  CloseRoomDialog,
  KickDialog,
  MuteDialog,
  ReportDialog,
  RoomStatusBadge,
  RoomTypeBadge,
} from "../components/live";
import { Icon } from "../components/Icon";

interface RoomDetail {
  profile: {
    id: number; title: string; type: string; slots: number; country: string;
    hostId: number; host: { id: number; displayName: string; avatarUrl: string; country: string; vipLevel: number };
    isLocked: boolean; livekitRoom: string;
    status: "active" | "closed"; closedAt: string | null; createdAt: string;
  };
  participants: {
    id: number; userId: number; displayName: string; avatarUrl: string; country: string;
    vipLevel: number; role: string; slotIndex: number | null; muted: boolean;
    joinedAt: string; restrictions: { type: string; expiresAt: string | null }[];
    userStatus: string;
  }[];
  participantCount: number;
  openReports: {
    id: number; category: string; description: string; status: string;
    reporterId: number | null; reportedUserId: number | null;
    reviewNote: string; createdAt: string;
  }[];
  recentEvents: {
    id: number; type: string; userId: number | null; adminId: number | null;
    details: unknown; createdAt: string;
  }[];
  counts: { reports: number; events: number };
}

export function RoomDetail() {
  const { id } = useParams<{ id: string }>();
  const roomId = Number(id);
  const { can } = useAuth();
  const qc = useQueryClient();
  const [closeOpen, setCloseOpen] = useState(false);
  const [kickTarget, setKickTarget] = useState<{ userId: number; displayName: string } | null>(null);
  const [muteTarget, setMuteTarget] = useState<{ userId: number; displayName: string; muted: boolean } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmReportStatus, setConfirmReportStatus] = useState<{ rid: number; status: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const canWrite = can("rooms.write");

  const q = useQuery({
    queryKey: ["room-detail", roomId],
    queryFn: () => api<RoomDetail>(`/v1/admin/rooms/${roomId}`),
    enabled: !Number.isNaN(roomId) && roomId > 0,
    refetchInterval: 15_000,
  });

  if (Number.isNaN(roomId) || roomId <= 0) return <ErrorBox error={new Error("Invalid room id")} />;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Empty text="Room not found." />;

  const d = q.data;

  const handleKick = async (reason: string) => {
    if (!kickTarget) return;
    await api(`/v1/admin/rooms/${roomId}/participants/${kickTarget.userId}/kick`, { method: "POST", json: { reason } });
    setToast(`Participant ${kickTarget.displayName} removed`);
    void qc.invalidateQueries({ queryKey: ["room-detail", roomId] });
  };
  const handleMute = async (reason: string) => {
    if (!muteTarget) return;
    await api(`/v1/admin/rooms/${roomId}/participants/${muteTarget.userId}/mute`, {
      method: "POST",
      json: { muted: !muteTarget.muted, ...(reason ? { reason } : {}) },
    });
    setToast(`Participant ${muteTarget.displayName} ${muteTarget.muted ? "unmuted" : "muted"}`);
    void qc.invalidateQueries({ queryKey: ["room-detail", roomId] });
  };
  const handleClose = async (reason: string) => {
    await api(`/v1/admin/rooms/${roomId}/close`, { method: "POST", json: { reason } });
    setToast("Room closed");
    setCloseOpen(false);
    void qc.invalidateQueries({ queryKey: ["room-detail", roomId] });
    void qc.invalidateQueries({ queryKey: ["admin-rooms"] });
    void qc.invalidateQueries({ queryKey: ["rooms-summary"] });
  };
  const handleCreateReport = async (input: { category: string; description: string; reportedUserId: string }) => {
    const body: Record<string, unknown> = { category: input.category, description: input.description };
    if (input.reportedUserId) body.reportedUserId = Number(input.reportedUserId);
    await api(`/v1/admin/rooms/${roomId}/reports`, { method: "POST", json: body });
    setToast("Report filed");
    void qc.invalidateQueries({ queryKey: ["room-detail", roomId] });
    void qc.invalidateQueries({ queryKey: ["rooms-summary"] });
  };
  const handleReportStatus = async (rid: number, status: string) => {
    await api(`/v1/admin/rooms/${roomId}/reports/${rid}`, { method: "PATCH", json: { status } });
    setToast(`Report #${rid} marked ${status}`);
    setConfirmReportStatus(null);
    void qc.invalidateQueries({ queryKey: ["room-detail", roomId] });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/live" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            <Icon name="chevronLeft" className="h-4 w-4" /> Rooms
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{d.profile.title}</h1>
              <RoomTypeBadge type={d.profile.type} />
              <RoomStatusBadge status={d.profile.status} />
              {d.profile.isLocked && <Badge tone="amber">locked</Badge>}
            </div>
            <div className="text-xs text-slate-400">
              #{d.profile.id} · {d.profile.country} · {d.participantCount}/{d.profile.slots} participants
              · created {d.profile.createdAt.slice(0, 19).replace("T", " ")}
              {d.profile.closedAt && ` · closed ${d.profile.closedAt.slice(0, 19).replace("T", " ")}`}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {canWrite && d.profile.status === "active" && (
            <Button variant="danger" onClick={() => setCloseOpen(true)}>Close room</Button>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
          <button type="button" className="ml-3 text-slate-300 hover:text-white" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* A. Overview */}
        <Card title="Room overview">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-400">Title</dt><dd className="text-slate-700 dark:text-slate-200">{d.profile.title}</dd>
            <dt className="text-slate-400">Type</dt><dd><RoomTypeBadge type={d.profile.type} /></dd>
            <dt className="text-slate-400">Status</dt><dd><RoomStatusBadge status={d.profile.status} /></dd>
            <dt className="text-slate-400">Host</dt>
            <dd><Link to={`/users/${d.profile.hostId}`} className="text-violet-600 dark:text-violet-300">{d.profile.host.displayName}</Link> <span className="text-xs text-slate-400">#{d.profile.hostId}</span></dd>
            <dt className="text-slate-400">Country</dt><dd>{d.profile.country}</dd>
            <dt className="text-slate-400">Slots</dt><dd>{d.profile.slots}</dd>
            <dt className="text-slate-400">Participants</dt><dd>{d.participantCount}</dd>
            <dt className="text-slate-400">Locked</dt><dd>{d.profile.isLocked ? "Yes" : "No"}</dd>
            <dt className="text-slate-400">LiveKit room</dt><dd className="font-mono text-xs">{d.profile.livekitRoom || "—"}</dd>
            <dt className="text-slate-400">Created</dt><dd>{new Date(d.profile.createdAt).toLocaleString()}</dd>
            {d.profile.closedAt && <><dt className="text-slate-400">Closed</dt><dd>{new Date(d.profile.closedAt).toLocaleString()}</dd></>}
          </dl>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><div className="text-slate-400">Reports</div><div className="text-lg font-bold">{d.counts.reports}</div></div>
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><div className="text-slate-400">Events</div><div className="text-lg font-bold">{d.counts.events}</div></div>
            <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/50"><div className="text-slate-400">Open reports</div><div className="text-lg font-bold text-amber-600 dark:text-amber-400">{d.openReports.length}</div></div>
          </div>
        </Card>

        {/* B. Participants */}
        <Card title={`Participants (${d.participantCount})`}>
          {d.participants.length === 0 ? (
            <Empty text="No active participants. Room may be empty or closed." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                  <th className="py-2 pr-3">User</th><th className="px-3">Role</th><th className="px-3">Mic</th><th className="px-3">Status</th><th className="pl-3 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {d.participants.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={p.displayName} url={p.avatarUrl || undefined} size={28} />
                          <div>
                            <Link to={`/users/${p.userId}`} className="font-medium text-violet-600 hover:underline dark:text-violet-300">{p.displayName}</Link>
                            <div className="text-xs text-slate-400">#{p.userId} · {p.country}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3"><Badge tone={p.role === "host" ? "violet" : p.role === "cohost" ? "amber" : "slate"}>{p.role}</Badge></td>
                      <td className="px-3">{p.muted ? <Badge tone="red">muted</Badge> : <Badge tone="green">on</Badge>}</td>
                      <td className="px-3"><Badge tone={p.userStatus === "active" ? "green" : "amber"}>{p.userStatus}</Badge></td>
                      <td className="pl-3 text-right whitespace-nowrap">
                        {canWrite && p.role !== "host" && (
                          <>
                            <button className="text-xs text-slate-500 hover:text-violet-600" onClick={() => setMuteTarget({ userId: p.userId, displayName: p.displayName, muted: p.muted })}>
                              {p.muted ? "Unmute" : "Mute"}
                            </button>
                            <span className="text-slate-300"> · </span>
                            <button className="text-xs text-rose-600 hover:underline" onClick={() => setKickTarget({ userId: p.userId, displayName: p.displayName })}>Kick</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Participant data reflects the last database state — updated every 15 seconds. No real-time presence (heartbeat) is available.
          </p>
        </Card>

        {/* C. Reports */}
        <Card title={`Reports (${d.openReports.length} open)`} actions={canWrite ? <Button variant="ghost" onClick={() => setReportOpen(true)}>+ File report</Button> : undefined}>
          {d.openReports.length === 0 ? (
            <Empty text="No open reports for this room." />
          ) : (
            <ul className="space-y-2 text-sm">
              {d.openReports.map((rp) => (
                <li key={rp.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge tone="violet">{rp.category}</Badge>
                      <Badge tone={rp.status === "open" ? "amber" : "slate"}>{rp.status}</Badge>
                    </div>
                    {canWrite && rp.status !== "resolved" && rp.status !== "dismissed" && (
                      <div className="flex gap-1">
                        <button className="text-xs text-violet-600 hover:underline" onClick={() => setConfirmReportStatus({ rid: rp.id, status: "resolved" })}>Resolve</button>
                        <span className="text-slate-300">·</span>
                        <button className="text-xs text-slate-500 hover:underline" onClick={() => setConfirmReportStatus({ rid: rp.id, status: "dismissed" })}>Dismiss</button>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-300">{rp.description}</p>
                  <div className="mt-1 text-xs text-slate-400">
                    filed {rp.createdAt.slice(0, 19).replace("T", " ")}
                    {rp.reportedUserId && ` · reported user #${rp.reportedUserId}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* D. Event timeline */}
        <Card title={`Event timeline (${d.recentEvents.length} recent)`}>
          {d.recentEvents.length === 0 ? (
            <Empty text="No events recorded for this room." />
          ) : (
            <ul className="space-y-1 text-xs">
              {d.recentEvents.map((e) => (
                <li key={e.id} className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800">
                  <span>
                    <Badge tone="violet">{e.type}</Badge>
                    {e.userId && <span className="ml-2 text-slate-500">user #{e.userId}</span>}
                    {e.adminId && <span className="ml-2 text-slate-500">admin #{e.adminId}</span>}
                  </span>
                  <span className="text-slate-400">{e.createdAt.slice(0, 19).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Dialogs */}
      <CloseRoomDialog open={closeOpen} roomTitle={d.profile.title} onClose={() => setCloseOpen(false)} onConfirm={handleClose} />
      <KickDialog open={kickTarget !== null} participantName={kickTarget?.displayName ?? ""} onClose={() => setKickTarget(null)} onConfirm={handleKick} />
      <MuteDialog open={muteTarget !== null} participantName={muteTarget?.displayName ?? ""} action={muteTarget?.muted ? "unmute" : "mute"} onClose={() => setMuteTarget(null)} onConfirm={handleMute} />
      <ReportDialog open={reportOpen} roomTitle={d.profile.title} onClose={() => setReportOpen(false)} onCreate={handleCreateReport} />

      <Modal open={confirmReportStatus !== null} title="Update report status" onClose={() => setConfirmReportStatus(null)}>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Mark report #{confirmReportStatus?.rid} as <strong>{confirmReportStatus?.status}</strong>? This action is recorded in the audit log.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmReportStatus(null)}>Cancel</Button>
          <Button variant={confirmReportStatus?.status === "dismissed" ? "ghost" : "primary"} onClick={() => confirmReportStatus && handleReportStatus(confirmReportStatus.rid, confirmReportStatus.status)}>Confirm</Button>
        </div>
      </Modal>
    </div>
  );
}
