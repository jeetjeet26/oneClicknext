'use client'

import { ImportedBrandReview, sourceName, sourceSummary } from './ImportedBrandReview'
import { brandRequest } from '@/utils/brandforge/client-requests'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'

async function finishUploads<T extends readonly unknown[]>(tasks: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const settled = await Promise.allSettled(tasks)
  for (const result of settled) if (result.status === 'rejected') throw result.reason
  return settled.map(result => result.status === 'fulfilled' ? result.value : undefined) as unknown as T
}

type ImportPreview = {
  id: string
  created_at?: string
  source_type?: string
  extracted_contract: Record<string, unknown>
  conflicts: Array<{
    field?: string
    candidates?: Array<{ source?: string; value?: unknown }>
  }>
}

export function ExistingBrandImportWizard({
  propertyId,
  onComplete,
}: {
  propertyId: string
  onComplete: (result: { brandAssetId: string; contractHash: string }) => void
}) {
  const requestMemory = useRef(new Map<string, { identity: string; requestId: string }>())
  const fileIds = useRef(new WeakMap<File, string>())
  const savedSources = useRef(new Map<string, string>())
  const savedAssets = useRef(new Map<string, { id: string; file_url: string; governance_revision: number }>())
  const approvedAssets = useRef(new Map<string, { assetId: string; url: string }>())
  function fileIdentity(file: File) {
    let id = fileIds.current.get(file)
    if (!id) { id = crypto.randomUUID(); fileIds.current.set(file, id) }
    return id
  }
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [brandName, setBrandName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#1F2937')
  const [secondaryColor, setSecondaryColor] = useState('#FFFFFF')
  const [accentColor, setAccentColor] = useState('#2563EB')
  const [headlineFont, setHeadlineFont] = useState('')
  const [bodyFont, setBodyFont] = useState('')
  const [voiceRules, setVoiceRules] = useState('')
  const [prohibitedUsage, setProhibitedUsage] = useState('')
  const [packageFiles, setPackageFiles] = useState<File[]>([])
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [secondaryLogoFile, setSecondaryLogoFile] = useState<File | null>(null)
  const [faviconFile, setFaviconFile] = useState<File | null>(null)
  const [headlineFontFile, setHeadlineFontFile] = useState<File | null>(null)
  const [bodyFontFile, setBodyFontFile] = useState<File | null>(null)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const hasAssets = Boolean(logoFile || secondaryLogoFile || faviconFile || headlineFontFile || bodyFontFile)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [reviewContract, setReviewContract] = useState<Record<string, unknown>>({})
  const [resolutions, setResolutions] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPreviews, setSavedPreviews] = useState<ImportPreview[]>([])
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/brandforge/import/preview?propertyId=${encodeURIComponent(propertyId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) return; const result = await response.json(); if (!controller.signal.aborted) setSavedPreviews(Array.isArray(result.previews) ? result.previews : []) })
      .catch(() => { /* A new import remains available if saved reviews cannot be loaded. */ })
    return () => controller.abort()
  }, [propertyId])
  function openPreview(saved: ImportPreview) {
    setPreview(saved); setReviewContract(saved.extracted_contract); setError(null)
    setResolutions(Object.fromEntries((saved.conflicts || []).flatMap(conflict => {
      const preferred = conflict.candidates?.find(candidate => candidate.source === 'manual') || conflict.candidates?.[0]
      return conflict.field && preferred ? [[conflict.field, preferred.value]] : []
    })))
  }

  const sourceType = useMemo(() => {
    const count = Number(Boolean(websiteUrl)) + Number(packageFiles.length > 0) + Number(Boolean(brandName || logoFile))
    if (count > 1) return 'hybrid'
    if (websiteUrl) return 'website'
    if (packageFiles.length) return 'package'
    return 'manual'
  }, [websiteUrl, packageFiles.length, brandName, logoFile])

  async function uploadPackageFiles(): Promise<string[]> {
    const sourceIds: string[] = []
    for (const file of packageFiles) {
      const identity = fileIdentity(file)
      const prior = savedSources.current.get(identity)
      if (prior) { sourceIds.push(prior); continue }
      const body = new FormData()
      body.append('file', file)
      body.append('propertyId', propertyId)
      body.append('requestId', JSON.parse(brandRequest(requestMemory, `source:${identity}`, { propertyId, identity })).requestId)
      const response = await fetch('/api/brandforge/import/sources', { method: 'POST', body })
      const result = await response.json()
      if (!response.ok || !result.sourceId) throw new Error(result.error || `Failed to save ${file.name}`)
      savedSources.current.set(identity, result.sourceId)
      sourceIds.push(result.sourceId)
    }
    return sourceIds
  }

  async function uploadBrandAsset(file: File | null, role: 'primary_logo' | 'secondary_logo' | 'favicon' | 'font', rightsStatus: 'owned' | 'licensed') {
    if (!file) return null
    const altText = role === 'font' ? file.name : `${brandName || 'Property'} ${role.replace('_', ' ')}`
    const identity = JSON.stringify({ propertyId, file: fileIdentity(file), role, rightsStatus, altText })
    const prior = approvedAssets.current.get(identity)
    if (prior) return prior
    let asset = savedAssets.current.get(identity)
    if (!asset) {
      const body = new FormData()
      body.append('file', file); body.append('propertyId', propertyId); body.append('role', role); body.append('rightsStatus', rightsStatus); body.append('altText', altText)
      body.append('requestId', JSON.parse(brandRequest(requestMemory, `asset:${identity}`, { identity })).requestId)
      const response = await fetch('/api/brandforge/content-assets', { method: 'POST', body })
      const result = await response.json()
      if (!response.ok || !result.asset) throw new Error(result.error || `${role} upload failed`)
      asset = result.asset as { id: string; file_url: string; governance_revision: number }
      savedAssets.current.set(identity, asset)
    }
    const review = await fetch('/api/brandforge/content-assets', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: brandRequest(requestMemory, `asset-review:${identity}`, {
        propertyId, assetId: asset.id, revision: asset.governance_revision, approvalStatus: 'approved', rightsStatus,
        rightsMetadata: { operatorConfirmed: true, licenseConfirmed: rightsStatus === 'licensed' }, altText,
      }),
    })
    const result = await review.json()
    if (!review.ok) throw new Error(result.error || `${role} approval failed`)
    const approved = { assetId: asset.id, url: asset.file_url }
    approvedAssets.current.set(identity, approved)
    return approved
  }

  async function createPreview() {
    if (busy || (hasAssets && !rightsConfirmed)) return
    setBusy(true)
    setError(null)
    try {
      const [sourceIds, logo, secondaryLogo, favicon, headlineAsset, bodyAsset] = await finishUploads([
        uploadPackageFiles(),
        uploadBrandAsset(logoFile, 'primary_logo', 'owned'),
        uploadBrandAsset(secondaryLogoFile, 'secondary_logo', 'owned'),
        uploadBrandAsset(faviconFile, 'favicon', 'owned'),
        uploadBrandAsset(headlineFontFile, 'font', 'licensed'),
        uploadBrandAsset(bodyFontFile, 'font', 'licensed'),
      ])
      const manual = {
        identity: { name: brandName },
        ...(logo ? {
          logos: {
            variants: [
              {
                role: 'primary',
                assetId: logo.assetId,
                url: logo.url,
                alt: `${brandName || 'Property'} logo`,
                restrictions: prohibitedUsage.split('\n').map(value => value.trim()).filter(Boolean),
              },
              ...(secondaryLogo ? [{
                role: 'secondary',
                assetId: secondaryLogo.assetId,
                url: secondaryLogo.url,
                alt: `${brandName || 'Property'} secondary logo`,
                restrictions: prohibitedUsage.split('\n').map(value => value.trim()).filter(Boolean),
              }] : []),
              ...(favicon ? [{
                role: 'favicon',
                assetId: favicon.assetId,
                url: favicon.url,
                alt: `${brandName || 'Property'} favicon`,
                restrictions: [],
              }] : []),
            ],
          },
        } : {}),
        colors: {
          roles: [
            { role: 'primary', name: 'Primary', hex: primaryColor, usage: 'Primary brand color' },
            { role: 'secondary', name: 'Secondary', hex: secondaryColor, usage: 'Secondary brand color' },
            { role: 'accent', name: 'Accent', hex: accentColor, usage: 'Accent and calls to action' },
          ],
        },
        typography: {
          roles: [
            ...(headlineFont ? [{ role: 'headline', family: headlineFont, weights: [700], usage: 'Headlines', assetId: headlineAsset?.assetId }] : []),
            ...(bodyFont ? [{ role: 'body', family: bodyFont, weights: [400], usage: 'Body copy', assetId: bodyAsset?.assetId }] : []),
          ],
        },
        positioning: {
          voice: {
            principles: voiceRules.split('\n').map(value => value.trim()).filter(Boolean),
            do: voiceRules.split('\n').map(value => value.trim()).filter(Boolean),
            dont: prohibitedUsage.split('\n').map(value => value.trim()).filter(Boolean),
          },
        },
      }
      const previewInput = { propertyId, sourceType, ...(websiteUrl ? { websiteUrl } : {}), ...(sourceIds.length ? { sourceIds } : {}), manual }
      const idempotencyKey = JSON.parse(brandRequest(requestMemory, 'preview', previewInput)).requestId
      const response = await fetch('/api/brandforge/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...previewInput, idempotencyKey }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Brand import preview failed')
      openPreview(result.preview)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Brand import preview failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmPreview() {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const contract = reviewContract
      const response = await fetch('/api/brandforge/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: brandRequest(requestMemory, 'import', { propertyId, importId: preview.id, contract, resolutions }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Brand approval failed')
      onComplete(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Brand approval failed')
    } finally {
      setBusy(false)
    }
  }

  if (preview) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <h3 className="font-semibold text-white">Review imported brand</h3>
          <p className="mt-1 text-sm text-slate-300">
            {preview.conflicts?.length || 0} source difference(s) found. Your entered values are selected first. Review each choice before approval.
          </p>
        </div>
        {preview.conflicts?.map(conflict => conflict.field && (
          <fieldset key={conflict.field} className="rounded-xl border border-amber-500/30 p-4">
            <legend className="px-2 font-medium capitalize text-amber-200">Choose {conflict.field} source</legend>
            <div className="grid gap-3 sm:grid-cols-2">{(conflict.candidates || []).map((candidate,index) => <label key={index} className="flex cursor-pointer gap-3 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">
              <input type="radio" name={`source-${conflict.field}`} checked={JSON.stringify(resolutions[conflict.field!]) === JSON.stringify(candidate.value)} onChange={() => setResolutions(current => ({...current,[conflict.field!]:candidate.value}))} />
              <span><strong className="block text-white">{sourceName(candidate.source)}</strong><span>{sourceSummary(candidate.value)}</span></span>
            </label>)}</div>
          </fieldset>
        ))}
        <p className="text-sm text-slate-400">Review and edit the saved brand below. Approval saves these choices; publishing to assistant knowledge is a separate step.</p>
        <ImportedBrandReview contract={{...reviewContract,...resolutions}} onChange={(key,value) => {
          setReviewContract(current => ({...current,[key]:value}))
          if (preview.conflicts.some(conflict => conflict.field === key)) setResolutions(current => ({...current,[key]:value}))
        }} />
        <button type="button" disabled={busy} onClick={() => { setPreview(null); requestMemory.current.delete('preview'); setError(null) }} className="text-sm text-indigo-300">Change source materials</button>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="button"
          onClick={confirmPreview}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Approve existing brand
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {savedPreviews.length > 0 && <section className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
        <h2 className="font-semibold text-white">Saved import reviews</h2><p className="mt-1 text-sm text-slate-300">Resume an extracted preview without uploading the sources again. Unsaved field edits are not included.</p>
        <div className="mt-3 flex flex-wrap gap-3">{savedPreviews.map((saved,index) => <button key={saved.id} disabled={busy} type="button" onClick={() => openPreview(saved)} className="rounded-lg border border-indigo-400/40 px-3 py-2 text-sm text-indigo-200">Resume saved review {index + 1}</button>)}</div>
      </section>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-slate-300">
          Existing website
          <input value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} type="url" className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" placeholder="https://example.com" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Exact brand name
          <input value={brandName} onChange={event => setBrandName(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Headline font
          <input value={headlineFont} onChange={event => setHeadlineFont(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Body font
          <input value={bodyFont} onChange={event => setBodyFont(event.target.value)} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Primary color
          <input value={primaryColor} onChange={event => setPrimaryColor(event.target.value)} type="color" className="h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Secondary color
          <input value={secondaryColor} onChange={event => setSecondaryColor(event.target.value)} type="color" className="h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Accent color
          <input value={accentColor} onChange={event => setAccentColor(event.target.value)} type="color" className="h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-2" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Primary logo
          <input onChange={event => { setLogoFile(event.target.files?.[0] || null); setRightsConfirmed(false) }} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Secondary logo
          <input onChange={event => { setSecondaryLogoFile(event.target.files?.[0] || null); setRightsConfirmed(false) }} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Favicon
          <input onChange={event => { setFaviconFile(event.target.files?.[0] || null); setRightsConfirmed(false) }} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Licensed headline font (WOFF2)
          <input onChange={event => { setHeadlineFontFile(event.target.files?.[0] || null); setRightsConfirmed(false) }} type="file" accept=".woff2" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Licensed body font (WOFF2)
          <input onChange={event => { setBodyFontFile(event.target.files?.[0] || null); setRightsConfirmed(false) }} type="file" accept=".woff2" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300 sm:col-span-2">
          Voice rules (one per line)
          <textarea value={voiceRules} onChange={event => setVoiceRules(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
        </label>
        <label className="space-y-1 text-sm text-slate-300 sm:col-span-2">
          Prohibited usage (one per line)
          <textarea value={prohibitedUsage} onChange={event => setProhibitedUsage(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
        </label>
      </div>
      <label className="block rounded-xl border-2 border-dashed border-slate-600 p-5 text-center text-sm text-slate-400">
        <Upload className="mx-auto mb-2 h-5 w-5" />
        Brand package PDFs, TXT, or Markdown
        <input onChange={event => setPackageFiles(Array.from(event.target.files || []))} type="file" multiple accept=".pdf,.txt,.md" className="mt-3 block w-full text-xs" />
      </label>
      <p className="text-sm text-slate-400">Package text stays in this brand review until you approve and publish the brand to assistant knowledge.</p>
      {hasAssets && <label className="flex items-start gap-3 rounded-lg border border-slate-600 p-3 text-sm text-slate-300">
        <input type="checkbox" checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)} />
        I confirm that the uploaded logos belong to this property and that uploaded fonts are licensed for its use. Approve these asset rights when preparing the preview.
      </label>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={createPreview}
        disabled={busy || (hasAssets && !rightsConfirmed) || (!websiteUrl && !packageFiles.length && !brandName)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Extract and review brand
      </button>
    </div>
  )
}
