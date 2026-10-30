/**
 * SM Live — useSettings hook (Prompt 13).
 *
 * Wraps the settingsStore helpers in a React hook so any screen can read
 * and update the persisted settings. The hook loads once on mount and
 * caches in state; subsequent updates write through to AsyncStorage and
 * update the state synchronously so the UI reflects the change without
 * waiting for the next read.
 */
import { useCallback, useEffect, useState } from "react";
import { loadSettings, saveSettings, clearSettings, DEFAULT_SETTINGS, type AppSettings } from "./settingsStore";

export function useSettings(): {
  settings: AppSettings;
  ready: boolean;
  update: (next: Partial<AppSettings>) => Promise<void>;
  reset: () => Promise<void>;
} {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await loadSettings();
      if (alive) {
        setSettings(s);
        setReady(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const update = useCallback(async (next: Partial<AppSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next, notifications: { ...prev.notifications, ...(next.notifications ?? {}) }, privacy: { ...prev.privacy, ...(next.privacy ?? {}) } };
      void saveSettings(merged);
      return merged;
    });
  }, []);

  const reset = useCallback(async () => {
    await clearSettings();
    setSettings(DEFAULT_SETTINGS);
  }, []);

  return { settings, ready, update, reset };
}
