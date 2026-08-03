'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'

type LegalFields = {
  jurisdiction: string
  legalEntityName: string
  effectiveAt: string
  privacyPolicy: string
  terms: string
  accessibility: string
  fairHousing: string
  pricingDisclaimer: string
  analyticsConsent: string
  communicationsConsent: string
}

type Poi = {
  id?: string
  name: string
  category: string
  sourceUrl: string
  capturedAt: string
  distanceMiles: string
  travelTimeMinutes: string
  confidence: string
  approvalStatus: 'pending' | 'approved' | 'rejected'
}

const emptyLegal: LegalFields = {
  jurisdiction: '',
  legalEntityName: '',
  effectiveAt: new Date().toISOString().slice(0, 16),
  privacyPolicy: '',
  terms: '',
  accessibility: '',
  fairHousing: '',
  pricingDisclaimer: '',
  analyticsConsent: '',
  communicationsConsent: '',
}

function emptyPoi(): Poi {
  return {
    name: '',
    category: '',
    sourceUrl: '',
    capturedAt: new Date().toISOString().slice(0, 16),
    distanceMiles: '',
    travelTimeMinutes: '',
    confidence: '1',
    approvalStatus: 'pending',
  }
}

function documentText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const text = (value as Record<string, unknown>).text
  return typeof text === 'string' ? text : ''
}

export function OnboardingTruthEditor({ propertyId }: { propertyId: string }) {
  const [legal, setLegal] = useState<LegalFields>(emptyLegal)
  const [points, setPoints] = useState<Poi[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!propertyId) return
    const [legalResponse, poiResponse] = await Promise.all([
      fetch(`/api/onboarding/legal?propertyId=${encodeURIComponent(propertyId)}`),
      fetch(`/api/onboarding/points-of-interest?propertyId=${encodeURIComponent(propertyId)}`),
    ])
    if (legalResponse.ok) {
      const row = (await legalResponse.json()).legalConfig
      if (row) {
        setLegal({
          jurisdiction: row.jurisdiction || '',
          legalEntityName: row.legal_entity_name || '',
          effectiveAt: row.effective_at?.slice(0, 16) || emptyLegal.effectiveAt,
          privacyPolicy: documentText(row.privacy_policy),
          terms: documentText(row.terms),
          accessibility: documentText(row.accessibility),
          fairHousing: documentText(row.fair_housing),
          pricingDisclaimer: documentText(row.pricing_disclaimer),
          analyticsConsent: documentText(row.analytics_consent),
          communicationsConsent: documentText(row.communications_consent),
        })
      }
    }
    if (poiResponse.ok) {
      const body = await poiResponse.json()
      setPoints((body.pointsOfInterest || []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        name: String(row.name || ''),
        category: String(row.category || ''),
        sourceUrl: String(row.source_url || ''),
        capturedAt: String(row.captured_at || '').slice(0, 16),
        distanceMiles: row.distance_miles == null ? '' : String(row.distance_miles),
        travelTimeMinutes: row.travel_time_minutes == null ? '' : String(row.travel_time_minutes),
        confidence: String(row.confidence ?? 1),
        approvalStatus: (row.approval_status || 'pending') as Poi['approvalStatus'],
      })))
    }
  }, [propertyId])

  useEffect(() => {
    void load()
  }, [load])

  async function saveLegal(approve: boolean) {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/onboarding/legal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          jurisdiction: legal.jurisdiction,
          legalEntityName: legal.legalEntityName,
          effectiveAt: new Date(legal.effectiveAt).toISOString(),
          approve,
          privacyPolicy: { text: legal.privacyPolicy },
          terms: { text: legal.terms },
          accessibility: { text: legal.accessibility },
          fairHousing: { text: legal.fairHousing },
          pricingDisclaimer: { text: legal.pricingDisclaimer },
          analyticsConsent: { text: legal.analyticsConsent },
          communicationsConsent: { text: legal.communicationsConsent },
          sourceReferences: [],
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Legal save failed')
      setMessage(approve ? 'Legal configuration approved.' : 'Legal draft saved.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Legal save failed')
    } finally {
      setBusy(false)
    }
  }

  async function savePoints() {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/onboarding/points-of-interest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          pointsOfInterest: points.map(point => ({
            ...point,
            capturedAt: new Date(point.capturedAt).toISOString(),
            confidence: Number(point.confidence),
            ...(point.distanceMiles ? { distanceMiles: Number(point.distanceMiles) } : {}),
            ...(point.travelTimeMinutes ? { travelTimeMinutes: Number(point.travelTimeMinutes) } : {}),
            address: {},
          })),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Neighborhood save failed')
      setMessage('Neighborhood sources saved.')
      await load()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Neighborhood save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
      <div>
        <h3 className="font-semibold text-slate-900">Site content approvals</h3>
        <p className="mt-1 text-sm text-slate-500">
          Approve the legal versions and sourced neighborhood facts SiteForge may publish.
        </p>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900">Legal and consent</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Jurisdiction" value={legal.jurisdiction} onChange={value => setLegal(current => ({ ...current, jurisdiction: value }))} />
          <Field label="Legal entity" value={legal.legalEntityName} onChange={value => setLegal(current => ({ ...current, legalEntityName: value }))} />
          <Field label="Effective date" type="datetime-local" value={legal.effectiveAt} onChange={value => setLegal(current => ({ ...current, effectiveAt: value }))} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {([
            ['privacyPolicy', 'Privacy policy'],
            ['terms', 'Terms'],
            ['accessibility', 'Accessibility statement'],
            ['fairHousing', 'Fair Housing statement'],
            ['pricingDisclaimer', 'Pricing disclaimer'],
            ['analyticsConsent', 'Analytics/cookie consent'],
            ['communicationsConsent', 'Communications consent'],
          ] as const).map(([key, label]) => (
            <label key={key} className="space-y-1 text-xs font-medium text-slate-600">
              {label}
              <textarea
                rows={3}
                value={legal[key]}
                onChange={event => setLegal(current => ({ ...current, [key]: event.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
              />
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <ActionButton busy={busy} onClick={() => void saveLegal(false)}>Save draft</ActionButton>
          <ActionButton busy={busy} primary onClick={() => void saveLegal(true)}>Approve legal version</ActionButton>
        </div>
      </div>

      <div className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">Sourced neighborhood points</h4>
          <button type="button" onClick={() => setPoints(current => [...current, emptyPoi()])} className="flex items-center gap-1 text-xs font-medium text-indigo-600">
            <Plus className="h-4 w-4" /> Add point
          </button>
        </div>
        {points.map((point, index) => (
          <div key={point.id || index} className="grid gap-2 rounded-lg border p-3 md:grid-cols-4">
            <Field label="Name" value={point.name} onChange={value => setPoints(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: value } : item))} />
            <Field label="Category" value={point.category} onChange={value => setPoints(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: value } : item))} />
            <Field label="Source URL" type="url" value={point.sourceUrl} onChange={value => setPoints(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, sourceUrl: value } : item))} />
            <label className="space-y-1 text-xs font-medium text-slate-600">
              Review
              <div className="flex gap-2">
                <select value={point.approvalStatus} onChange={event => setPoints(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, approvalStatus: event.target.value as Poi['approvalStatus'] } : item))} className="h-10 flex-1 rounded-lg border px-2 text-sm">
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <button type="button" aria-label={`Remove ${point.name || 'point'}`} onClick={() => setPoints(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </label>
          </div>
        ))}
        <ActionButton busy={busy} primary onClick={() => void savePoints()}>
          <Save className="h-4 w-4" /> Save neighborhood sources
        </ActionButton>
      </div>
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </section>
  )
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-600">
      {label}
      <input type={type} value={value} onChange={event => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal text-slate-900" />
    </label>
  )
}

function ActionButton({ busy, primary = false, onClick, children }: {
  busy: boolean
  primary?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${primary ? 'bg-indigo-600 text-white' : 'border text-slate-700'}`}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
