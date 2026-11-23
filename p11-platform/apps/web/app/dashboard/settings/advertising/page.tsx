'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'

const endpoint = '/api/integrations/google-ads/agency'
const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm'
const buttonClass = 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50'

type Setup = {
  appConfigured: boolean
  authorized: boolean
  legacyConfigured: boolean
  managerId: string | null
  callbackUrl: string
  revision: number
}

const callbackMessages: Record<string, string> = {
  connected: 'Google Ads is authorized. You can now link advertisers in Community Knowledge.',
  manager: 'Google did not confirm access to that manager. Check the manager ID and choose a Google account with access.',
  declined: 'Google Ads authorization was declined. You can try again here.',
  invalid: 'This authorization request expired or was already used. Start a new one here.',
  changed: 'The Google Ads configuration changed during authorization. Start a new authorization.',
  scope: 'Google did not grant ongoing Google Ads access. Try again and approve Google Ads access.',
  failed: 'Google Ads authorization could not be completed. Check the Google Cloud app and the manager account access, then try again.',
}

async function requestSetup<T>(options: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint, { cache: 'no-store', ...options })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Google Ads setup could not be loaded.')
  return result
}

function AgencyAdvertisingPanel() {
  const callback = useSearchParams().get('googleAds')
  const [setup, setSetup] = useState<Setup>()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    requestSetup<Setup>({ signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setSetup(data)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [attempt])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!setup || busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setError('')
    try {
      await requestSetup({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure', revision: setup.revision,
          app: { clientId: values.get('clientId'), clientSecret: values.get('clientSecret'), managerId: values.get('managerId') },
        }),
      })
      form.reset()
      setEditing(false)
      setSetup(await requestSetup<Setup>())
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the Google app.')
    } finally {
      setBusy(false)
    }
  }

  async function authorize() {
    setBusy(true)
    setError('')
    try {
      const { authorizationUrl } = await requestSetup<{ authorizationUrl: string }>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'authorize' }),
      })
      window.location.assign(authorizationUrl)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start Google Ads authorization.')
      setBusy(false)
    }
  }

  const message = callback ? callbackMessages[callback] : undefined
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <Link className="text-sm underline" href="/dashboard/settings">Settings</Link>
      <h1 className="text-2xl font-semibold">Agency advertising</h1>
      <section aria-labelledby="agency-google-ads" className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 id="agency-google-ads" className="text-xl font-semibold">Google Ads</h2>
        <p className="text-sm text-muted-foreground">
          Authorize the agency manager once. In Community Knowledge, link each community to its dedicated advertiser account.
        </p>
        {message && <p role={callback === 'connected' ? 'status' : 'alert'} className="text-sm">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!setup && !error && <p role="status" className="text-sm">Loading Google Ads setup…</p>}
        {!setup && error && <button type="button" className={buttonClass} onClick={() => {
          setError('')
          setAttempt(value => value + 1)
        }}>Retry</button>}
        {setup && <>
          {setup.authorized ? (
            <p className="text-sm font-medium">Authorized manager {setup.managerId}</p>
          ) : setup.appConfigured ? (
            <p className="text-sm">Manager {setup.managerId} is ready to authorize.</p>
          ) : setup.legacyConfigured ? (
            <p className="text-sm">Using the server connection for manager {setup.managerId}.</p>
          ) : null}
          {!setup.authorized && (!setup.appConfigured || editing) && (
            <form className="max-w-xl space-y-3" onSubmit={save}>
              <p className="text-sm text-muted-foreground">
                Use a Web application OAuth client from a Google Cloud project with access to production Google Ads accounts. Register this redirect URI in that client.
              </p>
              <label className="block space-y-1 text-sm">Authorized redirect URI
                <input className={inputClass} readOnly value={setup.callbackUrl} onFocus={event => event.currentTarget.select()} />
              </label>
              <label className="block space-y-1 text-sm">Google OAuth client ID
                <input name="clientId" className={inputClass} required autoComplete="off" />
              </label>
              <label className="block space-y-1 text-sm">Google OAuth client secret
                <input name="clientSecret" className={inputClass} type="password" required autoComplete="off" />
              </label>
              <label className="block space-y-1 text-sm">Google Ads manager ID
                <input name="managerId" className={inputClass} required defaultValue={setup.managerId ?? ''} placeholder="123-456-7890" />
              </label>
              <button type="submit" className={buttonClass} disabled={busy}>Save Google app</button>
            </form>
          )}
          {setup.appConfigured && !editing && <div className="flex flex-wrap items-center gap-4">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => void authorize()}>
              {setup.authorized ? 'Reauthorize Google Ads' : 'Authorize Google Ads'}
            </button>
            {!setup.authorized && <button type="button" className="text-sm underline" onClick={() => setEditing(true)} disabled={busy}>Edit Google app</button>}
            {setup.authorized && <Link className="text-sm underline" href="/dashboard/community?section=overview">Open Community Knowledge</Link>}
          </div>}
        </>}
      </section>
    </div>
  )
}

export default function AgencyAdvertisingPage() {
  return <Suspense fallback={<p role="status" className="p-6">Loading agency advertising…</p>}>
    <AgencyAdvertisingPanel />
  </Suspense>
}
