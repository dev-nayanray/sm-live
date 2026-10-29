import * as SecureStore from "expo-secure-store";
import { API_BASE } from "./env";

const KEY_ACCESS = "smlive.access";
const KEY_REFRESH = "smlive.refresh";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export const tokenStore = {
  async get(): Promise<Tokens | null> {
    try {
      const accessToken = await SecureStore.getItemAsync(KEY_ACCESS);
      const refreshToken = await SecureStore.getItemAsync(KEY_REFRESH);
      if (!accessToken || !refreshToken) return null;
      return { accessToken, refreshToken };
    } catch {
      return null; // SecureStore unavailable (e.g. web preview) — fall back to memory
    }
  },
  async set(t: Tokens) {
    try {
      await SecureStore.setItemAsync(KEY_ACCESS, t.accessToken);
      await SecureStore.setItemAsync(KEY_REFRESH, t.refreshToken);
    } catch {
      memory.accessToken = t.accessToken;
      memory.refreshToken = t.refreshToken;
    }
  },
  async clear() {
    try {
      await SecureStore.deleteItemAsync(KEY_ACCESS);
      await SecureStore.deleteItemAsync(KEY_REFRESH);
    } catch {
      /* ignore */
    }
    memory.accessToken = null;
    memory.refreshToken = null;
  },
};

const memory: { accessToken: string | null; refreshToken: string | null } = { accessToken: null, refreshToken: null };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Try to refresh the access token with the stored refresh token. */
export async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const tokens = await tokenStore.get();
    const refreshToken = tokens?.refreshToken ?? memory.refreshToken;
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!json.accessToken || !json.refreshToken) return false;
      await tokenStore.set({ accessToken: json.accessToken, refreshToken: json.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

/** Fetch wrapper: attaches the token, transparently refreshes once on 401. */
export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const tokens = await tokenStore.get();
    const accessToken = tokens?.accessToken ?? memory.accessToken;
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    let body = init?.body;
    if (init?.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    return fetch(`${API_BASE}${path}`, { ...init, headers, body });
  };

  let res = await doFetch();
  if (res.status === 401 && (await tryRefresh())) {
    res = await doFetch();
  }
  const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { code: string; message: string } };
  if (!res.ok || payload.ok === false) {
    throw new ApiError(res.status, payload.error?.code ?? "error", payload.error?.message ?? res.statusText);
  }
  return (payload.data ?? payload) as T;
}
