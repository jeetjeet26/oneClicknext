'use client'

import {integrationFailureMessage} from '@/utils/services/integration-result-message'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

function SuccessContent() {
  const searchParams = useSearchParams()
  const provider = searchParams.get('provider')
  const email = searchParams.get('email')
  const success = searchParams.get('success')
  const error = searchParams.get('error') || (!['calendar_setup_required','calendar_connected','email_connected'].includes(success||'') ? 'authorization_unconfirmed' : null)
  const needsSetup = searchParams.get('success') === 'calendar_setup_required'

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <section className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-md w-full p-8">
        {error ? (
          <>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${error==='authorization_denied'?'text-amber-700':'text-red-600'}`}>
              {error==='authorization_denied'?'Authorization cancelled':'Connection needs attention'}
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">
              {error==='authorization_denied'?'You can reconnect when ready':'We could not finish authorization'}
            </h1>
            <p className="text-sm text-slate-600">
              {integrationFailureMessage(error)} Ask your P11 contact for a fresh link if needed.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-green-600 mb-3">
              {needsSetup ? 'Timezone setup required' : 'Authorization saved'}
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">
              {needsSetup ? 'One setup step remains' : 'Authorization Complete'}
            </h1>
            <p className="text-sm text-slate-600">
              {provider ? `${provider[0]?.toUpperCase()}${provider.slice(1)}` : 'Your account'} has been connected
              {email ? ` for ${email}` : ''}. {needsSetup ? 'Ask your P11 contact to choose the property timezone before scheduling tours.' : 'Your P11 contact can review the connection status. You can close this page.'}
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
