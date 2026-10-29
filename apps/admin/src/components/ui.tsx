import { useEffect, useState } from "react";

export function Card({ title, children, actions }: { title?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4 mb-4">
      {(title || actions) && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", disabled, title }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger" | "subtle"; disabled?: boolean; title?: string;
}) {
  const styles = {
    primary: "bg-violet-600 hover:bg-violet-700 text-white",
    ghost: "bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600",
    danger: "bg-rose-600 hover:bg-rose-700 text-white",
    subtle: "bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200",
  }[variant];
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed ${styles}`}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" | "violet" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    red: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  }[tone];
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tones}`}>{children}</span>;
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-[560px] max-w-[95vw] max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Confirm({ open, text, onCancel, onConfirm }: { open: boolean; text: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal open={open} title="Confirm" onClose={onCancel}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">{text}</p>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Confirm</Button>
      </div>
    </Modal>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm ${props.className ?? ""}`} />;
}

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone ?? "text-slate-800 dark:text-slate-100"}`}>{value}</div>
    </div>
  );
}

export function Loading() {
  return <div className="py-10 text-center text-slate-400 animate-pulse">loading…</div>;
}

export function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-slate-400">{text}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const [msg, setMsg] = useState(String((error as Error)?.message ?? error));
  useEffect(() => setMsg(String((error as Error)?.message ?? error)), [error]);
  return <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-sm my-2">{msg}</div>;
}

export function useTheme() {
  const [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}
