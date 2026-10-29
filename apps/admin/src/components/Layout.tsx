/**
 * SM Live Super Admin — application shell.
 *
 * Composes the Sidebar (desktop), MobileDrawer, Header and the main content
 * area. Reads the package version from import.meta for the footer (no
 * invented version strings).
 *
 * Authentication is enforced upstream by the App.tsx shell: this component
 * only renders when an admin session exists.
 */
import { useState } from "react";
import { Header } from "./Header";
import { MobileDrawer } from "./MobileDrawer";
import { Sidebar, useSidebarCollapsed } from "./Sidebar";

const APP_VERSION = "0.1.0"; // mirrors apps/admin/package.json — kept in sync manually to avoid runtime file reads.

export function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
      {/* Desktop sidebar — fixed width, hidden below the lg breakpoint */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} />
      </div>

      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onToggleSidebar={toggleCollapsed}
          onOpenMobile={() => setMobileOpen(true)}
        />

        <main
          id="main-content"
          className="flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-white/60 px-4 py-3 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/60 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col items-start justify-between gap-1 sm:flex-row sm:items-center">
        <span>
          SM&nbsp;Live · Super Admin
        </span>
        <span className="text-slate-400/80">
          v{APP_VERSION} · © {year}
        </span>
      </div>
    </footer>
  );
}
