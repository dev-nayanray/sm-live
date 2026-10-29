import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Input, Loading, Modal, Select } from "../components/ui";

interface Complaint { id: number; userId: number; subject: string; body: string; status: string; assigneeNote: string; user: { displayName: string }; createdAt: string }
interface Suspicious { id: number; userId: number | null; kind: string; severity: string; message: string; createdAt: string }
interface PlayerDetail {
  user: { id: number; displayName: string; phone: string | null; vipLevel: number; wallet?: { balance: number; frozen: boolean } };
  restrictions: { id: number; type: string; reason: string; createdAt: string }[];
  sessions: { id: number; ip: string; createdAt: string; revokedAt: string | null }[];
  bets: { id: number; amount: number; status: string; game: { code: string }; createdAt: string }[];
  complaints: Complaint[];
  suspicious: Suspicious[];
}

export function Players() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"lookup" | "complaints" | "suspicious">("lookup");
  const [userIdInput, setUserIdInput] = useState("1");
  const [userId, setUserId] = useState<number | null>(null);

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Players</h1>
      <div className="flex gap-2 mb-4">
        {([["lookup", "Player lookup"], ["complaints", "Complaints"], ["suspicious", "Suspicious activity"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>

      {tab === "lookup" && (
        <Card title="Player lookup">
          <form className="flex gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); setUserId(Number(userIdInput)); }}>
            <Input type="number" value={userIdInput} onChange={(e) => setUserIdInput(e.target.value)} className="!w-32" />
            <Button>Load player</Button>
          </form>
          {userId != null && <PlayerDetailPanel userId={userId} canWrite={can("players.write")} />}
        </Card>
      )}
      {tab === "complaints" && <ComplaintsTab canWrite={can("players.write")} />}
      {tab === "suspicious" && <SimpleTable<RSuspicious>
        queryKey={["suspicious"]}
        url="/v1/admin/suspicious"
        cols={(s) => (<>
          <td className="py-2">{s.userId ?? "—"}</td>
          <td><Badge tone={s.severity === "high" ? "red" : s.severity === "medium" ? "amber" : "slate"}>{s.severity}</Badge></td>
          <td>{s.kind}</td>
          <td>{s.message}</td>
          <td className="text-slate-400">{s.createdAt.slice(0, 19).replace("T", " ")}</td>
        </>)}
        header={["User", "Severity", "Kind", "Message", "Time"]}
      />}
    </div>
  );
}

interface RSuspicious { id: number; userId: number | null; kind: string; severity: string; message: string; createdAt: string }

function PlayerDetailPanel({ userId, canWrite }: { userId: number; canWrite: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["player", userId],
    queryFn: () => api<PlayerDetail>(`/v1/admin/players/${userId}/detail`),
  });
  const [restrictOpen, setRestrictOpen] = useState(false);
  const [form, setForm] = useState({ type: "mute", reason: "", days: "" });

  if (isLoading) return <Loading />;
  if (error) return <Empty text="player not found" />;
  const d = data!;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-lg font-bold">{d.user.displayName}</div>
        <Badge tone="violet">user #{d.user.id}</Badge>
        <Badge>{d.user.phone ?? "no phone"}</Badge>
        <Badge>🪙 {(d.user.wallet?.balance ?? 0).toLocaleString()}</Badge>
        {d.user.wallet?.frozen && <Badge tone="red">wallet frozen</Badge>}
        {canWrite && <Button onClick={() => setRestrictOpen(true)}>+ Restriction</Button>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title={`Restrictions (${d.restrictions.length})`}>
          {d.restrictions.length === 0 ? <Empty text="clean record" /> : (
            <ul className="text-sm space-y-1">
              {d.restrictions.map((r) => (
                <li key={r.id} className="flex gap-2 items-center">
                  <Badge tone="red">{r.type}</Badge> {r.reason || "—"}
                  <span className="text-slate-400 text-xs">{r.createdAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Recent bets (${d.bets.length})`}>
          {d.bets.length === 0 ? <Empty text="no bets" /> : (
            <ul className="text-sm space-y-1">
              {d.bets.slice(0, 8).map((b) => (
                <li key={b.id} className="flex justify-between">
                  <span>{b.game.code}</span>
                  <span>{b.amount.toLocaleString()} → <Badge tone={b.status === "won" ? "green" : b.status === "lost" ? "red" : "slate"}>{b.status}</Badge></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Sessions (${d.sessions.length})`}>
          {d.sessions.length === 0 ? <Empty text="no sessions" /> : (
            <ul className="text-sm space-y-1 text-slate-500">
              {d.sessions.slice(0, 6).map((s) => (
                <li key={s.id}>ip {s.ip || "—"} · {s.createdAt.slice(0, 19).replace("T", " ")} {s.revokedAt && "· revoked"}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Complaints (${d.complaints.length})`}>
          {d.complaints.length === 0 ? <Empty text="none" /> : (
            <ul className="text-sm space-y-1">
              {d.complaints.map((c) => <li key={c.id}>{c.subject} — <Badge tone="amber">{c.status}</Badge></li>)}
            </ul>
          )}
        </Card>
      </div>

      <Modal open={restrictOpen} title="Apply restriction" onClose={() => setRestrictOpen(false)}>
        <div className="space-y-3">
          <label className="block text-sm">Type
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["ban", "mute", "freeze_wallet", "kick"].map((t) => <option key={t}>{t}</option>)}
            </Select>
          </label>
          <label className="block text-sm">Reason
            <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          <label className="block text-sm">Expires in (days, empty = permanent)
            <Input type="number" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRestrictOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              await api("/v1/admin/resources/restrictions", {
                method: "POST",
                json: {
                  userId: d.user.id,
                  type: form.type,
                  reason: form.reason || "admin",
                  ...(form.days ? { expiresAt: new Date(Date.now() + Number(form.days) * 86400_000).toISOString() } : {}),
                },
              });
              setRestrictOpen(false);
              void refetch();
            }}>Apply</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ComplaintsTab({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["complaints"],
    queryFn: () => api<{ items: Complaint[] }>("/v1/admin/complaints?page=1&pageSize=50"),
  });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  return (
    <Card title={`Complaints workflow (${items.length})`}>
      {items.length === 0 ? <Empty text="no complaints" /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2">User</th><th>Subject</th><th>Status</th><th>Created</th><th />
          </tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2">{c.user?.displayName}</td>
                <td>{c.subject}<div className="text-xs text-slate-400">{c.body.slice(0, 80)}</div></td>
                <td><Badge tone={c.status === "resolved" ? "green" : c.status === "open" ? "amber" : "slate"}>{c.status}</Badge></td>
                <td className="text-slate-400">{c.createdAt.slice(0, 10)}</td>
                <td className="text-right">
                  {canWrite && c.status !== "resolved" && (
                    <Button variant="ghost" onClick={() => void api(`/v1/admin/complaints/${c.id}`, { method: "PATCH", json: { status: "resolved", assigneeNote: "handled via admin" } }).then(() => refetch())}>
                      Resolve
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function SimpleTable<T extends { id: number }>({ queryKey, url, cols, header }: {
  queryKey: unknown[]; url: string; header: string[]; cols: (row: T) => React.ReactNode;
}) {
  const { data, isLoading } = useQuery({ queryKey, queryFn: () => api<{ items: T[] }>(`${url}?page=1&pageSize=50`) });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  if (items.length === 0) return <Card><Empty text="nothing recorded" /></Card>;
  return (
    <Card>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
          {header.map((h) => <th key={h} className="py-2">{h}</th>)}
        </tr></thead>
        <tbody>{items.map((row) => <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">{cols(row)}</tr>)}</tbody>
      </table>
    </Card>
  );
}
