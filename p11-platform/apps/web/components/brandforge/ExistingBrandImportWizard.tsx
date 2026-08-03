'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'

type ImportPreview = {
  id: string
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
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [contractJson, setContractJson] = useState('')
  const [resolutions, setResolutions] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sourceType = useMemo(() => {
    const count = Number(Boolean(websiteUrl)) + Number(packageFiles.length > 0) + Number(Boolean(brandName || logoFile))
    if (count > 1) return 'hybrid'
    if (websiteUrl) return 'website'
    if (packageFiles.length) return 'package'
    return 'manual'
  }, [websiteUrl, packageFiles.length, brandName, logoFile])

  async function uploadPackageFiles(): Promise<string[]> {
    const documentIds: string[] = []
    for (const file of packageFiles) {
      const body = new FormData()
      body.append('file', file)
      body.append('propertyId', propertyId)
      body.append('title', file.name.replace(/\.[^/.]+$/, ''))
      const response = await fetch('/api/documents/upload', { method: 'POST', body })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Failed to upload ${file.name}`)
      documentIds.push(...(Array.isArray(result.documentIds) ? result.documentIds : []))
    }
    return documentIds
  }

  async function uploadBrandAsset(
    file: File | null,
    role: 'primary_logo' | 'secondary_logo' | 'favicon' | 'font',
    rightsStatus: 'owned' | 'licensed',
  ) {
    if (!file) return null
    const body = new FormData()
    body.append('file', file)
    body.append('propertyId', propertyId)
    body.append('role', role)
    body.append('rightsStatus', rightsStatus)
    body.append('altText', role === 'font' ? file.name : `${brandName || 'Property'} ${role.replace('_', ' ')}`)
    const response = await fetch('/api/brandforge/content-assets', { method: 'POST', body })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || `${role} upload failed`)
    const asset = result.asset as { id: string; file_url: string }
    const review = await fetch('/api/brandforge/content-assets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        assetId: asset.id,
        approvalStatus: 'approved',
        rightsStatus,
        rightsMetadata: { operatorConfirmed: true, licenseConfirmed: rightsStatus === 'licensed' },
        altText: role === 'font' ? file.name : `${brandName || 'Property'} ${role.replace('_', ' ')}`,
      }),
    })
    const reviewResult = await review.json()
    if (!review.ok) throw new Error(reviewResult.error || `${role} approval failed`)
    return { assetId: asset.id, url: asset.file_url }
  }

  async function createPreview() {
    setBusy(true)
    setError(null)
    try {
      const [documentIds, logo, secondaryLogo, favicon, headlineAsset, bodyAsset] = await Promise.all([
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
      const response = await fetch('/api/brandforge/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          sourceType,
          idempotencyKey: crypto.randomUUID(),
          ...(websiteUrl ? { websiteUrl } : {}),
          ...(documentIds.length ? { documentIds } : {}),
          manual,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Brand import preview failed')
      setPreview(result.preview)
      setContractJson(JSON.stringify(result.preview.extracted_contract, null, 2))
      setResolutions(Object.fromEntries(
        (result.preview.conflicts || []).flatMap((conflict: ImportPreview['conflicts'][number]) => {
          const preferred = conflict.candidates?.find(candidate => candidate.source === 'manual')
            || conflict.candidates?.[0]
          return conflict.field && preferred ? [[conflict.field, preferred.value]] : []
        })
      ))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Brand import preview failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmPreview() {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const contract = JSON.parse(contractJson) as Record<string, unknown>
      const response = await fetch('/api/brandforge/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          importId: preview.id,
          contract,
          resolutions,
        }),
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
            {preview.conflicts?.length || 0} source conflict(s) found. Manual values are selected by default; approval records the resolution.
          </p>
        </div>
        {preview.conflicts?.map(conflict => conflict.field && (
          <label key={conflict.field} className="block space-y-1 text-sm text-slate-300">
            Resolve {conflict.field}
            <select
              className="w-full rounded-lg border border-amber-500/40 bg-slate-900 px-3 py-2 text-white"
              value={JSON.stringify(resolutions[conflict.field])}
              onChange={event => setResolutions(current => ({
                ...current,
                [conflict.field!]: JSON.parse(event.target.value),
              }))}
            >
              {(conflict.candidates || []).map((candidate, index) => (
                <option key={`${candidate.source || 'source'}-${index}`} value={JSON.stringify(candidate.value)}>
                  {candidate.source || 'source'}: {JSON.stringify(candidate.value)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="block space-y-1 text-sm text-slate-300">
          Canonical contract JSON
          <textarea
            value={contractJson}
            onChange={event => setContractJson(event.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-300"
          />
        </label>
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
          <input onChange={event => setLogoFile(event.target.files?.[0] || null)} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Secondary logo
          <input onChange={event => setSecondaryLogoFile(event.target.files?.[0] || null)} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Favicon
          <input onChange={event => setFaviconFile(event.target.files?.[0] || null)} type="file" accept=".svg,.png,.jpg,.jpeg,.webp" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Licensed headline font (WOFF2)
          <input onChange={event => setHeadlineFontFile(event.target.files?.[0] || null)} type="file" accept=".woff2" className="w-full text-xs text-slate-400" />
        </label>
        <label className="space-y-1 text-sm text-slate-300">
          Licensed body font (WOFF2)
          <input onChange={event => setBodyFontFile(event.target.files?.[0] || null)} type="file" accept=".woff2" className="w-full text-xs text-slate-400" />
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
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={createPreview}
        disabled={busy || (!websiteUrl && !packageFiles.length && !brandName)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Extract and review brand
      </button>
    </div>
  )
}
