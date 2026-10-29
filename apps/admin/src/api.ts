export const API_BASE: string = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";

let adminToken: string | null = localStorage.getItem("admin_token");

export function setToken(t: string | null) {
  adminToken = t;
  if (t) localStorage.setItem("admin_token", t);
  else localStorage.removeItem("admin_token");
}

export function getToken() {
  return adminToken;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (adminToken) headers.authorization = `Bearer ${adminToken}`;
  let body = init?.body;
  if (init?.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { code: string; message: string } };
  if (!res.ok || payload.ok === false) {
    throw new ApiError(res.status, payload.error?.code ?? "error", payload.error?.message ?? res.statusText);
  }
  return (payload.data ?? payload) as T;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => escape(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
