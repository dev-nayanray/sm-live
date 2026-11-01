/**
 * SM Live — Payout Configuration.
 *
 * Per-game / per-market payout rules live in GameConfig rows (max win,
 * RTP band, bet limits) — edited here through the generic resources table.
 * The current realised RTP (wallet/rtp) is shown alongside so the
 * configured band can be sanity-checked against reality.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Loading } from "../components/ui";
import { ResourceTable } from "../components/Resource";

export function PayoutConfig() {
  const rtpQ = useQuery({
    queryKey: ["payout-rtp"],
    queryFn: () => api<{ current: number | null; snapshotCount: number } | { items: unknown[] }>("/v1/admin/wallet/rtp"),
  });

  const rtpCurrent =
    rtpQ.data && "current" in rtpQ.data ? rtpQ.data.current : undefined;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Payout Configuration</h1>
      <p className="text-sm text-slate-400 mb-4">Per-game / per-market payout rules (GameConfig rows: RTP band, bet &amp; win limits).</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Realised RTP (current)</div>
          <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
            {rtpQ.isLoading ? "…" : rtpCurrent == null ? "—" : `${(rtpCurrent * 100).toFixed(2)}%`}
          </div>
        </div>
      </div>

      <Card title="Payout rules (game configs)">
        {rtpQ.isLoading && !rtpQ.data ? <Loading /> : (
          <ResourceTable resource="game-configs" readPerm="games.read" writePerm="games.write" />
        )}
      </Card>
    </div>
  );
}
