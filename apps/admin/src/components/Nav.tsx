/**
 * Navigation primitives for the Super Admin sidebar.
 *
 * Three exported units:
 *   - NavItem         A single nav entry. Active state via NavLink, planned
 *                     items render disabled with a "planned" badge + tooltip.
 *   - NavGroupHeader  Click-to-expand group label with chevron + group icon.
 *   - NavGroup        Wraps the header + collapsible list of NavItem.
 *
 * Accessibility:
 *   - Each group header is a <button> with aria-expanded / aria-controls.
 *   - Collapsed sidebar hides labels but keeps the buttons focusable & titled.
 *   - Active leaf is identified by aria-current="page" via NavLink.
 *
 * Reduced motion: collapse animation only affects opacity/transform, no
 * layout shift, so the prefers-reduced-motion fallback (no animation) is fine.
 */
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { NavGroup as NavGroupModel, NavLeaf } from "../navigation";
import { useAuth } from "../auth";
import { Icon } from "./Icon";
import { Badge } from "./ui";

interface NavItemProps {
  item: NavLeaf;
  collapsed: boolean;
  onNavigate?: () => void;
}

export function NavItem({ item, collapsed, onNavigate }: NavItemProps) {
  const { can } = useAuth();
  // Permission gate: never render items the admin cannot read.
  if (!can(item.perm)) return null;

  const label = (
    <span className="truncate">{item.label}</span>
  );

  if (item.planned || !item.to) {
    // Planned modules render as a disabled, non-clickable entry.
    const content = (
      <>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-400 dark:text-slate-500">
          <Icon name={item.icon} className="h-[18px] w-[18px]" />
        </span>
        {!collapsed && (
          <span className="flex flex-1 items-center justify-between gap-2 truncate">
            {label}
            <Badge tone="slate">planned</Badge>
          </span>
        )}
      </>
    );
    return (
      <li role="none">
        <span
          role="menuitem"
          aria-disabled="true"
          title={collapsed ? `${item.label} — planned` : item.hint ?? "Planned module"}
          tabIndex={-1}
          className={`group relative flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-400 dark:text-slate-500 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {content}
        </span>
      </li>
    );
  }

  return (
    <li role="none">
      <NavLink
        to={item.to}
        onClick={onNavigate}
        end={item.to === "/dashboard"}
        title={collapsed ? item.label : item.hint}
        aria-label={item.label}
        className={({ isActive }) =>
          `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
            collapsed ? "justify-center" : ""
          } ${
            isActive
              ? "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          }`
        }
      >
        {({ isActive }) => (
          <>
            {/* Active rail (only visible in expanded mode) */}
            {isActive && !collapsed && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-violet-500"
              />
            )}
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                isActive
                  ? "text-violet-600 dark:text-violet-300"
                  : "text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-200"
              }`}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px]" />
            </span>
            {!collapsed && label}
          </>
        )}
      </NavLink>
    </li>
  );
}

interface NavGroupProps {
  group: NavGroupModel;
  collapsed: boolean;
  onNavigate?: () => void;
}

export function NavGroup({ group, collapsed, onNavigate }: NavGroupProps) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const containsActive = group.items.some((i) => i.to === pathname);

  // When the sidebar is expanded, default each group to open if it contains
  // the current route OR has been explicitly opened by the user.
  const [open, setOpen] = useState<boolean>(containsActive);

  // Re-sync open state if the route changes underneath us (e.g. browser back).
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  // Hide groups whose permission is not held by the current admin.
  if (!can(group.perm)) return null;

  const expanded = collapsed ? false : open;

  if (collapsed) {
    // Collapsed mode: hide labels entirely. The group's icon button still
    // expands the sidebar on click so the user can see its children.
    return (
      <li role="none" className="px-2">
        <button
          type="button"
          title={group.label}
          aria-label={group.label}
          className="group relative mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Icon name={group.icon} className="h-5 w-5" />
          {containsActive && (
            <span className="absolute -right-0.5 top-1 h-1.5 w-1.5 rounded-full bg-violet-500" />
          )}
        </button>
      </li>
    );
  }

  return (
    <li role="none">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`nav-group-${group.id}`}
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <Icon name={group.icon} className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1 text-left">{group.label}</span>
        <span
          className={`text-slate-400 transition-transform duration-150 ${
            expanded ? "rotate-180" : ""
          }`}
        >
          <Icon name="chevronDown" className="h-3.5 w-3.5" />
        </span>
      </button>
      <ul
        id={`nav-group-${group.id}`}
        role="menu"
        className={`mt-0.5 space-y-0.5 overflow-hidden px-2 transition-[max-height,opacity] duration-200 ${
          expanded ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {group.items.map((item) => (
          <NavItem key={item.label} item={item} collapsed={false} onNavigate={onNavigate} />
        ))}
      </ul>
    </li>
  );
}
