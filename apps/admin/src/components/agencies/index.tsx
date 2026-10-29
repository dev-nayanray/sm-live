/**
 * Agency-management primitives shared by the Agencies list page and the
 * Agency Detail page (Prompt 04).
 *
 *   - AgencyStatusBadge     coloured chip for derived status
 *   - AgencyFiltersBar      search + status/country/date filters
 *   - CreateAgencyDialog    modal form for creating an agency
 *   - EditAgencyDialog      modal form for editing agency profile fields
 *   - StatusChangeDialog    confirmation modal for activate/suspend
 *   - AssignAdminDialog     modal for assigning an existing admin
 *   - AssignMemberDialog    modal for assigning a user as a member
 *
 * All presentational: receive data + callbacks, never fetch directly.
 */
import { useState } from "react";
import { Badge, Button, Confirm, Input, Modal, Select } from "../ui";

// --------------------------------------------------------------------------
// Status badge
// --------------------------------------------------------------------------
export type AgencyStatus = "active" | "suspended";

export function AgencyStatusBadge({ status }: { status: AgencyStatus }) {
  const tones: Record<AgencyStatus, "green" | "amber" | "red" | "slate" | "violet"> = {
    active: "green",
    suspended: "amber",
  };
  const labels: Record<AgencyStatus, string> = {
    active: "Active",
    suspended: "Suspended",
  };
  return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}

// --------------------------------------------------------------------------
// Filters bar
// --------------------------------------------------------------------------
export interface AgencyFilters {
  search: string;
  status: "" | AgencyStatus;
  country: string;
  createdFrom: string;
  createdTo: string;
  pageSize: number;
}

export const DEFAULT_AGENCY_FILTERS: AgencyFilters = {
  search: "",
  status: "",
  country: "",
  createdFrom: "",
  createdTo: "",
  pageSize: 20,
};

interface AgencyFiltersBarProps {
  filters: AgencyFilters;
  onChange: (f: AgencyFilters) => void;
  onApply: () => void;
  onClear: () => void;
  canExport: boolean;
  onExport: () => void;
}

export function AgencyFiltersBar({ filters, onChange, onApply, onClear, canExport, onExport }: AgencyFiltersBarProps) {
  const set = <K extends keyof AgencyFilters>(k: K, v: AgencyFilters[K]) => onChange({ ...filters, [k]: v });
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
          placeholder="search id / name / code"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          className="!w-64"
        />
        <Select value={filters.status} onChange={(e) => set("status", e.target.value as AgencyFilters["status"])} className="!w-36">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Input placeholder="Country (XX)" value={filters.country} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} className="!w-24" />
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
          <option value="100">100 / page</option>
        </Select>
        <Button variant="subtle" type="submit">Apply</Button>
        <Button variant="ghost" onClick={onClear} title="Clear all filters">Clear</Button>
        {canExport && (
          <Button variant="ghost" onClick={onExport} title="Export the filtered list as CSV">Export CSV</Button>
        )}
      </form>
    </div>
  );
}

// --------------------------------------------------------------------------
// Create agency dialog
// --------------------------------------------------------------------------
interface CreateAgencyDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    code: string;
    description: string;
    contactEmail: string;
    contactPhone: string;
    country: string;
    commissionRate: string;
    parentId: string;
  }) => Promise<void>;
  agencies: { id: number; name: string }[];
}

export function CreateAgencyDialog({ open, onClose, onCreate, agencies }: CreateAgencyDialogProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [country, setCountry] = useState("");
  const [commissionRate, setCommissionRate] = useState("0.10");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleCreate = async () => {
    if (name.trim().length < 2) { setErr("Name must be at least 2 characters"); return; }
    if (!/^[a-z0-9_-]{2,40}$/.test(code)) { setErr("Code must be 2-40 lowercase letters, digits, _ or -"); return; }
    if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) { setErr("Invalid contact email"); return; }
    if (country && country.length !== 2) { setErr("Country must be a 2-letter code"); return; }
    const rate = Number(commissionRate);
    if (Number.isNaN(rate) || rate < 0 || rate > 1) { setErr("Commission rate must be between 0 and 1"); return; }
    setBusy(true);
    setErr(null);
    try {
      await onCreate({ name: name.trim(), code, description: description.trim(), contactEmail: contactEmail.trim(), contactPhone: contactPhone.trim(), country: country.toUpperCase(), commissionRate, parentId });
      setName(""); setCode(""); setDescription(""); setContactEmail(""); setContactPhone(""); setCountry(""); setCommissionRate("0.10"); setParentId("");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Create agency" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          Name <span className="text-rose-500">*</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dhaka Agency" />
        </label>
        <label className="block text-sm">
          Code <span className="text-rose-500">*</span>
          <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="e.g. ag-dhaka" className="font-mono" />
          <span className="text-xs text-slate-400">2-40 lowercase letters, digits, _ or -</span>
        </label>
        <label className="block text-sm">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="optional" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Contact email
            <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="optional" />
          </label>
          <label className="block text-sm">
            Contact phone
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="optional" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Country
            <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="BD" maxLength={2} />
          </label>
          <label className="block text-sm">
            Commission rate
            <Input type="number" step="0.01" min={0} max={1} value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          Parent agency
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— none (top-level) —</option>
            {agencies.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </Select>
        </label>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={handleCreate}>{busy ? "Creating…" : "Create agency"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Edit agency dialog
// --------------------------------------------------------------------------
interface EditAgencyDialogProps {
  open: boolean;
  agency: {
    id: number;
    name: string;
    description: string;
    contactEmail: string;
    contactPhone: string;
    country: string;
    commissionRate: number;
    parentId: number | null;
  } | null;
  agencies: { id: number; name: string }[];
  onClose: () => void;
  onSave: (input: {
    name: string;
    description: string;
    contactEmail: string;
    contactPhone: string;
    country: string;
    commissionRate: string;
    parentId: string;
  }) => Promise<void>;
}

export function EditAgencyDialog({ open, agency, agencies, onClose, onSave }: EditAgencyDialogProps) {
  const [name, setName] = useState(agency?.name ?? "");
  const [description, setDescription] = useState(agency?.description ?? "");
  const [contactEmail, setContactEmail] = useState(agency?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(agency?.contactPhone ?? "");
  const [country, setCountry] = useState(agency?.country ?? "");
  const [commissionRate, setCommissionRate] = useState(String(agency?.commissionRate ?? 0.1));
  const [parentId, setParentId] = useState(agency?.parentId ? String(agency.parentId) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    if (!agency) return;
    if (name.trim().length < 2) { setErr("Name must be at least 2 characters"); return; }
    setBusy(true);
    setErr(null);
    try {
      await onSave({ name: name.trim(), description: description.trim(), contactEmail: contactEmail.trim(), contactPhone: contactPhone.trim(), country: country.toUpperCase(), commissionRate, parentId });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open || !agency) return null;

  return (
    <Modal open={open} title={`Edit agency — ${agency.name}`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Contact email
            <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </label>
          <label className="block text-sm">
            Contact phone
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Country
            <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
          </label>
          <label className="block text-sm">
            Commission rate
            <Input type="number" step="0.01" min={0} max={1} value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          Parent agency
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— none (top-level) —</option>
            {agencies.filter((a) => a.id !== agency.id).map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name}</option>
            ))}
          </Select>
        </label>
        <p className="text-xs text-slate-400">Code cannot be changed after creation (uniqueness constraint). Status changes go through the dedicated action.</p>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Status change dialog (activate / suspend)
// --------------------------------------------------------------------------
interface StatusChangeDialogProps {
  open: boolean;
  agency: { id: number; name: string; status: AgencyStatus } | null;
  action: "activate" | "suspend";
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export function StatusChangeDialog({ open, agency, action, onClose, onConfirm }: StatusChangeDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const consequence = action === "suspend"
    ? "The agency will be marked inactive. Its members and admins retain their accounts and permissions, but operators should treat the agency as not-onboarding. Full mobile-app enforcement is documented as a future task."
    : "The agency will be marked active again. Existing admins resume their normal access.";

  const handleConfirm = async () => {
    if (reason.trim().length < 1) { setErr("Reason is required"); return; }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      setReason("");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={`${action === "suspend" ? "Suspend" : "Activate"} agency — ${agency?.name ?? ""}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <strong>Consequence:</strong> {consequence}
        </div>
        <label className="block text-sm">
          Reason <span className="text-rose-500">*</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="required — recorded in audit log" />
        </label>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant={action === "suspend" ? "danger" : "primary"} disabled={busy} onClick={handleConfirm}>
            {busy ? "Applying…" : action === "suspend" ? "Suspend agency" : "Activate agency"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Assign admin dialog
// --------------------------------------------------------------------------
interface AssignAdminDialogProps {
  open: boolean;
  agencyName: string;
  onClose: () => void;
  onAssign: (adminId: number) => Promise<void>;
  searchAdmins: (q: string) => Promise<{ id: number; username: string; displayName: string; role: { key: string; name: string }; agencyId: number | null }[]>;
}

export function AssignAdminDialog({ open, agencyName, onClose, onAssign, searchAdmins }: AssignAdminDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: number; username: string; displayName: string; role: { key: string; name: string }; agencyId: number | null }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSearch = async () => {
    setErr(null);
    try {
      const r = await searchAdmins(query);
      setResults(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleAssign = async () => {
    if (selected == null) return;
    setBusy(true);
    setErr(null);
    try {
      await onAssign(selected);
      setQuery(""); setResults([]); setSelected(null);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={`Assign admin — ${agencyName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Search for an existing admin user. We do not create new admin accounts here — that goes through the Security → Admin users page (which now accepts an agency).
          Super admins cannot be assigned to a single agency.
        </p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void handleSearch(); }}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search username / display name" className="!w-64" />
          <Button variant="subtle" type="submit">Search</Button>
        </form>
        {results.length > 0 && (
          <ul className="max-h-60 overflow-y-auto space-y-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {results.map((a) => (
              <li key={a.id}>
                <label className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${selected === a.id ? "bg-violet-50 dark:bg-violet-500/10" : ""}`}>
                  <input type="radio" name="admin" checked={selected === a.id} onChange={() => setSelected(a.id)} />
                  <div className="flex-1">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{a.displayName} <span className="text-xs text-slate-400">@{a.username}</span></div>
                    <div className="text-xs text-slate-400">role: {a.role.key} · agency: {a.agencyId ?? "none"}</div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || selected == null} onClick={handleAssign}>{busy ? "Assigning…" : "Assign to agency"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Assign member dialog
// --------------------------------------------------------------------------
interface AssignMemberDialogProps {
  open: boolean;
  agencyName: string;
  onClose: () => void;
  onAssign: (userId: number) => Promise<void>;
  searchUsers: (q: string) => Promise<{ id: number; displayName: string; country: string; agency: string | null }[]>;
}

export function AssignMemberDialog({ open, agencyName, onClose, onAssign, searchUsers }: AssignMemberDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: number; displayName: string; country: string; agency: string | null }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSearch = async () => {
    setErr(null);
    try {
      const r = await searchUsers(query);
      setResults(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleAssign = async () => {
    if (selected == null) return;
    setBusy(true);
    setErr(null);
    try {
      await onAssign(selected);
      setQuery(""); setResults([]); setSelected(null);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={`Assign member — ${agencyName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Search for an existing user. Adds them to the agency's membership roster. The user's primary agency (User.agencyId) is unchanged — the two relations are independent.
        </p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void handleSearch(); }}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search user id / name" className="!w-64" />
          <Button variant="subtle" type="submit">Search</Button>
        </form>
        {results.length > 0 && (
          <ul className="max-h-60 overflow-y-auto space-y-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {results.map((u) => (
              <li key={u.id}>
                <label className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${selected === u.id ? "bg-violet-50 dark:bg-violet-500/10" : ""}`}>
                  <input type="radio" name="user" checked={selected === u.id} onChange={() => setSelected(u.id)} />
                  <div className="flex-1">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{u.displayName} <span className="text-xs text-slate-400">#{u.id}</span></div>
                    <div className="text-xs text-slate-400">{u.country} · agency: {u.agency ?? "none"}</div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
        {err && <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || selected == null} onClick={handleAssign}>{busy ? "Assigning…" : "Assign to agency"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// Re-export Confirm for the remove-member / remove-admin confirmations.
export { Confirm };
