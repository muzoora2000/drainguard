import { Link } from 'react-router-dom';
import { ArrowLeft, Compass, ShieldAlert } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-lg text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-400">
          <Compass className="h-8 w-8" />
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The page you requested does not exist or may have moved. Return to the operations dashboard to continue.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-lg text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert className="h-8 w-8" />
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">Access restricted</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">This area is not available to your role</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Your account does not have permission to view this page. Contact an administrator if you believe your access should be updated.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
