'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMarketDecision } from '@/utils/marketvision/decision-client'
import { isMarketListing } from '@/utils/marketvision/listing-contracts'

type Listing = { competitorId: string; version: number; isActive: boolean; url: string | null }
export function CompetitorListingPanel({ propertyId, competitorId, onChanged }: {
  propertyId: string; competitorId: string; onChanged: () => void
}) {
  const [saved, setSaved] = useState<Listing | null>(null)
  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')
  const [removing, setRemoving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/marketvision/listings?${new URLSearchParams({ propertyId, competitorId })}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'The saved listing could not be loaded.')
      if (generation.current !== current) return
      setSaved(data.listing)
      setUrl(data.listing.url || '')
      setReason('')
      setRemoving(false)
    } catch (e) {
      if (generation.current !== current) return
      setError(e instanceof Error ? e.message : 'The saved listing could not be loaded.')
      setSaved(null)
    } finally { if (generation.current === current) setLoading(false) }
  }, [propertyId, competitorId])
  const invalidateRead = useCallback(() => { generation.current++ }, [])
  useEffect(() => { void load(); return invalidateRead }, [load, invalidateRead])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!saved) return
    if (!removing && !isMarketListing(url.trim())) { setError('Use the complete public Apartments.com listing URL.'); return }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await sendMarketDecision('/api/marketvision/listings', 'PUT', {
        propertyId, competitorId, expectedVersion: saved.version, reason,
        action: removing ? 'remove' : 'save', ...(removing ? {} : { url: url.trim() }),
      })
      setMessage(removing ? 'Listing removed. Previous source evidence is retained.' : 'Listing saved. Fetching prices is a separate decision.')
      await load()
      onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'The listing save could not be confirmed. Retry this same decision.') }
    finally { setSaving(false) }
  }

  return <section aria-label="Competitor listing" className="space-y-3 rounded-xl border p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Apartments.com listing</h3>
      <button disabled={loading || saving} onClick={() => { setMessage(''); void load() }} className="underline">Reload saved listing</button>
    </div>
    {loading && <p>Loading saved listing…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {saved?.url && <div className="break-all"><span className="text-gray-500">Saved source: </span>{isMarketListing(saved.url) ? <a href={saved.url} target="_blank" rel="noopener noreferrer" className="underline">{saved.url}</a> : <span>{saved.url} — this older URL needs review.</span>}</div>}
    {saved && !saved.url && <p>No Apartments.com listing is saved.</p>}
    {saved && !saved.isActive && <p>Restore this competitor before changing its source.</p>}
    <form aria-label="Listing decision" onSubmit={save}>
      <fieldset disabled={!saved || loading || saving || !saved.isActive} className="min-w-0 space-y-3">
        {removing ? <p>Remove the saved listing above from future source requests. Its historical evidence stays available.</p> : <label className="block">Listing URL<input type="url" required maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border p-2" placeholder="https://www.apartments.com/community/city/" /></label>}
        <label className="block">Reason for listing change<textarea required minLength={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : removing ? 'Confirm listing removal' : 'Save listing'}</button>
          {saved?.url && <button type="button" className="underline" onClick={() => { setRemoving(v => !v); setReason(''); setMessage(''); setError('') }}>{removing ? 'Keep listing' : 'Remove listing'}</button>}
        </div>
      </fieldset>
    </form>
    <p className="text-xs text-gray-500">A saved link identifies a source to review. Saving or removing it does not fetch prices, confirm their accuracy or change monitoring preferences.</p>
  </section>
}
