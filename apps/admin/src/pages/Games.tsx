import { useState } from "react";
import { Button, Card } from "../components/ui";
import { ResourceTable } from "../components/Resource";

export function Games() {
  const [tab, setTab] = useState<"games" | "configs" | "providers">("games");
  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Games</h1>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["games", "Games"], ["configs", "Per-market bet limits & timing"], ["providers", "Providers"]] as const).map(([k, l]) => (
          <Button key={k} variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === "games" && (
        <Card title="Games — status, version, Pro flag, provider (edits go live in /v1/config/app)">
          <ResourceTable resource="games" readPerm="games.read" writePerm="games.write" />
        </Card>
      )}
      {tab === "configs" && (
        <Card title="Game configs — min/max bet, betting seconds, timeout, stuck policy per market">
          <ResourceTable resource="game-configs" readPerm="games.read" writePerm="games.write" />
        </Card>
      )}
      {tab === "providers" && (
        <Card title="Game providers — api base, keys, commission %">
          <ResourceTable resource="game-providers" readPerm="providers.read" writePerm="providers.write" />
        </Card>
      )}
    </div>
  );
}
