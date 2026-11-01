/**
 * SM Live — Account Restrictions console.
 *
 * Dedicated view over the PlayerRestriction model (was a "planned" nav item;
 * the data was previously only reachable inside player detail + the users
 * page). Shows every active/expired restriction with status review +
 * early lift (delete) for players.write admins.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Loading, Select } from "../components/ui";

interface RestrictionRow {
  id: number;
  userId: number;
  type: string;
  reason: string;
  note: string;
  createdAt: string;
  expiresAt: string | null;
  liftedAt: string | null;
  user?: { id: number; displayName: string } | null;
}

const TYPE_TONE: Record<string, "red" | "amber" | "violet" | "slate"> = {
  ban: "red", mute: "amber", freeze_wallet: "violet", kick: "slate",
};

export function AccountRestrictions() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("active");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [lifting, setLifting] = useState<RestrictionRow | null>(null);

  const qs = new URLSearchParams({ page: String(page), pageSize: "20", sortDir: "desc", sortBy: "createdAt" });
  if (type) qs.set("search", type);
  const listKey = ["restrictions-console", qs.toString()];

  const { data, isLoading, error } = useQuery({
    queryKey: listKey,
    queryFn: () => api<{ total: number; items: RestrictionRow[] }>(`/v1/admin/resources/restrictions?${qs.toString()}`),
  });

  const isActive = (r: RestrictionRow) =>
    !r.liftedAt && (!r.expiresAt || new Date(r.expiresAt) > new Date());

  const rows = (data?.items ?? []).filter((r) => {
    if (status === "active") return isActive(r);
    if (status === "expired") return !isActive(r);
    return true;
  });

  const lift = async () => {
    if (!lifting) return;
    await api(`/v1/admin/users/${lifting.userId}/restrictions/${lifting.id}`, { method: "DELETE" });
    setLifting(null);
    void qc.invalidateQueries({ queryKey: ["restrictions-console"] });
  };

  const counts = {
    ban: rows.filter((r) => r.type === "ban" && isActive(r)).length,
    mute: rows.filter((r) => r.type === "mute" && isActive(r)).length,
    freeze: rows.filter((r) => r.type === "freeze_wallet" && isActive(r)).length,
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Account Restrictions</h1>
      <p className="text-sm text-slate-400 mb-4">Restriction console — every ban / mute / wallet-freeze / kick across the platform.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        {[
          { label: "On page", value: rows.length },
          { label: "Active bans", value: counts.ban },
          { label: "Active mutes", value: counts.mute },
          { label: "Wallet freezes", value: counts.freeze },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{c.value}</div>
          </div>
        ))}
      </div>

      <Card
        title={`Restrictions (${data?.total.toLocaleString() ?? "…"} total)`}
        actions={
          <div className="flex gap-2">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!w-32">
              <option value="active">Active</option>
              <option value="expired">Expired / lifted</option>
              <option value="all">All</option>
            </Select>
            <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="!w-36">
              <option value="">All types</option>
              <option value="ban">ban</option>
              <option value="mute">mute</option>
              <option value="freeze_wallet">freeze_wallet</option>
              <option value="kick">kick</option>
            </Select>
          </div>
        }
      >
        {error ? <ErrorBox error={error} /> : null}
        {isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty text="No restrictions match the current filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                  <th className="py-2 pr-3">User</th>
                  <th className="px-3">Type</th>
                  <th className="px-3">Reason</th>
                  <th className="px-3">Created</th>
                  <th className="px-3">Expires</th>
                  <th className="px-3">State</th>
                  {can("players.write") && <th className="pl-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{r.user?.displayName ?? `user #${r.userId}`}</span>
                      <span className="ml-2 text-xs text-slate-400">#{r.userId}</span>
                    </td>
                    <td className="px-3"><Badge tone={TYPE_TONE[r.type] ?? "slate"}>{r.type}</Badge></td>
                    <td className="px-3 max-w-xs truncate text-slate-500 dark:text-slate-400" title={r.reason}>{r.reason || "—"}</td>
                    <td className="px-3 text-xs text-slate-400">{r.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-3 text-xs text-slate-400">{r.expiresAt ? r.expiresAt.slice(0, 10) : "never"}</td>
                    <td className="px-3">
                      {r.liftedAt ? <Badge>lifted</Badge> : isActive(r) ? <Badge tone="red">active</Badge> : <Badge tone="green">expired</Badge>}
                    </td>
                    {can("players.write") && (
                      <td className="pl-3 text-right">
                        {isActive(r) && <Button variant="ghost" onClick={() => setLifting(r)}>Lift</Button>}
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
            <Button variant="ghost" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next →</Button>
          </div>
        </div>
      </Card>

      <Confirm
        open={lifting !== null}
        text={`Lift the ${lifting?.type ?? ""} on user #${lifting?.userId ?? ""}? They regain access immediately.`}
        onCancel={() => setLifting(null)}
        onConfirm={() => void lift()}
      />
    </div>
  );
}
