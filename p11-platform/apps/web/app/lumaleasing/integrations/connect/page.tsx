'use client'

import { Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'

function ConnectContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const googleUrl = useMemo(() => (
    token ? `/api/lumaleasing/integrations/oauth/google/start?token=${encodeURIComponent(token)}` : '#'
  ), [token])
  const microsoftUrl = useMemo(() => (
    token ? `/api/lumaleasing/integrations/oauth/microsoft/start?token=${encodeURIComponent(token)}` : '#'
  ), [token])

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <section className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-lg w-full p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-3">
          P11 LumaLeasing
        </p>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          Connect Your Calendar Or Inbox
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          This secure link connects the requested Google or Microsoft account to a single property.
          It does not create a P11 platform login.
        </p>

        {!token ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            This authorization link is missing its token. Please ask your P11 contact for a new link.
          </div>
        ) : (
          <div className="space-y-3">
            <a
              href={googleUrl}
              className="block w-full rounded-lg bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800"
            >
              Continue With Google
            </a>
            <a
              href={microsoftUrl}
              className="block w-full rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Continue With Microsoft
            </a>
          </div>
        )}

        <p className="text-xs text-slate-500 mt-6">
          If your organization blocks third-party consent, your Google Workspace or Microsoft 365 admin may need to approve access.
        </p>
      </section>
    </main>
  )
}

export default function IntegrationConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectContent />
    </Suspense>
  )
}
