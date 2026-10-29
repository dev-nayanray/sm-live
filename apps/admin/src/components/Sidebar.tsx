/**
 * Sidebar for the Super Admin shell.
 *
 * Features:
 *   - Collapsible desktop rail (260px ↔ 72px) with persisted preference.
 *   - Brand identity (SM Live · Admin) at the top.
 *   - Grouped navigation rendered via <NavGroup />.
 *   - Sticky footer with the collapse toggle button.
 *
 * Persistence: the collapsed preference is stored under the same
 * `localStorage` mechanism the rest of the admin already uses (e.g. `theme`).
 * We use the key `admin.sidebar.collapsed` (string "1"/"0").
 */
import { useEffect, useState } from "react";
import { NAV_GROUPS } from "../navigation";
import { Icon } from "./Icon";
import { NavGroup } from "./Nav";

const STORAGE_KEY = "admin.sidebar.collapsed";

function readInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable — non-fatal */
    }
    // Inform layout consumers via a CSS data attribute. Tailwind picks up the
    // width via arbitrary variants on the wrapper.
    document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
  }, [collapsed]);
  return [collapsed, () => setCollapsed((c) => !c)];
}

interface SidebarProps {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: SidebarProps) {
  return (
    <aside
      aria-label="Primary navigation"
      className={`flex h-full flex-col bg-slate-900 text-slate-300 transition-[width] duration-200 ${
        collapsed ? "w-[72px]" : "w-[260px]"
      }`}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
          <Icon name="broadcast" className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide text-white">
              SM&nbsp;Live
            </div>
            <div className="text-[11px] uppercase tracking-wider text-violet-300/80">
              Super Admin
            </div>
          </div>
        )}
      </div>

      <div className="mx-3 mb-1 border-t border-slate-800" />

      {/* Navigation */}
      <nav aria-label="Sections" className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <ul className="space-y-1">
          {NAV_GROUPS.map((group) => (
            <NavGroup key={group.id} group={group} collapsed={collapsed} />
          ))}
        </ul>
      </nav>

      <div className="mx-3 border-t border-slate-800" />
    </aside>
  );
}
