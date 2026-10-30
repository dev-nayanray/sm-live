import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, tokenStore, onRefreshFailed, ApiError } from "../api/client";
import { API_BASE } from "../api/env";
import { DEFAULT_CONFIG, fetchAppConfig, loadConfig, type AppConfigResponse } from "../api/config";

// --- auth -------------------------------------------------------------------
export type AuthStatus =
  | "loading"          // initial — restoring session
  | "unauthenticated"  // no valid tokens
  | "authenticating"   // login / register / OTP verify in flight
  | "authenticated"     // valid session + user loaded
  | "expired"          // refresh failed; tokens cleared
  | "error";           // auth action failed (e.g. wrong password)

export interface AuthUser {
  id: number;
  displayName: string;
  avatarUrl?: string;
  phone?: string | null;
  email?: string | null;
  marketCode?: string;
  country?: string;
  vipLevel?: number;
  nobleLevel?: number;
}

interface AuthState {
  ready: boolean;
  status: AuthStatus;
  loggedIn: boolean;
  user: AuthUser | null;
  /** Last error message from a failed auth action — surfaces inline on the form. */
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  register: (args: { phone?: string; email?: string; password: string; displayName: string; referrerCode?: string }) => Promise<void>;
  otpLogin: (identifier: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Clear the transient error state — used when the user starts typing again. */
  clearError: () => void;
  /** Force a re-fetch of /v1/auth/me — used after profile edits (future). */
  refreshUser: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>(null as never);

// --- config ------------------------------------------------------------------
interface ConfigState {
  config: AppConfigResponse;
  market: string;
  setMarket: (m: string) => void;
  flag: (key: string) => boolean;
}

const ConfigCtx = createContext<ConfigState>(null as never);

// small indirection so auth closures always register with the current market
const marketRef = { code: "default" };

export function AppProviders({ children }: { children: React.ReactNode }) {
  // --- auth state ---
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * In-flight auth action guard. The auth methods (login / register /
   * otpLogin / logout) check this flag and short-circuit if a request is
   * already running — prevents duplicate submissions when the user
   * double-taps the submit button.
   */
  const inflight = useRef(false);

  // Restore session on boot.
  useEffect(() => {
    let alive = true;
    (async () => {
      const tokens = await tokenStore.get();
      if (!tokens) {
        if (alive) setStatus("unauthenticated");
        return;
      }
      try {
        const me = await api<{ user: AuthUser; balance: number }>("/v1/auth/me");
        if (alive) {
          setUser(me.user);
          setStatus("authenticated");
        }
      } catch {
        // /me failed — the api client already attempted a refresh. If that
        // also failed, tokens are cleared and we drop to unauthenticated.
        await tokenStore.clear();
        if (alive) setStatus("unauthenticated");
      }
    })();
    return () => { alive = false; };
  }, []);

  // Subscribe to refresh-failed events from the API client — when a
  // background refresh fails (e.g. refresh token revoked server-side),
  // clear the local user and force re-login.
  useEffect(() => {
    const unsubscribe = onRefreshFailed(() => {
      setUser(null);
      setStatus("expired");
      setError("Your session has expired. Please sign in again.");
    });
    return unsubscribe;
  }, []);

  const fetchMe = async (): Promise<AuthUser> => {
    const me = await api<{ user: AuthUser; balance: number }>("/v1/auth/me");
    return me.user;
  };

  const auth = useMemo<AuthState>(() => ({
    ready: status !== "loading",
    status,
    loggedIn: !!user,
    user,
    error,
    clearError: () => setError(null),
    refreshUser: async () => {
      try {
        const u = await fetchMe();
        setUser(u);
      } catch {
        /* swallow — caller can retry */
      }
    },
    login: async (identifier, password) => {
      if (inflight.current) return;
      inflight.current = true;
      setStatus("authenticating");
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/v1/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifier, password }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "login failed");
        await tokenStore.set({ accessToken: json.accessToken, refreshToken: json.refreshToken });
        const u = await fetchMe();
        setUser(u);
        setStatus("authenticated");
      } catch (e) {
        setError((e as Error).message);
        setStatus("unauthenticated");
        throw e;
      } finally {
        inflight.current = false;
      }
    },
    register: async (args) => {
      if (inflight.current) return;
      inflight.current = true;
      setStatus("authenticating");
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/v1/auth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...args, market: marketRef.code }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "register failed");
        await tokenStore.set({ accessToken: json.accessToken, refreshToken: json.refreshToken });
        const u = await fetchMe();
        setUser(u);
        setStatus("authenticated");
      } catch (e) {
        setError((e as Error).message);
        setStatus("unauthenticated");
        throw e;
      } finally {
        inflight.current = false;
      }
    },
    otpLogin: async (identifier, code) => {
      if (inflight.current) return;
      inflight.current = true;
      setStatus("authenticating");
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifier, code }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "otp verify failed");
        await tokenStore.set({ accessToken: json.accessToken, refreshToken: json.refreshToken });
        const u = await fetchMe();
        setUser(u);
        setStatus("authenticated");
      } catch (e) {
        setError((e as Error).message);
        setStatus("unauthenticated");
        throw e;
      } finally {
        inflight.current = false;
      }
    },
    logout: async () => {
      if (inflight.current) return;
      inflight.current = true;
      // Don't set status to "authenticating" — logout is destructive and
      // we want the user to see the unauthenticated state immediately
      // even if the network call hangs.
      try {
        const tokens = await tokenStore.get();
        if (tokens?.refreshToken) {
          // Best-effort server-side revoke. Network failure must NOT
          // block the local logout — we clear tokens regardless.
          await fetch(`${API_BASE}/v1/auth/logout`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ refreshToken: tokens.refreshToken }),
          }).catch(() => {});
        }
      } finally {
        await tokenStore.clear();
        setUser(null);
        setError(null);
        setStatus("unauthenticated");
        inflight.current = false;
      }
    },
  }), [status, user, error]);

  // --- config state ---
  const [config, setConfig] = useState<AppConfigResponse>(DEFAULT_CONFIG);
  const [market, setMarketState] = useState("default");

  useEffect(() => {
    marketRef.code = market;
    let alive = true;
    (async () => {
      const { config: cached, refreshed } = await loadConfig(market);
      if (!alive) return;
      setConfig(cached);
      if (refreshed) {
        const fresh = await refreshed;
        if (alive) setConfig(fresh);
      }
    })();
    // background refresh every 5 minutes
    const t = setInterval(() => {
      fetchAppConfig(market).then((c) => alive && setConfig(c)).catch(() => {});
    }, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [market]);

  const cfg = useMemo<ConfigState>(() => ({
    config,
    market,
    setMarket: (m: string) => setMarketState(m),
    flag: (key: string) => config.flags[key] ?? false,
  }), [config, market]);

  return (
    <AuthCtx.Provider value={auth}>
      <ConfigCtx.Provider value={cfg}>{children}</ConfigCtx.Provider>
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
export const useAppConfig = () => useContext(ConfigCtx);

// Re-export ApiError so screens can branch on `error.code` (e.g. "forbidden"
// for banned accounts vs "unauthorized" for wrong credentials).
export { ApiError };
