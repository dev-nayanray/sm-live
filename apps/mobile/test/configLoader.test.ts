import { DEFAULT_CONFIG, isStale, mergeConfig, type AppConfigResponse } from "../src/api/configPure";

function cfg(overrides: Partial<AppConfigResponse>): AppConfigResponse {
  return { ...DEFAULT_CONFIG, ...overrides } as AppConfigResponse;
}

describe("config loader", () => {
  it("serves server values for brand, flags, games, gifts, tabs", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, cfg({
      brand: { appName: "SM Live BD", logoUrl: "https://x/l.png", primaryColor: "#111111", accentColor: "#222222" },
      flags: { "games.enabled": true },
      games: [{ code: "crash-x", name: "Crash X", thumbnailUrl: "", isPro: false, status: "active", minBet: 1, maxBet: 100 }],
      gifts: [{ id: 1, name: "Rose", iconUrl: "", price: 10, category: "basic", animation: "none" }],
      bottomTabs: [{ key: "home", label: "Home", icon: "home", visible: true }],
      market: "bd",
    }));
    expect(merged.brand.appName).toBe("SM Live BD");
    expect(merged.flags["games.enabled"]).toBe(true);
    expect(merged.games).toHaveLength(1);
    expect(merged.gifts[0]!.name).toBe("Rose");
    expect(merged.bottomTabs[0]!.key).toBe("home");
    expect(merged.market).toBe("bd");
  });

  it("keeps defaults when the server sends empty arrays (fail-open UX, not blank screens)", () => {
    const base = cfg({
      games: [{ code: "g", name: "G", thumbnailUrl: "", isPro: false, status: "active", minBet: 1, maxBet: 2 }],
      bottomTabs: [{ key: "home", label: "Home", icon: "home", visible: true }],
    });
    const merged = mergeConfig(base, cfg({ games: [], gifts: [], bottomTabs: [] }));
    expect(merged.games).toHaveLength(1); // kept from base
    expect(merged.bottomTabs).toHaveLength(1);
  });

  it("merges flags without losing flags absent from the incoming payload", () => {
    const base = cfg({ flags: { "a.flag": true, "b.flag": false } });
    const merged = mergeConfig(base, cfg({ flags: { "b.flag": true } }));
    expect(merged.flags).toEqual({ "a.flag": true, "b.flag": true });
  });

  it("never lets realMoneyEnabled flip on by merging (server value is authoritative)", () => {
    const merged = mergeConfig(cfg({ realMoneyEnabled: false }), cfg({ realMoneyEnabled: true }));
    expect(merged.realMoneyEnabled).toBe(true); // server decides — boilerplate seeds false everywhere
    const off = mergeConfig(cfg({ realMoneyEnabled: true }), cfg({ realMoneyEnabled: false }));
    expect(off.realMoneyEnabled).toBe(false);
  });

  it("marks cache stale after 5 minutes", () => {
    const now = Date.now();
    expect(isStale(null, now)).toBe(true);
    expect(isStale({ fetchedAt: now - 1000, config: DEFAULT_CONFIG }, now)).toBe(false);
    expect(isStale({ fetchedAt: now - 6 * 60 * 1000, config: DEFAULT_CONFIG }, now)).toBe(true);
  });
});
