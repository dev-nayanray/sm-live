import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import { useTheme } from "./ui";

const NAV: { to: string; label: string; perm: string; icon: string }[] = [
  { to: "/dashboard", label: "Dashboard", perm: "dashboard.view", icon: "📊" },
  { to: "/live", label: "Live & Voice", perm: "rooms.read", icon: "🎤" },
  { to: "/users", label: "Users & Agencies", perm: "users.read", icon: "👥" },
  { to: "/games", label: "Games", perm: "games.read", icon: "🎮" },
  { to: "/rounds", label: "Rounds & Bets", perm: "rounds.read", icon: "🎯" },
  { to: "/wallet", label: "Wallet", perm: "wallet.read", icon: "🪙" },
  { to: "/players", label: "Players", perm: "players.read", icon: "🛡️" },
  { to: "/reports", label: "Reports", perm: "reports.read", icon: "📈" },
  { to: "/providers", label: "Providers & Settlement", perm: "providers.read", icon: "🏢" },
  { to: "/security", label: "API & Security", perm: "security.read", icon: "🔐" },
  { to: "/settings", label: "Settings", perm: "settings.read", icon: "⚙️" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { admin, logout, can } = useAuth();
  const { dark, toggle } = useTheme();
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-200 flex flex-col">
        <div className="px-4 py-4 font-bold text-lg tracking-wide text-white">
          SM Live <span className="text-violet-400">Admin</span>
        </div>
        <nav className="flex-1 overflow-y-auto">
          {NAV.filter((n) => can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2.5 text-sm ${isActive ? "bg-violet-600 text-white" : "hover:bg-slate-800"}`}>
              <span>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800 text-xs">
          <div className="font-semibold">{admin?.displayName}</div>
          <div className="text-slate-400 mb-2">{admin?.role}</div>
          <div className="flex gap-2">
            <button onClick={toggle} className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">{dark ? "☀️ light" : "🌙 dark"}</button>
            <button onClick={logout} className="px-2 py-1 rounded bg-rose-700 hover:bg-rose-600">logout</button>
          </div>
        </div>
      </aside>
      <main className="flex-1 p-6 max-w-[1400px] mx-auto w-full">{children}</main>
    </div>
  );
}
