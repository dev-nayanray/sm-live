import { createContext, useContext, useState } from "react";
import { api, setToken } from "./api";

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
