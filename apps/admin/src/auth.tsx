import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, getToken } from "./api";

export interface AdminInfo {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
}

interface AuthState {
  admin: AdminInfo | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (perm: string) => boolean;
}

const Ctx = createContext<AuthState>(null as never);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminInfo | null>(null);

  // Rehydrate the admin session on mount: if a token is already present in
  // localStorage (e.g. after a full page reload), call /v1/admin/auth/me to
  // restore the admin identity + permissions. Without this, a hard refresh
  // of any admin URL would bounce back to the login screen.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api<{ id: number; username: string; displayName: string; role: string; permissions: string[] }>("/v1/admin/auth/me")
      .then((data) => setAdmin(data))
      .catch(() => {
        // Token invalid or expired — clear it so the login screen renders.
        setToken(null);
      });
  }, []);

  const login = async (username: string, password: string) => {
    const data = await api<{ accessToken: string; admin: AdminInfo; permissions: string[] }>("/v1/admin/auth/login", {
      method: "POST",
      json: { username, password },
    });
    setToken(data.accessToken);
    setAdmin({ ...data.admin, permissions: data.permissions });
  };

  const logout = () => {
    setToken(null);
    setAdmin(null);
  };

  const can = (perm: string) => admin?.permissions.includes(perm) ?? false;

  return <Ctx.Provider value={{ admin, login, logout, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
