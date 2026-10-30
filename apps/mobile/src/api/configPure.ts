import type { AppConfigResponse } from "@sm-live/shared";

export type { AppConfigResponse };

const STALE_MS = 5 * 60 * 1000;

export interface CachedConfig {
  fetchedAt: number;
  config: AppConfigResponse;
}

/** Merge policy: server wins for non-empty values; keeps defaults for gaps. */
export function mergeConfig(base: AppConfigResponse, incoming: AppConfigResponse): AppConfigResponse {
  return {
    brand: {
      appName: incoming.brand.appName || base.brand.appName,
      logoUrl: incoming.brand.logoUrl || base.brand.logoUrl,
      primaryColor: incoming.brand.primaryColor || base.brand.primaryColor,
      accentColor: incoming.brand.accentColor || base.brand.accentColor,
    },
    flags: { ...base.flags, ...incoming.flags },
    games: incoming.games.length > 0 ? incoming.games : base.games,
    gifts: incoming.gifts.length > 0 ? incoming.gifts : base.gifts,
    bottomTabs: incoming.bottomTabs.length > 0 ? incoming.bottomTabs : base.bottomTabs,
    market: incoming.market || base.market,
    realMoneyEnabled: incoming.realMoneyEnabled,
    generatedAt: incoming.generatedAt,
  };
}

export function isStale(cached: CachedConfig | null, now = Date.now()): boolean {
  return !cached || now - cached.fetchedAt > STALE_MS;
}

export const DEFAULT_CONFIG: AppConfigResponse = {
  brand: { appName: "SM Live", logoUrl: "", primaryColor: "#7c3aed", accentColor: "#f43f5e" },
  flags: {},
  games: [],
  gifts: [],
  // Prompt 13 default 5-tab nav — Home, Discover, Live, Messages, Profile.
  // Served before the API responds (and as a fallback when the API sends
  // an empty array). Server value is authoritative once it arrives.
  bottomTabs: [
    { key: "home", label: "Home", icon: "home", visible: true },
    { key: "discover", label: "Discover", icon: "compass", visible: true },
    { key: "live", label: "Live", icon: "radio", visible: true },
    { key: "messages", label: "Messages", icon: "message", visible: true },
    { key: "me", label: "Profile", icon: "user", visible: true },
  ],
  market: "default",
  realMoneyEnabled: false,
  generatedAt: "",
};
