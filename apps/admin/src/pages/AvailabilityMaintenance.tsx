/**
 * SM Live — Game Availability & Maintenance console.
 *
 * Left: every game with its current status + one-click status change
 * (active / maintenance / disabled) via /v1/admin/games/:id/status —
 * instantly reflected in the mobile app config.
 * Right: scheduled platform maintenance windows (ops endpoints).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Loading, Select } from "../components/ui";

interface GameRow { id: number; code: string; name: string; status: string; isPro: boolean; sortOrder: number }
interface MaintenanceRow {
  id: number; scope: string; module: string | null; reason: string;
  startAt: string; endAt: string; status: string; createdAt: string;
}

const STATUS_TONE: Record<string, "green" | "amber" | "slate"> = {
  active: "green", maintenance: "amber", disabled: "slate",
};

export function AvailabilityMaintenance() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"games" | "windows">("games");

  const gamesQ = useQuery({
    queryKey: ["availability-games"],
    queryFn: () => api<{ items: GameRow[] }>("/v1/admin/games?page=1&pageSize=100"),
  });
  const maintQ = useQuery({
    queryKey: ["availability-maintenance"],
    queryFn: () => api<{ items: MaintenanceRow[] }>("/v1/admin/operations/maintenance?page=1&pageSize=50"),
  });

  const setStatus = async (id: number, status: string) => {
    await api(`/v1/admin/games/${id}/status`, { method: "POST", json: { status } });
    void qc.invalidateQueries({ queryKey: ["availability-games"] });
  };

  const games = gamesQ.data?.items ?? [];
  const byStatus = {
    active: games.filter((g) => g.status === "active").length,
    maintenance: games.filter((g) => g.status === "maintenance").length,
    disabled: games.filter((g) => g.status === "disabled").length,
  };

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Availability &amp; Maintenance</h1>
      <p className="text-sm text-slate-400 mb-4">Per-game availability + platform maintenance windows. Status changes propagate to the app config instantly.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        {[
          { label: "Active games", value: byStatus.active },
          { label: "In maintenance", value: byStatus.maintenance },
          { label: "Disabled", value: byStatus.disabled },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{gamesQ.isLoading ? "…" : c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        {([["games", "Game availability"], ["windows", "Maintenance windows"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>

      {tab === "games" && (
        <Card title="Games">
          {gamesQ.isLoading ? <Loading /> : games.length === 0 ? <Empty text="no games" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                  <th className="py-2 pr-3">Game</th><th className="px-3">Tier</th><th className="px-3">Status</th>
                  {can("games.write") && <th className="pl-3 text-right">Change status</th>}
                </tr></thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{g.name}</div>
                        <div className="text-xs text-slate-400">{g.code}</div>
                      </td>
                      <td className="px-3">{g.isPro ? <Badge tone="violet">Pro</Badge> : <Badge>Standard</Badge>}</td>
                      <td className="px-3"><Badge tone={STATUS_TONE[g.status] ?? "slate"}>{g.status}</Badge></td>
                      {can("games.write") && (
                        <td className="pl-3 text-right">
                          <Select value={g.status} onChange={(e) => void setStatus(g.id, e.target.value)} className="!w-36">
                            {["active", "maintenance", "disabled"].map((s) => <option key={s} value={s}>{s}</option>)}
                          </Select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "windows" && (
        <Card title="Scheduled maintenance windows">
          {maintQ.isLoading ? <Loading /> : (maintQ.data?.items.length ?? 0) === 0 ? <Empty text="no maintenance scheduled" /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                <th className="py-2">Scope</th><th>Module</th><th>Reason</th><th>Start</th><th>End</th><th>Status</th>
              </tr></thead>
              <tbody>
                {maintQ.data!.items.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2"><Badge tone={m.scope === "platform" ? "violet" : "slate"}>{m.scope}</Badge></td>
                    <td>{m.module ?? "—"}</td>
                    <td className="max-w-xs truncate text-slate-500 dark:text-slate-400">{m.reason}</td>
                    <td className="text-xs text-slate-400">{m.startAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="text-xs text-slate-400">{m.endAt.slice(0, 16).replace("T", " ")}</td>
                    <td><Badge tone={m.status === "active" ? "amber" : m.status === "completed" ? "green" : "slate"}>{m.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
