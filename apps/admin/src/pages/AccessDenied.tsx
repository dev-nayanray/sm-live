/**
 * Access-denied state.
 *
 * Shown when an authenticated admin reaches a route whose permission they do
 * not hold. The backend ALSO enforces this permission on the API endpoint, so
 * this page is defence-in-depth — not a replacement for server-side authz.
 *
 * Backend enforcement lives in {@link apps/api/src/lib/auth.ts} `requireAdmin`.
 */
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";

interface AccessDeniedProps {
  /** Permission code the user was missing, if known. */
  perm?: string;
  message?: string;
}

export function AccessDenied({ perm, message }: AccessDeniedProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10">
        <Icon name="forbidden" className="h-9 w-9" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Access denied</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {message ??
            (perm
              ? `Your role does not include the “${perm}” permission. Contact a Super Admin if you believe this is an error.`
              : "You do not have permission to view this page. Contact a Super Admin if you believe this is an error.")}
        </p>
      </div>
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
      >
        <Icon name="gauge" className="h-4 w-4" />
        Back to dashboard
      </Link>
    </div>
  );
}
