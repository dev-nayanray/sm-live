/**
 * Not-found state for unknown admin routes.
 *
 * Replaces the previous catch-all that silently redirected to /dashboard.
 * Direct navigation to a typo'd URL now shows a clear message; the user can
 * either go back or jump to the dashboard.
 */
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";

export function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
        <Icon name="compass" className="h-9 w-9" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Page not found</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          The page you were looking for does not exist or has moved.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => history.back()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Icon name="chevronLeft" className="h-4 w-4" />
          Go back
        </button>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <Icon name="gauge" className="h-4 w-4" />
          Dashboard
        </Link>
      </div>
    </div>
  );
}
