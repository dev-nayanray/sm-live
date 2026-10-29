import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "./env";
import { DEFAULT_CONFIG, isStale, mergeConfig, type AppConfigResponse, type CachedConfig } from "./configPure";

export { DEFAULT_CONFIG, isStale, mergeConfig };
export type { AppConfigResponse };

const CACHE_KEY = "smlive:config:app";

/**
 * Config loader — the whole app (theme, tabs, games, gifts, flags) is driven
 * by GET /v1/config/app. Serves from cache instantly, refreshes in the
 * background when stale.
 */

export async function readCachedConfig(): Promise<AppConfigResponse> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CachedConfig;
      if (parsed?.config) return mergeConfig(DEFAULT_CONFIG, parsed.config);
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_CONFIG;
}

export async function fetchAppConfig(market?: string): Promise<AppConfigResponse> {
  const res = await fetch(`${API_BASE}/v1/config/app${market ? `?market=${encodeURIComponent(market)}` : ""}`);
  const json = (await res.json()) as { ok: boolean; data: AppConfigResponse };
  if (!res.ok || !json.ok) throw new Error("config fetch failed");
  const merged = mergeConfig(DEFAULT_CONFIG, json.data);
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), config: merged } satisfies CachedConfig)).catch(() => {});
  return merged;
}

/** Cached-first load; kicks off a background refresh when stale. */
export async function loadConfig(market?: string): Promise<{ config: AppConfigResponse; refreshed: Promise<AppConfigResponse> | null }> {
  let cached: CachedConfig | null = null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw) as CachedConfig;
  } catch {
    cached = null;
  }
  const stale = isStale(cached);
  const base = cached?.config ? mergeConfig(DEFAULT_CONFIG, cached.config) : DEFAULT_CONFIG;
  return {
    config: base,
    refreshed: stale ? fetchAppConfig(market).catch(() => base) : null,
  };
}
