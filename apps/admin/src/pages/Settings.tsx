import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Badge, Button, Card, Loading } from "../components/ui";
import { ResourceTable } from "../components/Resource";

interface AppCfg { brand: { appName: string; primaryColor: string; accentColor: string }; flags: Record<string, boolean>; games: unknown[]; gifts: unknown[]; bottomTabs: { key: string; label: string; visible: boolean }[]; market: string; realMoneyEnabled: boolean }

export function Settings() {
  const [tab, setTab] = useState<"preview" | "brand" | "flags" | "markets" | "country" | "settings">("preview");
  const cfg = useQuery({ queryKey: ["app-config"], queryFn: () => api<AppCfg>("/v1/config/app"), refetchInterval: 5_000 });

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Settings</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["preview", "Live app config"], ["brand", "Brand"], ["flags", "Feature flags"], ["markets", "Markets (real money)"], ["country", "Country filters"], ["settings", "Settings editor"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>

      {tab === "preview" && (
        <Card title="GET /v1/config/app (live — this is what the mobile app receives; refreshes every 5s)">
          {cfg.isLoading ? <Loading /> : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg" style={{ background: cfg.data!.brand.primaryColor }} />
                <div className="font-bold text-lg">{cfg.data!.brand.appName}</div>
                <Badge tone={cfg.data!.realMoneyEnabled ? "red" : "green"}>real money: {String(cfg.data!.realMoneyEnabled)}</Badge>
                <Badge>market: {cfg.data!.market}</Badge>
              </div>
              <div className="flex gap-2 flex-wrap">
                {cfg.data!.bottomTabs.map((t) => <Badge key={t.key} tone={t.visible ? "violet" : "slate"}>{t.label}{t.visible ? "" : " (hidden)"}</Badge>)}
              </div>
              <div>{cfg.data!.games.length} games · {cfg.data!.gifts.length} gifts · flags: {Object.keys(cfg.data!.flags).length}</div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(cfg.data!.flags).map(([k, v]) => (
                  <Badge key={k} tone={v ? "green" : "slate"}>{k}: {String(v)}</Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
      {tab === "brand" && <Card title="Brand config — name, logo, colours, bottom tabs"><ResourceTable resource="brand-configs" readPerm="settings.read" writePerm="settings.write" /></Card>}
      {tab === "flags" && <Card title="Feature flags"><ResourceTable resource="feature-flags" readPerm="settings.read" writePerm="settings.write" /></Card>}
      {tab === "markets" && (
        <Card title="Markets — real_money_enabled gates any real-money behaviour (default false everywhere)">
          <ResourceTable resource="markets" readPerm="settings.read" writePerm="settings.write" />
        </Card>
      )}
      {tab === "country" && <Card title="Country filters"><ResourceTable resource="country-filters" readPerm="settings.read" writePerm="settings.write" /></Card>}
      {tab === "settings" && <Card title="Settings editor"><ResourceTable resource="settings" readPerm="settings.read" writePerm="settings.write" /></Card>}
    </div>
  );
}
