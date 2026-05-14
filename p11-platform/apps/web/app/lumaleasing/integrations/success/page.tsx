'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function SuccessContent() {
  const searchParams = useSearchParams()
  const provider = searchParams.get('provider')
  const email = searchParams.get('email')
  const error = searchParams.get('error')

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <section className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-md w-full p-8">
        {error ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-600 mb-3">
              Connection Failed
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">
              We could not finish authorization
            </h1>
            <p className="text-sm text-slate-600">
              Please ask your P11 contact for a fresh link. Error: <span className="font-medium">{error}</span>
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-green-600 mb-3">
              Connected
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">
              Authorization Complete
            </h1>
            <p className="text-sm text-slate-600">
              {provider ? `${provider[0]?.toUpperCase()}${provider.slice(1)}` : 'Your account'} has been connected
              {email ? ` for ${email}` : ''}. You can close this page.
            </p>
          </>
        )}
      </section>
    </main>
  )
}

export default function IntegrationSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessContent />
    </Suspense>
  )
}
