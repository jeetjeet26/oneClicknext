'use client'

import {useEffect, useId, useRef, useState} from 'react'

const zones = ['America/Los_Angeles','America/Denver','America/Phoenix','America/Chicago','America/New_York','America/Anchorage','Pacific/Honolulu','America/Toronto','America/Vancouver','Europe/London','Australia/Sydney','Asia/Kolkata','UTC']

export function PropertyTimezoneSetup({propertyId, onSaved}: {propertyId: string; onSaved: () => void}) {
  const [timezone, setTimezone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const identity = useRef<{timezone: string; requestId: string} | null>(null)
  const active = useRef<AbortController | null>(null)
  const listId = useId()
  useEffect(() => () => active.current?.abort(), [])

  async function save() {
    if(active.current || !timezone.trim()) return
    const selected = timezone.trim()
    if(identity.current?.timezone !== selected) identity.current = {timezone: selected, requestId: crypto.randomUUID()}
    const controller = new AbortController(); active.current = controller
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/tours/timezone', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
        body: JSON.stringify({propertyId, ...identity.current}),
      })
      const result = await response.json()
      if(!response.ok || !result.context?.timezone) throw new Error(result.error || 'The timezone save is unconfirmed. Retry the same choice.')
      if(!controller.signal.aborted) onSaved()
    } catch(cause) {
      if(!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'The timezone save is unconfirmed. Retry the same choice safely.')
    } finally {
      if(!controller.signal.aborted) {active.current = null; setBusy(false)}
    }
  }

  return <section aria-label="Calendar timezone setup" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
    <h4 className="font-semibold">Choose the property timezone</h4>
    <p>Authorization is saved, but scheduling needs a valid timezone. Choose where this property is located.</p>
    <label className="block">Property timezone
      <input aria-label="Property timezone" list={listId} value={timezone} onChange={event => setTimezone(event.target.value)} disabled={busy} placeholder="For example, America/Los_Angeles" autoComplete="off" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2" />
    </label>
    <datalist id={listId}>{zones.map(zone => <option key={zone} value={zone}/>)}</datalist>
    <p className="text-xs">This completes missing setup. Previously saved tours keep their original timezone.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button type="button" disabled={busy || !timezone.trim()} onClick={() => void save()} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving timezone…' : 'Save property timezone'}</button>
  </section>
}
