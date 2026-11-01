/**
 * SM Live — Gifts & Virtual Items catalogue editor.
 *
 * CRUD over the Gift model via the generic resources API (rooms.read/write
 * perms — gifts are live-room inventory) plus gifting volume stats from the
 * financial analytics endpoint.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Loading } from "../components/ui";
import { ResourceTable } from "../components/Resource";

export function GiftsItems() {
  const statsQ = useQuery({
    queryKey: ["gifts-stats"],
    queryFn: () => api<{ giftDebitVolume: number; giftCreditVolume: number; currency: string }>(
      "/v1/admin/analytics/financial"
    ),
  });

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">Gifts &amp; Virtual Items</h1>
      <p className="text-sm text-slate-400 mb-4">Gift catalogue (price, icon, category, availability) and recent gifting volume.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        {[
          { label: "Gift coins sent", value: statsQ.data?.giftDebitVolume },
          { label: "Gift coins received", value: statsQ.data?.giftCreditVolume },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{c.label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">
              {c.value === undefined ? (statsQ.isLoading ? "…" : "—") : Number(c.value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <Card title="Catalogue">
        <ResourceTable resource="gifts" readPerm="rooms.read" writePerm="rooms.write" />
      </Card>
    </div>
  );
}
