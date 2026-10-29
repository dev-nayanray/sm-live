/**
 * Header for the Super Admin shell.
 *
 * Contains: mobile menu trigger, sidebar collapse toggle (desktop), page
 * title + breadcrumbs, theme toggle, profile menu.
 *
 * Auth integration:
 *   - Reads the authenticated admin from {@link useAuth}.
 *   - Logout delegates to {@link useAuth.logout} which clears the bearer
 *     token from localStorage & in-memory state.
 *
 * No fake identity / notifications are rendered. The bell icon is wired to a
 * disabled placeholder — once a backend notification endpoint exists, this
 * button can be enabled.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { Icon } from "./Icon";
import { Breadcrumbs } from "./Breadcrumbs";
import { useTheme } from "./ui";
import { findLeaf } from "../navigation";

interface HeaderProps {
  onToggleSidebar: () => void;
  onOpenMobile: () => void;
}

export function Header({ onToggleSidebar, onOpenMobile }: HeaderProps) {
  const { admin, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const { pathname } = useLocation();
  const leaf = findLeaf(pathname);
  const title = leaf?.label ?? "Admin";
  const description = leaf?.hint;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/85 px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85 sm:px-5">
      {/* Mobile: open drawer */}
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white lg:hidden"
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>

      {/* Desktop: collapse toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Collapse navigation"
        title="Toggle sidebar"
        className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white lg:inline-flex"
      >
        <Icon name="menu" className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        {/* Title rendered as a non-heading element: each page owns its own
            <h1>, so a second <h1> here would break Playwright strict-mode
            heading selectors and confuse screen-reader users. */}
        <p className="truncate text-base font-semibold text-slate-800 dark:text-slate-100 sm:text-lg">
          {title}
        </p>
        <div className="hidden sm:block">
          <Breadcrumbs />
        </div>
        {description && (
          <p className="mt-0.5 hidden truncate text-xs text-slate-400 dark:text-slate-500 md:block">
            {description}
          </p>
        )}
      </div>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={toggle}
        aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
        title={dark ? "Light theme" : "Dark theme"}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      >
        <Icon name={dark ? "sun" : "moon"} className="h-5 w-5" />
      </button>

      {/* Notifications — disabled placeholder until a backend endpoint exists. */}
      <button
        type="button"
        aria-disabled="true"
        tabIndex={-1}
        title="Notifications — coming soon"
        className="relative hidden cursor-not-allowed rounded-lg p-2 text-slate-300 dark:text-slate-600 sm:inline-flex"
      >
        <Icon name="bell" className="h-5 w-5" />
      </button>

      {/* Profile menu */}
      <ProfileMenu admin={admin} logout={logout} />
    </header>
  );
}

interface ProfileMenuProps {
  admin: { username: string; displayName: string; role: string } | null;
  logout: () => void;
}

function ProfileMenu({ admin, logout }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!admin) return null;

  const initials = admin.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative ml-1">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white">
          {initials || <Icon name="user" className="h-4 w-4" />}
        </span>
        <span className="hidden text-left text-xs leading-tight sm:block">
          <span className="block max-w-[140px] truncate font-medium text-slate-700 dark:text-slate-100">
            {admin.displayName}
          </span>
          <span className="block text-slate-400">{admin.role}</span>
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {admin.displayName}
            </div>
            <div className="truncate text-xs text-slate-400">@{admin.username}</div>
            <div className="mt-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              {admin.role}
            </div>
          </div>
          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              disabled
              tabIndex={-1}
              className="flex w-full cursor-not-allowed items-center gap-2 px-4 py-2 text-sm text-slate-400 dark:text-slate-500"
              title="Account settings — planned"
            >
              <Icon name="gear" className="h-4 w-4" />
              Account settings
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              <Icon name="logout" className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
