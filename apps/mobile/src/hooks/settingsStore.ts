/**
 * SM Live — settings store (Prompt 13).
 *
 * Pure helpers that read / write a small JSON blob to AsyncStorage. The
 * shape is intentionally tiny: the only settings the platform can
 * actually enforce today are theme preference, language, and a few
 * notification toggles (which act as "I would like to receive"
 * preferences — the backend doesn't yet have a push provider to honour
 * them, but persisting them now means the toggle is in place when a
 * provider lands).
 *
 * All other rows on the Settings screen route to screens that document
 * what would be implemented (Terms, Privacy policy) rather than fake
 * working features.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "smlive:settings:v1";

export interface AppSettings {
  /** Theme — only "dark" is honoured today; "light" + "system" are persisted for forward compat. */
  theme: "dark" | "light" | "system";
  /** UI language — only "en" is shipped today; persisted so the locale picker reflects the choice. */
  language: "en" | "bn" | "hi" | "ur";
  /** Notification preferences — honoured once a push provider is configured. */
  notifications: {
    liveFromFollowing: boolean;
    newMessages: boolean;
    giftsReceived: boolean;
    marketing: boolean;
  };
  /** Privacy preferences — surface in the user-facing privacy disclosure. */
  privacy: {
    showOnlineStatus: boolean;
    allowDirectMessages: boolean;
  };
  /** Last updated timestamp — used by the cache invalidation logic. */
  updatedAt: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  language: "en",
  notifications: {
    liveFromFollowing: true,
    newMessages: true,
    giftsReceived: true,
    marketing: false,
  },
  privacy: {
    showOnlineStatus: true,
    allowDirectMessages: true,
  },
  updatedAt: 0,
};

/** Load settings from AsyncStorage, falling back to defaults on any error. */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return mergeSettings(DEFAULT_SETTINGS, parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Persist settings. Returns the merged settings object for convenience. */
export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const merged = { ...next, updatedAt: Date.now() };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // Persistence failure is non-fatal — settings revert to defaults on next load.
  }
  return merged;
}

/** Reset to defaults. */
export async function clearSettings(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Merge a partial settings payload onto the defaults. Defensive against
 * missing nested objects so a malformed cached blob never crashes the
 * settings screen.
 *
 * The incoming shape is intentionally loose (nested objects can be
 * partial) so callers can write `mergeSettings(base, { notifications:
 * { newMessages: false } })` without redeclaring every toggle.
 */
export function mergeSettings(
  base: AppSettings,
  incoming: Partial<Omit<AppSettings, "notifications" | "privacy">>
    & { notifications?: Partial<AppSettings["notifications"]> }
    & { privacy?: Partial<AppSettings["privacy"]> },
): AppSettings {
  return {
    theme: incoming.theme ?? base.theme,
    language: incoming.language ?? base.language,
    notifications: { ...base.notifications, ...(incoming.notifications ?? {}) },
    privacy: { ...base.privacy, ...(incoming.privacy ?? {}) },
    updatedAt: incoming.updatedAt ?? base.updatedAt,
  };
}
