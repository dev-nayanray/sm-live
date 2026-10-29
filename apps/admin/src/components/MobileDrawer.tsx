/**
 * Mobile navigation drawer.
 *
 * Renders as a full-height drawer that slides in from the left, with an
 * overlay behind it. Focus is moved into the drawer on open and restored
 * to the trigger button on close. Escape closes the drawer.
 *
 * The drawer always renders the EXPANDED sidebar (labels visible) regardless
 * of the desktop collapse preference.
 */
import { useEffect, useRef } from "react";
import { NAV_GROUPS } from "../navigation";
import { Icon } from "./Icon";
import { NavGroup } from "./Nav";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (open) {
      // Defer one tick so the close button is mounted.
      const t = window.setTimeout(() => closeBtnRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-slate-900 shadow-2xl">
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600 text-white">
              <Icon name="broadcast" className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-white">SM&nbsp;Live</div>
              <div className="text-[11px] uppercase tracking-wider text-violet-300/80">
                Super Admin
              </div>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-3 border-t border-slate-800" />

        <nav aria-label="Mobile sections" className="flex-1 overflow-y-auto py-2">
          <ul className="space-y-1">
            {NAV_GROUPS.map((group) => (
              <NavGroup key={group.id} group={group} collapsed={false} onNavigate={onClose} />
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
