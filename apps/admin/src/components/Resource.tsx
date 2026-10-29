import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloadCsv } from "../api";
import { useAuth } from "../auth";
import { Button, Confirm, Empty, ErrorBox, Input, Loading, Modal, Select } from "./ui";

export interface FieldDef {
  name: string;
  type: "string" | "string?" | "number" | "boolean" | "enum" | "json" | "date";
  options: string[];
  optional: boolean;
}

interface ResourceMeta {
  key: string;
  label: string;
  fields: FieldDef[];
  searchFields: string[];
  sortFields: string[];
}

interface Row { id?: number | string; key?: string; [k: string]: unknown }

export function ResourceTable({ resource, readPerm, writePerm }: { resource: string; readPerm: string; writePerm: string }) {
  const { can } = useAuth();
  const [meta, setMeta] = useState<ResourceMeta | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortDir });
      if (search) q.set("search", search);
      if (sortBy) q.set("sortBy", sortBy);
      const data = await api<{ total: number; items: Row[] }>(`/v1/admin/resources/${resource}?${q}`);
      setRows(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [resource, page, pageSize, search, sortBy, sortDir]);

  useEffect(() => {
    api<ResourceMeta[]>("/v1/admin/resources").then((all) => {
      setMeta(all.find((m) => m.key === resource) ?? null);
    });
  }, [resource]);
  useEffect(() => { void load(); }, [load]);

  const columns = useMemo(() => {
    if (!meta) return [];
    const priority = ["id", "key", "code", "name", "username", "country"];
    const fields = [...meta.fields].sort((a, b) => {
      const ai = priority.indexOf(a.name); const bi = priority.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return fields.slice(0, 8);
  }, [meta]);

  if (!can(readPerm)) return <Empty text={`no permission: ${readPerm}`} />;

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput); }}>
          <Input placeholder={meta?.searchFields.length ? `search ${meta.searchFields.join(", ")}` : "search"} value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)} className="!w-56" />
          <Button variant="subtle">Search</Button>
        </form>
        {can(writePerm) && <Button onClick={() => setCreating(true)}>+ New</Button>}
        <Button variant="ghost" onClick={() => downloadCsv(`${resource}-page${page}.csv`, rows as Record<string, unknown>[])}>Export CSV</Button>
        <span className="text-sm text-slate-400 ml-auto">{total} rows</span>
      </div>

      {error ? <ErrorBox error={error} /> : null}
      {loading ? <Loading /> : rows.length === 0 ? <Empty text="no rows" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
                {columns.map((c) => (
                  <th key={c.name} className="py-2 pr-4 font-medium cursor-pointer select-none"
                    onClick={() => {
                      if (!meta?.sortFields.includes(c.name)) return;
                      if (sortBy === c.name) setSortDir(sortDir === "asc" ? "desc" : "asc");
                      else { setSortBy(c.name); setSortDir("asc"); }
                    }}>
                    {c.name}{sortBy === c.name ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={String(row.id ?? row.key ?? i)} className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  {columns.map((c) => (
                    <td key={c.name} className="py-2 pr-4 text-slate-700 dark:text-slate-200 max-w-[240px] truncate">
                      <CellValue value={row[c.name]} />
                    </td>
                  ))}
                  <td className="py-2 text-right whitespace-nowrap">
                    {can(writePerm) && <>
                      <Button variant="ghost" onClick={() => setEditing(row)}>Edit</Button>{" "}
                      <Button variant="ghost" onClick={() => setDeleting(row)}>Delete</Button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 text-sm text-slate-500">
        <span>page {page} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>

      {meta && (creating || editing) && (
        <ResourceFormModal
          meta={meta}
          initial={editing ?? undefined}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); void load(); }}
        />
      )}

      <Confirm
        open={!!deleting}
        text={`Delete this ${resource} row permanently?`}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const row = deleting!;
          await api(`/v1/admin/resources/${resource}/${row.id ?? row.key}`, { method: "DELETE" });
          setDeleting(null);
          void load();
        }}
      />
    </div>
  );
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  if (typeof value === "boolean") return value ? "✅" : "—";
  if (typeof value === "object") return <code className="text-xs">{JSON.stringify(value).slice(0, 60)}</code>;
  const s = String(value);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

export function ResourceFormModal({ meta, initial, onClose, onSaved }: {
  meta: ResourceMeta; initial?: Row; onClose: () => void; onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of meta.fields) v[f.name] = initial?.[f.name] ?? defaultFor(f);
    return v;
  });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = clean(values, meta.fields);
      if (initial) {
        await api(`/v1/admin/resources/${meta.key}/${initial.id ?? initial.key}`, { method: "PATCH", json: payload });
      } else {
        await api(`/v1/admin/resources/${meta.key}`, { method: "POST", json: payload });
      }
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={`${initial ? "Edit" : "New"} ${meta.label}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {meta.fields.map((f) => (
          <label key={f.name} className={`text-sm ${f.type === "json" ? "col-span-2" : ""}`}>
            <span className="text-slate-500 dark:text-slate-400">{f.name}{!f.optional && <span className="text-rose-500">*</span>}</span>
            {f.type === "boolean" ? (
              <div className="pt-2"><input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} className="w-5 h-5" /></div>
            ) : f.type === "enum" ? (
              <Select value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                {!f.optional && <option value="">—</option>}
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : f.type === "json" ? (
              <textarea rows={4} value={typeof values[f.name] === "string" ? String(values[f.name]) : JSON.stringify(values[f.name] ?? (f.name === "bottomTabs" ? [] : {}), null, 2)}
                onChange={(e) => set(f.name, e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm font-mono" />
            ) : (
              <Input type={f.type === "number" ? "number" : f.type === "date" ? "datetime-local" : "text"}
                value={String(values[f.name] ?? "")}
                onChange={(e) => set(f.name, f.type === "number" ? Number(e.target.value) : e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}

function defaultFor(f: FieldDef): unknown {
  if (f.type === "boolean") return false;
  if (f.type === "number") return 0;
  if (f.type === "json") return "[]";
  if (f.type === "enum") return f.options[0] ?? "";
  return "";
}

function clean(values: Record<string, unknown>, fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v = values[f.name];
    if (f.type === "json" && typeof v === "string") {
      try { v = JSON.parse(v || (f.name === "bottomTabs" ? "[]" : "{}")); } catch { v = undefined; }
    }
    if (v === "" && f.optional) continue;
    if (v === "" && f.type === "number") continue;
    out[f.name] = v;
  }
  return out;
}
