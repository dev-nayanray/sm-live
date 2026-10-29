import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Card, Empty, Loading } from "../components/ui";
import { ResourceTable } from "../components/Resource";

interface Room { id: number; title: string; type: string; slots: number; country: string; status: string; createdAt: string; host: { displayName: string }; participants: unknown[] }

export function LiveVoice() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"rooms" | "gifts" | "rankings" | "videos" | "moments">("rooms");

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Live &amp; Voice</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["rooms", "Rooms"], ["gifts", "Gift catalog"], ["rankings", "Rankings"], ["videos", "Short videos"], ["moments", "Moments"]] as const).map(([k, label]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{label}</Button>
        ))}
      </div>

      {tab === "rooms" && <RoomsTab canWrite={can("rooms.write")} />}
      {tab === "gifts" && <Card title="Gift catalog (config-driven — edits go live in /v1/config/app)"><ResourceTable resource="gifts" readPerm="rooms.read" writePerm="rooms.write" /></Card>}
      {tab === "rankings" && <RankingsTab />}
      {tab === "videos" && <VideosTab kind="video" />}
      {tab === "moments" && <VideosTab kind="moment" />}
    </div>
  );
}

function RoomsTab({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-rooms"],
    queryFn: () => api<{ items: Room[] }>("/v1/admin/rooms?page=1&pageSize=20"),
    refetchInterval: 15_000,
  });
  if (isLoading) return <Loading />;
  const rooms = data?.items ?? [];
  if (rooms.length === 0) return <Empty text="no rooms" />;

  return (
    <Card title="Rooms">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-400 border-b border-slate-200 dark:border-slate-700">
          <th className="py-2">ID</th><th>Title</th><th>Type</th><th>Slots</th><th>Country</th><th>Host</th><th>Live</th><th />
        </tr></thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="py-2">{r.id}</td>
              <td>{r.title}</td>
              <td><Badge tone={r.type === "live" ? "red" : r.type === "voice" ? "violet" : "amber"}>{r.type}</Badge></td>
              <td>{r.participants.length}/{r.slots}</td>
              <td>{r.country}</td>
              <td>{r.host?.displayName}</td>
              <td>{r.status === "OPEN" ? "🟢" : r.status}</td>
              <td className="text-right">{canWrite && !r.createdAt?.startsWith("1970") && <Button variant="ghost" onClick={() => void api(`/v1/admin/rooms/${r.id}/close`, { method: "POST" }).then(() => refetch())}>Close</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function RankingsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["ranking"],
    queryFn: () => api<{ items: { rank: number; user: { displayName: string; vipLevel: number }; points: number }[] }>("/v1/gifts/ranking?period=weekly"),
  });
  if (isLoading) return <Loading />;
  const rows = data?.items ?? [];
  return (
    <Card title="Gift ranking (weekly)">
      {rows.length === 0 ? <Empty text="no ranking data yet — send gifts to populate" /> : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.rank} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 w-16 font-bold">#{r.rank}</td>
                <td>{r.user.displayName} {r.user.vipLevel > 0 && <Badge tone="violet">VIP{r.user.vipLevel}</Badge>}</td>
                <td className="text-right font-semibold">{r.points.toLocaleString()} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function VideosTab({ kind }: { kind: "video" | "moment" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["content", kind],
    queryFn: () => api<{ items: Record<string, unknown>[] }>(`/v1/admin/resources/settings?page=1&pageSize=1`).then(() => ({ items: [] as Record<string, unknown>[] })),
  });
  if (isLoading) return <Loading />;
  void data;
  return (
    <Card title={kind === "video" ? "Short videos" : "Moments"}>
      <Empty text={`${kind === "video" ? "Short video" : "Moment"} moderation feeds from the mobile app — content is seeded and served by /v1/config endpoints. Use Settings → feature flags to toggle the tab.`} />
    </Card>
  );
}
