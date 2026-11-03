'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Loader2, Plus, RefreshCw, Save } from 'lucide-react'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import {
  InventoryRevisionPreview,
  type InventoryPreviewBlock,
} from '@/components/siteforge/InventoryRevisionPreview'

type Draft = {
  key: string
  name: string
  bedrooms: string
  bathrooms: string
  sqft: string
  rent: string
  availableCount: string
  imageUrl: string
  imageAssetId: string
  availabilityUrl: string
  applyUrl: string
  specials: string
  effectiveAt: string
  expiresAt: string
}

type Website = {
  id: string
  current_artifact_version_id: string
  generation_status: string | null
}

type ImportPreview = {
  importId: string
  rows: Array<Record<string, unknown>>
  errors: Array<{ row: number; field?: string; message: string }>
  canConfirm: boolean
}

type RevisionPreview = {
  artifactId: string
  candidateContentHash: string
  inventoryContentHash: string
  capturedAt: string
  changedBlockCount: number
  blocks: InventoryPreviewBlock[]
}

const blankDraft = (): Draft => ({
  key: crypto.randomUUID(),
  name: '',
  bedrooms: '',
  bathrooms: '',
  sqft: '',
  rent: '',
  availableCount: '',
  imageUrl: '',
  imageAssetId: '',
  availabilityUrl: '',
  applyUrl: '',
  specials: '',
  effectiveAt: '',
  expiresAt: '',
})

function localDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function isoOrUndefined(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function numberOrUndefined(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value)
}

export function ManualFloorPlansConsole({ onSaved }: { onSaved?: () => void }) {
  const { currentProperty, loading: propertyLoading } = usePropertyContext()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [websites, setWebsites] = useState<Website[]>([])
  const [websiteId, setWebsiteId] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [revisionPreview, setRevisionPreview] = useState<RevisionPreview | null>(null)

  const load = useCallback(async () => {
    if (!currentProperty?.id) return
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    try {
      const response = await fetch(
        `/api/siteforge/floor-plans/manual?propertyId=${encodeURIComponent(currentProperty.id)}`
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Failed to load floor plans')
      const units = (body.units || []).filter((unit: { active: boolean }) => unit.active)
      setDrafts(units.map((unit: Record<string, unknown>) => ({
        key: String(unit.canonical_key || unit.id),
        name: String(unit.unit_type || ''),
        bedrooms: String(unit.bedrooms ?? ''),
        bathrooms: String(unit.bathrooms ?? ''),
        sqft: String(unit.sqft_min ?? ''),
        rent: String(unit.rent_min ?? ''),
        availableCount: String(unit.available_count ?? ''),
        imageUrl: String(unit.floor_plan_image_url || ''),
        imageAssetId: String(unit.floor_plan_image_asset_id || ''),
        availabilityUrl: String(unit.availability_url || ''),
        applyUrl: String(unit.apply_url || ''),
        specials: String(unit.move_in_specials || ''),
        effectiveAt: localDateTime(unit.effective_at as string | null),
        expiresAt: localDateTime(unit.expires_at as string | null),
      })))
      const nextWebsites = (body.websites || []) as Website[]
      setWebsites(nextWebsites)
      setWebsiteId((current) =>
        nextWebsites.some((website) => website.id === current)
          ? current
          : nextWebsites[0]?.id || ''
      )
      setImportPreview(null)
      setRevisionPreview(null)
    } catch (cause) {
      setLoadFailed(true)
      setError(cause instanceof Error ? cause.message : 'Failed to load floor plans')
    } finally {
      setLoading(false)
    }
  }, [currentProperty?.id])

  useEffect(() => {
    if (!propertyLoading) void load()
  }, [load, propertyLoading])

  const update = (key: string, field: keyof Draft, value: string) => {
    setDrafts((rows) => rows.map((row) => row.key === key ? { ...row, [field]: value } : row))
    setImportPreview(null)
    setRevisionPreview(null)
    setNotice(null)
  }

  const payloadRows = useMemo(() => drafts.map((row) => ({
    externalId: row.key,
    name: row.name,
    bedrooms: row.bedrooms,
    bathrooms: numberOrUndefined(row.bathrooms),
    sqftMin: numberOrUndefined(row.sqft),
    sqftMax: numberOrUndefined(row.sqft),
    rentMin: numberOrUndefined(row.rent),
    rentMax: numberOrUndefined(row.rent),
    availableCount: numberOrUndefined(row.availableCount),
    imageUrl: row.imageUrl || undefined,
    imageAssetId: row.imageAssetId || undefined,
    imageAlt: row.imageUrl ? `${row.name || 'Floor plan'} floor plan` : undefined,
    availabilityUrl: row.availabilityUrl || undefined,
    applyUrl: row.applyUrl || undefined,
    specials: row.specials || undefined,
    effectiveAt: isoOrUndefined(row.effectiveAt),
    expiresAt: isoOrUndefined(row.expiresAt),
  })), [drafts])

  async function uploadImage(key: string, file?: File) {
    if (!file) return
    setError(null)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP image, up to 20 MB.')
      return
    }
    setUploading(key)
    setImportPreview(null)
    setRevisionPreview(null)
    setNotice(null)
    try {
      const form = new FormData()
      form.set('propertyId', currentProperty.id)
      form.set('category', 'floorplan')
      form.set('file', file)
      form.set('altText', `${drafts.find(row => row.key === key)?.name || 'Floor plan'} layout`)
      const response = await fetch('/api/siteforge/assets', { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Image upload failed. Please try again.')
      if (!body.asset?.url || !body.asset?.id) throw new Error('The upload did not return an image. Please try again.')
      setDrafts(rows => rows.map(row => row.key === key ? { ...row, imageUrl: body.asset.url, imageAssetId: body.asset.id } : row))
      setNotice('Image uploaded. Review and save the floor plan to attach it.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Image upload failed. Please try again.')
    } finally {
      setUploading(null)
    }
  }

  async function previewChanges() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/siteforge/floor-plans/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          sourceType: 'manual',
          sourceIdentity: 'property-console',
          rows: payloadRows.map(row => ({
            ...row,
            sourceUpdatedAt: new Date().toISOString(),
          })),
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Preview failed')
      setImportPreview(body)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmChanges() {
    if (!importPreview?.canConfirm) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/siteforge/floor-plans/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          importId: importPreview.importId,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Confirmation failed')
      setNotice(`Saved ${body.applied} floor plan row(s).`)
      await load()
      onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Confirmation failed')
    } finally {
      setBusy(false)
    }
  }

  async function previewWebsiteRefresh() {
    if (!websiteId) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/siteforge/floor-plans/revision/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: currentProperty.id, websiteId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Website preview failed')
      setRevisionPreview(body)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Website preview failed')
    } finally {
      setBusy(false)
    }
  }

  async function publishWebsiteRefresh() {
    if (!revisionPreview || !websiteId) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/siteforge/floor-plans/revision/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: currentProperty.id,
          websiteId,
          expectedArtifactId: revisionPreview.artifactId,
          expectedCandidateContentHash: revisionPreview.candidateContentHash,
          expectedInventoryContentHash: revisionPreview.inventoryContentHash,
          capturedAt: revisionPreview.capturedAt,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Website publish failed')
      setNotice(`Published inventory-only SiteForge revision ${body.version}.`)
      setRevisionPreview(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Website publish failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading || propertyLoading) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
  }

  if (loadFailed) {
    return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <p>Floor plan editing could not be loaded: {error}</p>
      <button type="button" onClick={() => void load()} className="mt-2 underline">Retry loading floor plan editing</button>
    </div>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Upload and edit floor plans</h2>
            <p className="text-sm text-slate-500">Add your real floorplan images and details. Review changes, then save to update this community.</p>
          </div>
          <button type="button" disabled={busy || !!uploading} onClick={() => { setDrafts((rows) => [...rows, blankDraft()]); setImportPreview(null); setRevisionPreview(null); setNotice(null) }} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Plus size={16} /> Add floor plan
          </button>
        </div>

        <div className="space-y-4">
          {drafts.map((row) => (
            <fieldset disabled={busy || !!uploading} key={row.key} className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-4">
              <legend className="px-2 text-sm font-medium text-slate-700">{row.name || 'New floor plan'}</legend>
              <Field label="Name" value={row.name} required onChange={(value) => update(row.key, 'name', value)} />
              <Field label="Beds" value={row.bedrooms} type="number" required onChange={(value) => update(row.key, 'bedrooms', value)} />
              <Field label="Baths" value={row.bathrooms} type="number" step="0.5" onChange={(value) => update(row.key, 'bathrooms', value)} />
              <Field label="Square feet" value={row.sqft} type="number" onChange={(value) => update(row.key, 'sqft', value)} />
              <Field label="Monthly rent" value={row.rent} type="number" onChange={(value) => update(row.key, 'rent', value)} />
              <Field label="Available count" value={row.availableCount} type="number" onChange={(value) => update(row.key, 'availableCount', value)} />
              <div className="space-y-2 md:col-span-4">
                <label className="block text-sm font-medium text-slate-700">
                  Floorplan image
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !!uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadImage(row.key, file) }} className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:font-medium file:text-indigo-700" />
                </label>
                <p className="text-xs text-slate-500">Upload a JPG, PNG or WebP image, up to 20 MB.</p>
                {uploading === row.key && <p role="status" className="text-sm text-indigo-700">Uploading floorplan image…</p>}
                {row.imageUrl && <Image src={row.imageUrl} alt={`${row.name || 'Floor plan'} layout`} width={640} height={480} unoptimized className="max-h-64 w-auto max-w-full rounded-lg border border-slate-200 object-contain" />}
              </div>
              <Field label="Availability URL" value={row.availabilityUrl} type="url" onChange={(value) => update(row.key, 'availabilityUrl', value)} />
              <Field label="Apply URL" value={row.applyUrl} type="url" onChange={(value) => update(row.key, 'applyUrl', value)} />
              <Field label="Effective" value={row.effectiveAt} type="datetime-local" onChange={(value) => update(row.key, 'effectiveAt', value)} />
              <Field label="Confirmed through" value={row.expiresAt} type="datetime-local" onChange={(value) => update(row.key, 'expiresAt', value)} />
              <label className="md:col-span-3 text-sm font-medium text-slate-700">
                Specials
                <textarea value={row.specials} onChange={(event) => update(row.key, 'specials', event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
              </label>
              <div className="flex items-end justify-end">
                <button type="button" disabled={busy || !!uploading} onClick={() => { setDrafts((rows) => rows.filter((item) => item.key !== row.key)); setImportPreview(null) }} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                  <Archive size={16} /> Archive
                </button>
              </div>
            </fieldset>
          ))}
          {!drafts.length && <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">Choose Add floor plan to upload an image and enter its details. Imported plans are listed below.</p>}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button disabled={busy || !!uploading} onClick={previewChanges} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            <Save size={16} /> Review changes
          </button>
          {importPreview?.canConfirm && (
            <button disabled={busy || !!uploading} onClick={confirmChanges} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Save floor plans
            </button>
          )}
        </div>

        {importPreview && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-800">{importPreview.rows.length} floor plan(s) ready to save</p>
            {importPreview.errors.map((item) => <p key={`${item.row}:${item.field}:${item.message}`} className="mt-1 text-red-600">Row {item.row}{item.field ? ` · ${item.field}` : ''}: {item.message}</p>)}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">SiteForge inventory-only refresh</h2>
        <p className="mt-1 text-sm text-slate-500">Update floor plan prices and availability on an existing website. Its design and other content stay unchanged.</p>
        {websites.length ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-slate-700">
              Website
              <select value={websiteId} onChange={(event) => { setWebsiteId(event.target.value); setRevisionPreview(null) }} className="mt-1 block w-full max-w-full rounded-lg border border-slate-300 px-3 py-2 font-normal">
                {websites.map((website) => <option key={website.id} value={website.id}>{website.id} · {website.generation_status || 'unknown'}</option>)}
              </select>
            </label>
            <button disabled={busy || !!uploading || !websiteId} onClick={previewWebsiteRefresh} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              <RefreshCw size={16} /> Build exact website preview
            </button>
          </div>
        ) : <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">No SiteForge website with a current artifact is available for this property.</p>}

        {revisionPreview && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
              Review all {revisionPreview.changedBlockCount} affected block(s). Publishing requires these exact artifact and inventory hashes.
            </div>
            <InventoryRevisionPreview blocks={revisionPreview.blocks} />
            <button disabled={busy || !!uploading} onClick={publishWebsiteRefresh} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Publish this exact inventory-only revision
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  step,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  step?: string
  required?: boolean
}) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        step={step}
        required={required}
        min={type === 'number' ? 0 : undefined}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
      />
    </label>
  )
}
