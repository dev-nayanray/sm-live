/**
 * SM Live — useOnline hook (Prompt 13).
 *
 * Tracks the device's network reachability so the app can show a
 * "You're offline" banner and skip non-essential fetches. Wraps NetInfo
 * — kept as a separate hook so a screen that doesn't care about
 * connectivity (e.g. the splash) doesn't pay for the subscription.
 *
 * NetInfo is not in the dependency list yet; we deliberately avoid
 * pulling a new native module just to detect connectivity. Instead we
 * use a lightweight polling approach against a tiny endpoint we know
 * is unauthenticated (GET /health) — every 30s when the app is in the
 * foreground. This is intentionally NOT a real-time listener; it's a
 * "best-effort connectivity hint" so the UI can warn before an action.
 *
 * When NetInfo is wired in a later prompt, swap the implementation
 * here without changing the hook signature.
 */
import { useEffect, useState } from "react";
import { API_BASE } from "../api/env";

export interface OnlineState {
  online: boolean;
  lastCheckedAt: number | null;
}

const POLL_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

export function useOnline(enabled = true): OnlineState {
  const [state, setState] = useState<OnlineState>({ online: true, lastCheckedAt: null });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const probe = async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
        const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!alive) return;
        const ok = res.ok;
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
        setState({ online: ok && json.ok === true, lastCheckedAt: Date.now() });
      } catch {
        if (alive) setState({ online: false, lastCheckedAt: Date.now() });
      }
    };

    void probe();
    const timer = setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);

  return state;
}
