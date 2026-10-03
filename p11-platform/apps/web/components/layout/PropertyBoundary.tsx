'use client';

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { usePropertyContext } from './PropertyContext';

export function PropertyBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { loading, loadError, currentProperty, refreshProperties } = usePropertyContext();
  // Property setup and account administration must be reachable before the first property exists.
  const independent = pathname === '/dashboard/properties' || pathname.startsWith('/dashboard/properties/') ||
    pathname === '/dashboard/profile' || pathname === '/dashboard/team' || pathname === '/dashboard/settings';
  if (independent) return children;
  if (!loading && !loadError && currentProperty.id) {
    // Clear property-specific drafts and in-flight client effects when the scope changes.
    return <Fragment key={currentProperty.id}>{children}</Fragment>;
  }
  return <section aria-label="Property access" className="mx-auto my-12 max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-8">
    {loading ? <p role="status">Loading your properties…</p> : <>
      <h1 className="text-2xl font-semibold">{loadError ? 'Properties unavailable' : 'Add your first property'}</h1>
      <p role={loadError ? 'alert' : 'status'} className="mt-3 text-sm text-slate-600">
        {loadError ?? 'Your organization has no properties yet. Add a property to start using the console.'}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={() => void refreshProperties()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
          {loadError ? 'Retry loading properties' : 'Refresh properties'}
        </button>
        <Link href={loadError ? '/dashboard/properties' : '/dashboard/properties/new'} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
          {loadError ? 'Manage properties' : 'Add property'}
        </Link>
      </div>
    </>}
  </section>;
}
