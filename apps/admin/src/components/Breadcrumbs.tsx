/**
 * Breadcrumbs derived from the current route.
 *
 * Resolves the active leaf from {@link findLeaf}. Always renders at least
 * "Admin" as the root. When the route is unknown (e.g. /unknown), only the
 * root is shown, with a final "Not found" crumb handled by the parent.
 */
import { Link, useLocation } from "react-router-dom";
import { findLeaf, findGroupForPath } from "../navigation";
import { Icon } from "./Icon";

export interface Crumb {
  label: string;
  to?: string;
}

export function useBreadcrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const leaf = findLeaf(pathname);
  if (!leaf) return [{ label: "Admin" }];
  const group = findGroupForPath(pathname);
  const crumbs: Crumb[] = [{ label: "Admin", to: "/dashboard" }];
  if (group) crumbs.push({ label: group.label });
  crumbs.push({ label: leaf.label });
  return crumbs;
}

export function Breadcrumbs() {
  const crumbs = useBreadcrumbs();
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm">
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.to && !last ? (
                <Link
                  to={c.to}
                  className="text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  className={last ? "font-medium text-slate-700 dark:text-slate-200" : "text-slate-400"}
                  aria-current={last ? "page" : undefined}
                >
                  {c.label}
                </span>
              )}
              {!last && (
                <Icon name="chevronRight" className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
