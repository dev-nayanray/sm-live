import { useState } from "react";
import { useAuth } from "../auth";
import { Button, Input } from "../components/ui";

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("superadmin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-slate-100 dark:bg-slate-900">
      <form onSubmit={submit} className="bg-white dark:bg-slate-800 shadow-xl rounded-2xl p-8 w-96">
        <h1 className="text-2xl font-bold mb-1 text-slate-800 dark:text-slate-100">SM Live <span className="text-violet-500">Admin</span></h1>
        <p className="text-sm text-slate-400 mb-6">Control panel sign-in</p>
        <label className="block text-sm mb-3">
          <span className="text-slate-500 dark:text-slate-400">Username</span>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="block text-sm mb-4">
          <span className="text-slate-500 dark:text-slate-400">Password</span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="text-rose-500 text-sm mb-3">{error}</div>}
        <Button disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</Button>
        <p className="text-xs text-slate-400 mt-4">seeded: superadmin / SuperAdmin123! · viewer / Viewer123! (read-only)</p>
      </form>
    </div>
  );
}
