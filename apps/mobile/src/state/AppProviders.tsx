import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, tokenStore } from "../api/client";
import { DEFAULT_CONFIG, fetchAppConfig, loadConfig, type AppConfigResponse } from "../api/config";

// --- auth -------------------------------------------------------------------
interface AuthState {
  ready: boolean;
  loggedIn: boolean;
  user: { id: number; displayName: string; avatarUrl?: string } | null;
  login: (identifier: string, password: string) => Promise<void>;
  register: (args: { phone?: string; email?: string; password: string; displayName: string }) => Promise<void>;
  otpLogin: (identifier: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
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

export function AppProviders({ children }: { children: React.ReactNode }) {
  // auth
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthState["user"]>(null);

  useEffect(() => {
    (async () => {
      const tokens = await tokenStore.get();
      if (tokens) {
        try {
          const me = await api<{ user: { id: number; displayName: string; avatarUrl?: string } }>("/v1/auth/me");
          setUser(me.user);
        } catch {
          await tokenStore.clear();
        }
      }
      setReady(true);
    })();
  }, []);

  const auth = useMemo<AuthState>(() => ({
    ready,
    loggedIn: !!user,
    user,
    login: async (identifier, password) => {
      const res = await fetch(`${API_BASE_REF()}/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "login failed");
      await tokenStore.set({ accessToken: json.accessToken, refreshToken: json.refreshToken });
      const me = await api<{ user: { id: number; displayName: string; avatarUrl?: string } }>("/v1/auth/me");
      setUser(me.user);
    },
    register: async (args) => {
      const res = await fetch(`${API_BASE_REF()}/v1/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...args, market: marketRef.code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "register failed");
      await tokenStore.set({ accessToken: json.accessToken, refreshToken: json.refreshToken });
      const me = await api<{ user: { id: number; displayName: string; avatarUrl?: string } }>("/v1/auth/me");
      setUser(me.user);
    },
    otpLogin: async (identifier, code) => {
      const res = await fetch(`${API_BASE_REF()}/v1/auth/otp/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "otp verify failed");
      await tokenStore.set({ accessToken: json.accessToken, refreshToken: json.refreshToken });
      const me = await api<{ user: { id: number; displayName: string; avatarUrl?: string } }>("/v1/auth/me");
      setUser(me.user);
    },
    logout: async () => {
      await tokenStore.clear();
      setUser(null);
    },
  }), [ready, user]);

  // config
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

// small indirection so auth closures always use current market
const marketRef = { code: "default" };
function API_BASE_REF(): string {
  // avoid circular import: read from env module lazily
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { API_BASE } = require("../api/env");
  return API_BASE;
}

export const useAuth = () => useContext(AuthCtx);
export const useAppConfig = () => useContext(ConfigCtx);
