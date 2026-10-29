/**
 * Live room monitoring primitives (Prompt 05).
 *
 *   - RoomTypeBadge      coloured chip by room type (live/voice/party)
 *   - RoomStatusBadge    active / closed
 *   - RoomFiltersBar     search + type/status/host/reports filters
 *   - CloseRoomDialog    confirmation with required reason
 *   - KickDialog         confirmation with required reason
 *   - MuteDialog          mute/unmute with reason
 *   - ReportDialog        create a room report
 *   - ReportStatusDialog  update report status + review note
 */
import { useState } from "react";
import { Badge, Button, Input, Modal, Select } from "../ui";

export type RoomType = "live" | "voice" | "party";
export type RoomStatus = "active" | "closed";

export function RoomTypeBadge({ type }: { type: string }) {
  const tone = type === "live" ? "red" : type === "voice" ? "violet" : "amber";
  return <Badge tone={tone as "red" | "violet" | "amber"}>{type}</Badge>;
}

export function RoomStatusBadge({ status }: { status: RoomStatus }) {
  return <Badge tone={status === "active" ? "green" : "slate"}>{status === "active" ? "Active" : "Closed"}</Badge>;
}

// --------------------------------------------------------------------------
// Filters
// --------------------------------------------------------------------------
export interface RoomFilters {
  search: string;
  type: "" | RoomType;
  status: "" | RoomStatus;
  hostId: string;
  hasReports: "" | "true" | "false";
  createdFrom: string;
  createdTo: string;
  pageSize: number;
}

export const DEFAULT_ROOM_FILTERS: RoomFilters = {
  search: "", type: "", status: "active", hostId: "", hasReports: "", createdFrom: "", createdTo: "", pageSize: 20,
};

interface RoomFiltersBarProps {
  filters: RoomFilters;
  onChange: (f: RoomFilters) => void;
  onApply: () => void;
  onClear: () => void;
  canExport: boolean;
  onExport: () => void;
}

export function RoomFiltersBar({ filters, onChange, onApply, onClear, canExport, onExport }: RoomFiltersBarProps) {
  const set = <K extends keyof RoomFilters>(k: K, v: RoomFilters[K]) => onChange({ ...filters, [k]: v });
  return (
    <div className="mb-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); onApply(); }}>
        <Input placeholder="search id / title / host" value={filters.search} onChange={(e) => set("search", e.target.value)} className="!w-56" />
        <Select value={filters.type} onChange={(e) => set("type", e.target.value as RoomFilters["type"])} className="!w-32">
          <option value="">All types</option>
          <option value="live">Live</option>
          <option value="voice">Voice</option>
          <option value="party">Party</option>
        </Select>
        <Select value={filters.status} onChange={(e) => set("status", e.target.value as RoomFilters["status"])} className="!w-32">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </Select>
        <Select value={filters.hasReports} onChange={(e) => set("hasReports", e.target.value as RoomFilters["hasReports"])} className="!w-36">
          <option value="">All rooms</option>
          <option value="true">With open reports</option>
          <option value="false">No open reports</option>
        </Select>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          From
          <Input type="date" value={filters.createdFrom} onChange={(e) => set("createdFrom", e.target.value)} className="ml-1 !w-36" />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          To
          <Input type="date" value={filters.createdTo} onChange={(e) => set("createdTo", e.target.value)} className="ml-1 !w-36" />
        </label>
        <Select value={String(filters.pageSize)} onChange={(e) => set("pageSize", Number(e.target.value))} className="!w-24">
          <option value="10">10 / page</option>
          <option value="20">20 / page</option>
          <option value="50">50 / page</option>
        </Select>
        <Button variant="subtle" type="submit">Apply</Button>
        <Button variant="ghost" onClick={onClear}>Clear</Button>
        {canExport && <Button variant="ghost" onClick={onExport}>Export CSV</Button>}
      </form>
    </div>
  );
}

// --------------------------------------------------------------------------
// Close room dialog
// --------------------------------------------------------------------------
export function CloseRoomDialog({ open, roomTitle, onClose, onConfirm }: {
  open: boolean; roomTitle: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handle = async () => {
    if (reason.trim().length < 1) { setErr("Reason is required"); return; }
    setBusy(true); setErr(null);
    try { await onConfirm(reason.trim()); setReason(""); onClose(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={`Close room — ${roomTitle}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
          <strong>Consequence:</strong> The room will be marked closed. All connected participants will be notified via socket.io. The room record is preserved for audit — not deleted.
        </div>
        <label className="block text-sm">Reason <span className="text-rose-500">*</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="required — recorded in audit log" />
        </label>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={handle}>{busy ? "Closing…" : "Close room"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Kick dialog
// --------------------------------------------------------------------------
export function KickDialog({ open, participantName, onClose, onConfirm }: {
  open: boolean; participantName: string; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handle = async () => {
    if (reason.trim().length < 1) { setErr("Reason is required"); return; }
    setBusy(true); setErr(null);
    try { await onConfirm(reason.trim()); setReason(""); onClose(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={`Remove participant — ${participantName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The participant will be removed from the room immediately. Their wallet, account, and other room memberships are unaffected. A socket.io event notifies connected clients.
        </p>
        <label className="block text-sm">Reason <span className="text-rose-500">*</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="required" />
        </label>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={handle}>{busy ? "Removing…" : "Remove participant"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Mute dialog
// --------------------------------------------------------------------------
export function MuteDialog({ open, participantName, action, onClose, onConfirm }: {
  open: boolean; participantName: string; action: "mute" | "unmute"; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handle = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(reason.trim()); setReason(""); onClose(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={`${action === "mute" ? "Mute" : "Unmute"} — ${participantName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {action === "mute"
            ? "The participant's microphone will be muted in this room. This is a room-specific action — it does NOT create an account-level mute restriction."
            : "The participant's microphone will be unmuted. They can speak again in this room."}
        </p>
        <label className="block text-sm">Reason (optional)
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="context for audit log" />
        </label>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={handle}>{busy ? "Applying…" : action === "mute" ? "Mute participant" : "Unmute participant"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Report dialog (create)
// --------------------------------------------------------------------------
export function ReportDialog({ open, roomTitle, onClose, onCreate }: {
  open: boolean; roomTitle: string; onClose: () => void; onCreate: (input: { category: string; description: string; reportedUserId: string }) => Promise<void>;
}) {
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [reportedUserId, setReportedUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handle = async () => {
    if (description.trim().length < 1) { setErr("Description is required"); return; }
    setBusy(true); setErr(null);
    try { await onCreate({ category, description: description.trim(), reportedUserId: reportedUserId.trim() }); setDescription(""); setReportedUserId(""); setCategory("other"); onClose(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={`File report — ${roomTitle}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">Category
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="harassment">Harassment</option>
            <option value="inappropriate_content">Inappropriate content</option>
            <option value="spam">Spam</option>
            <option value="impersonation">Impersonation</option>
            <option value="suspicious">Suspicious behavior</option>
            <option value="other">Other</option>
          </Select>
        </label>
        <label className="block text-sm">Reported user ID (optional)
          <Input type="number" value={reportedUserId} onChange={(e) => setReportedUserId(e.target.value)} placeholder="user id" />
        </label>
        <label className="block text-sm">Description <span className="text-rose-500">*</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" placeholder="describe the issue" />
        </label>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={handle}>{busy ? "Filing…" : "File report"}</Button>
        </div>
      </div>
    </Modal>
  );
}
