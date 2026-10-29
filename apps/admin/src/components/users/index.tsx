/**
 * User-management primitives shared by the Users list page and the User
 * Detail page.
 *
 *   - UserStatusBadge ............ coloured chip for the derived status
 *   - UserFiltersBar ............. search + status/country/agency/date filters
 *   - UserActionMenu ............. per-row "View · Edit · Restrict" menu
 *   - RestrictionDialog .......... modal form for applying a restriction
 *   - EditUserDialog ............. modal form for editing safe profile fields
 *   - AdminNoteForm .............. form + list for admin notes
 *   - Avatar ..................... small circular avatar with initials fallback
 *
 * All presentational: receive data + callbacks, never fetch directly.
 */
import { useState } from "react";
import { Badge, Button, Confirm, Empty, Input, Modal, Select } from "../ui";

// --------------------------------------------------------------------------
// Status badge — colour-coded by derived status
// --------------------------------------------------------------------------
export type UserStatus = "active" | "restricted" | "banned" | "muted" | "frozen";

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const tones: Record<UserStatus, "green" | "amber" | "red" | "slate" | "violet"> = {
    active: "green",
    restricted: "amber",
    banned: "red",
    muted: "amber",
    frozen: "violet",
  };
  const labels: Record<UserStatus, string> = {
    active: "Active",
    restricted: "Restricted",
    banned: "Banned",
    muted: "Muted",
    frozen: "Wallet frozen",
  };
  return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}

// --------------------------------------------------------------------------
// Avatar
// --------------------------------------------------------------------------
export function Avatar({ name, url, size = 32 }: { name: string; url?: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  if (url) {
    return <img src={url} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-violet-500 text-xs font-semibold text-white"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}

// --------------------------------------------------------------------------
// Filters bar
// --------------------------------------------------------------------------
export interface UserFilters {
  search: string;
  status: "" | UserStatus;
  country: string;
  agencyId: string;
  registeredFrom: string;
  registeredTo: string;
  pageSize: number;
}

export const DEFAULT_FILTERS: UserFilters = {
  search: "",
  status: "",
  country: "",
  agencyId: "",
  registeredFrom: "",
  registeredTo: "",
  pageSize: 20,
};

interface UserFiltersBarProps {
  filters: UserFilters;
  onChange: (f: UserFilters) => void;
  onApply: () => void;
  onClear: () => void;
  agencies: { id: number; name: string }[];
  canExport: boolean;
  onExport: () => void;
}

export function UserFiltersBar({ filters, onChange, onApply, onClear, agencies, canExport, onExport }: UserFiltersBarProps) {
  const set = <K extends keyof UserFilters>(k: K, v: UserFilters[K]) => onChange({ ...filters, [k]: v });
  return (
    <div className="mb-3 space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
      >
        <Input
          placeholder="search id / name / phone / email"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          className="!w-64"
        />
        <Select value={filters.status} onChange={(e) => set("status", e.target.value as UserFilters["status"])} className="!w-36">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="restricted">Restricted</option>
          <option value="banned">Banned</option>
          <option value="muted">Muted</option>
          <option value="frozen">Wallet frozen</option>
        </Select>
        <Input placeholder="Country (XX)" value={filters.country} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} className="!w-24" />
        <Select value={filters.agencyId} onChange={(e) => set("agencyId", e.target.value)} className="!w-40">
          <option value="">All agencies</option>
          {agencies.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name}
            </option>
          ))}
        </Select>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          From
          <Input type="date" value={filters.registeredFrom} onChange={(e) => set("registeredFrom", e.target.value)} className="ml-1 !w-36" />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          To
          <Input type="date" value={filters.registeredTo} onChange={(e) => set("registeredTo", e.target.value)} className="ml-1 !w-36" />
        </label>
        <Select value={String(filters.pageSize)} onChange={(e) => set("pageSize", Number(e.target.value))} className="!w-24">
          <option value="10">10 / page</option>
          <option value="20">20 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
        </Select>
        <Button variant="subtle" type="submit">
          Apply
        </Button>
        <Button variant="ghost" onClick={onClear} title="Clear all filters">
          Clear
        </Button>
        {canExport && (
          <Button variant="ghost" onClick={onExport} title="Export the filtered list as CSV">
            Export CSV
          </Button>
        )}
      </form>
    </div>
  );
}

// --------------------------------------------------------------------------
// Restriction dialog — apply a restriction with reason + duration
// --------------------------------------------------------------------------
interface RestrictionDialogProps {
  open: boolean;
  user: { id: number; displayName: string } | null;
  onClose: () => void;
  onApply: (input: { type: "ban" | "mute" | "freeze_wallet" | "kick"; reason: string; durationDays: string; note: string }) => Promise<void>;
}

export function RestrictionDialog({ open, user, onClose, onApply }: RestrictionDialogProps) {
  const [type, setType] = useState<"ban" | "mute" | "freeze_wallet" | "kick">("ban");
  const [reason, setReason] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setType("ban");
    setReason("");
    setDurationDays("");
    setNote("");
    setErr(null);
  };

  const handleApply = async () => {
    if (!user) return;
    if (reason.trim().length < 1) {
      setErr("Reason is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onApply({ type, reason: reason.trim(), durationDays, note: note.trim() });
      reset();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const consequenceMap: Record<string, string> = {
    ban: "User will be blocked from all user-facing APIs (login, wallet, games, rooms, gifts).",
    mute: "User will be blocked from sending voice chat in live rooms.",
    freeze_wallet: "User will be blocked from placing bets (wallet reads remain).",
    kick: "Stored as a kick record. Specific enforcement is application-specific.",
  };

  return (
    <Modal open={open} title={user ? `Apply restriction — ${user.displayName}` : "Apply restriction"} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          Type
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="ban">ban</option>
            <option value="mute">mute</option>
            <option value="freeze_wallet">freeze_wallet</option>
            <option value="kick">kick</option>
          </Select>
        </label>
        <label className="block text-sm">
          Reason <span className="text-rose-500">*</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="required" />
        </label>
        <label className="block text-sm">
          Duration (days, empty = permanent)
          <Input type="number" min={1} max={3650} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} placeholder="e.g. 7" />
        </label>
        <label className="block text-sm">
          Internal note (optional)
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="context for other admins" />
        </label>
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <strong>Consequence:</strong> {consequenceMap[type]}
        </div>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={handleApply}>
            {busy ? "Applying…" : "Apply restriction"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Edit-user dialog — safe profile fields only
// --------------------------------------------------------------------------
interface EditUserDialogProps {
  open: boolean;
  user: {
    id: number;
    displayName: string;
    country: string;
    agencyId: number | null;
    vipLevel: number;
    nobleLevel: number;
    avatarUrl: string;
  } | null;
  agencies: { id: number; name: string }[];
  onClose: () => void;
  onSave: (input: { displayName: string; country: string; agencyId: number | null; vipLevel: number; nobleLevel: number; avatarUrl: string }) => Promise<void>;
}

export function EditUserDialog({ open, user, agencies, onClose, onSave }: EditUserDialogProps) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [country, setCountry] = useState(user?.country ?? "");
  const [agencyId, setAgencyId] = useState(user?.agencyId ? String(user.agencyId) : "");
  const [vipLevel, setVipLevel] = useState(String(user?.vipLevel ?? 0));
  const [nobleLevel, setNobleLevel] = useState(String(user?.nobleLevel ?? 0));
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user) return;
    if (displayName.trim().length < 2) {
      setErr("Display name must be at least 2 characters");
      return;
    }
    if (country.length !== 2) {
      setErr("Country must be a 2-letter code");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave({
        displayName: displayName.trim(),
        country: country.toUpperCase(),
        agencyId: agencyId ? Number(agencyId) : null,
        vipLevel: Number(vipLevel) || 0,
        nobleLevel: Number(nobleLevel) || 0,
        avatarUrl: avatarUrl.trim(),
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open || !user) return null;

  return (
    <Modal open={open} title={`Edit profile — ${user.displayName}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          Display name
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="block text-sm">
          Country (2-letter)
          <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
        </label>
        <label className="block text-sm">
          Agency
          <Select value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
            <option value="">— none —</option>
            {agencies.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            VIP level
            <Input type="number" min={0} max={100} value={vipLevel} onChange={(e) => setVipLevel(e.target.value)} />
          </label>
          <label className="block text-sm">
            Noble level
            <Input type="number" min={0} max={100} value={nobleLevel} onChange={(e) => setNobleLevel(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          Avatar URL
          <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
        </label>
        <p className="text-xs text-slate-400">
          Phone, email, and password are NOT editable from the admin panel — they go through the auth flows (OTP, password reset).
        </p>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={handleSave}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Admin notes — form + list
// --------------------------------------------------------------------------
export interface AdminNote {
  id: number;
  category: string;
  body: string;
  internal: boolean;
  createdAt: string;
  admin: { id: number; username: string; displayName: string } | null;
}

interface AdminNoteFormProps {
  userId: number;
  notes: AdminNote[];
  onAdd: (input: { category: string; body: string; internal: boolean }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

export function AdminNoteForm({ userId, notes, onAdd, onDelete }: AdminNoteFormProps) {
  const [category, setCategory] = useState("general");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const handleAdd = async () => {
    if (body.trim().length < 1) return;
    setBusy(true);
    try {
      await onAdd({ category, body: body.trim(), internal });
      setBody("");
    } finally {
      setBusy(false);
    }
  };

  void userId;

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="!w-40">
            <option value="general">general</option>
            <option value="review">review</option>
            <option value="moderation">moderation</option>
            <option value="escalation">escalation</option>
            <option value="financial">financial</option>
            <option value="other">other</option>
          </Select>
          <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            Internal (never exposed to mobile)
          </label>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add an internal note for other admins…"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
        <div className="flex justify-end">
          <Button disabled={busy || body.trim().length < 1} onClick={handleAdd}>
            {busy ? "Adding…" : "+ Add note"}
          </Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <Empty text="No notes yet." />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone="violet">{n.category}</Badge>
                  {n.internal && <Badge tone="slate">internal</Badge>}
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(n.id)}
                  className="text-xs text-slate-400 hover:text-rose-600"
                  aria-label="Delete note"
                >
                  Delete
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{n.body}</p>
              <p className="mt-1 text-xs text-slate-400">
                by {n.admin?.displayName ?? "system"} · {n.createdAt.slice(0, 19).replace("T", " ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Confirm
        open={confirmDelete !== null}
        text="Delete this note permanently? The action is recorded in the audit log."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete !== null) {
            await onDelete(confirmDelete);
            setConfirmDelete(null);
          }
        }}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Action menu — per-row dropdown for "View · Edit · Restrict"
// --------------------------------------------------------------------------
interface UserActionMenuProps {
  canEdit: boolean;
  canRestrict: boolean;
  canWalletWrite: boolean;
  onView: () => void;
  onEdit: () => void;
  onRestrict: () => void;
  onWallet: () => void;
}

export function UserActionMenu(props: UserActionMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block text-left">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} title="Actions">
        ⋯
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                props.onView();
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              View details
            </button>
            {props.canEdit && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onEdit();
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Edit profile
              </button>
            )}
            {props.canRestrict && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onRestrict();
                }}
                className="block w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-900/30"
              >
                Apply restriction…
              </button>
            )}
            {props.canWalletWrite && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  props.onWallet();
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Wallet actions…
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Tiny helper: build the export-URL query string from the active filters
// --------------------------------------------------------------------------
export function buildExportUrl(filters: UserFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.country) params.set("country", filters.country);
  if (filters.agencyId) params.set("agencyId", filters.agencyId);
  if (filters.registeredFrom) params.set("registeredFrom", filters.registeredFrom);
  if (filters.registeredTo) params.set("registeredTo", filters.registeredTo);
  return `/v1/admin/users/export?${params.toString()}`;
}
