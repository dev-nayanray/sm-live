import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, downloadCsv } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Input, Loading, Modal } from "../components/ui";
import { ResourceTable } from "../components/Resource";

interface UserRow { id: number; displayName: string; phone: string | null; email: string | null; marketCode: string; country: string; vipLevel: number; balance: number; frozen: boolean; agency: string | null; createdAt: string }
interface AgencyNode { id: number; name: string; code: string; commissionRate: number; parentId: number | null; userCount: number; children?: AgencyNode[]; parent?: { name: string } }

export function UsersAgencies() {
  const [tab, setTab] = useState<"users" | "agencies" | "country" | "restrictions">("users");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Users &amp; Agencies</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["users", "Users"], ["agencies", "Agency tree & commission"], ["country", "Country filters"], ["restrictions", "Restrictions"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "agencies" && <AgenciesTab />}
      {tab === "country" && <Card title="Country filters (per market)"><ResourceTable resource="country-filters" readPerm="settings.read" writePerm="settings.write" /></Card>}
      {tab === "restrictions" && <Card title="Player restrictions"><ResourceTable resource="restrictions" readPerm="players.read" writePerm="players.write" /></Card>}
    </div>
  );
}

function UsersTab() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [walletTarget, setWalletTarget] = useState<UserRow | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-users", page, search],
    queryFn: () => api<{ total: number; items: UserRow[] }>(`/v1/admin/users?page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });
  if (isLoading) return <Loading />;
  const items = data?.items ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  return (
    <Card title={`Users (${data?.total ?? 0})`} actions={
      <Button variant="ghost" onClick={() => downloadCsv("users.csv", items as unknown as Record<string, unknown>[])}>Export CSV</Button>
    }>
      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput); }}>
        <Input placeholder="search name / phone / email" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="!w-64" />
        <Button variant="subtle">Search</Button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2">ID</th><th>Name</th><th>Phone</th><th>Market</th><th>VIP</th><th>Balance</th><th>Agency</th><th>Joined</th><th />
          </tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2">{u.id}</td>
                <td className="font-medium">{u.displayName} {u.frozen && <Badge tone="red">frozen</Badge>}</td>
                <td className="text-slate-400">{u.phone ?? u.email}</td>
                <td>{u.marketCode}</td>
                <td>{u.vipLevel > 0 ? `VIP${u.vipLevel}` : "—"}</td>
                <td className="font-semibold">{u.balance.toLocaleString()}</td>
                <td>{u.agency ?? "—"}</td>
                <td className="text-slate-400">{u.createdAt.slice(0, 10)}</td>
                <td className="text-right">
                  {can("wallet.write") && <Button variant="ghost" onClick={() => setWalletTarget(u)}>Wallet</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center mt-3 text-sm">
        <span className="text-slate-400">page {page} / {pages}</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</Button>
        </div>
      </div>
      {walletTarget && <WalletModal user={walletTarget} onClose={() => setWalletTarget(null)} onDone={refetch} />}
    </Card>
  );
}

function WalletModal({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (path: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ balance: number }>(`/v1/admin/users/${user.id}/${path}`, {
        method: "POST",
        json: { amount: Number(amount), reason: reason || "admin action" },
      });
      setMsg(`done — new balance ${res.balance.toLocaleString()}`);
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Wallet — ${user.displayName} (${user.balance.toLocaleString()} 🪙)`} onClose={onClose}>
      <div className="flex gap-2 items-end">
        <label className="text-sm flex-1">Amount
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="text-sm flex-1">Reason
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="note" />
        </label>
      </div>
      {msg && <div className="text-sm text-violet-500 mt-3">{msg}</div>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" disabled={busy} onClick={() => void act("recharge")}>Recharge (agency panel)</Button>
        <Button disabled={busy} onClick={() => void act("adjust")}>Adjust balance</Button>
      </div>
      <p className="text-xs text-slate-400 mt-2">Both go through the ledger with an audit entry.</p>
    </Modal>
  );
}

function AgenciesTab() {
  const { can } = useAuth();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["agencies"], queryFn: () => api<AgencyNode[]>("/v1/admin/agencies") });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", commissionRate: "0.1", parentId: "" });
  if (isLoading) return <Loading />;
  const nodes = data ?? [];
  if (nodes.length === 0) return <Empty text="no agencies" />;

  return (
    <Card title="Agency tree" actions={can("agencies.write") ? <Button onClick={() => setCreating(!creating)}>+ New agency</Button> : undefined}>
      {creating && (
        <form className="flex flex-wrap gap-2 mb-4 items-end" onSubmit={async (e) => {
          e.preventDefault();
          await api("/v1/admin/agencies", {
            method: "POST",
            json: { name: form.name, code: form.code, commissionRate: Number(form.commissionRate), ...(form.parentId ? { parentId: Number(form.parentId) } : {}) },
          });
          setCreating(false);
          void refetch();
        }}>
          <label className="text-xs">name<br /><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="text-xs">code<br /><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label className="text-xs">commission<br /><Input type="number" step="0.01" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} /></label>
          <label className="text-xs">parent id<br /><Input type="number" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} /></label>
          <Button>Create</Button>
        </form>
      )}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
          <th className="py-2">Agency</th><th>Code</th><th>Parent</th><th>Commission</th><th>Users</th>
        </tr></thead>
        <tbody>
          {nodes.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2 font-medium">{a.parentId ? <span className="text-slate-400 mr-1">└</span> : null}{a.name}</td>
              <td>{a.code}</td>
              <td>{a.parent?.name ?? "—"}</td>
              <td><Badge tone="violet">{(a.commissionRate * 100).toFixed(0)}%</Badge></td>
              <td>{a.userCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
