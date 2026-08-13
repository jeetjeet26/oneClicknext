'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'

type AssetRole =
  | 'hero'
  | 'amenity'
  | 'gallery'
  | 'interior'
  | 'exterior'
  | 'lifestyle'
  | 'neighborhood'
  | 'floorplan'

type CurationStatus =
  | 'raw'
  | 'needs_review'
  | 'approved'
  | 'selected'
  | 'rejected'
  | 'generated'
  | 'in_use'

type RightsStatus =
  | 'unknown'
  | 'owned'
  | 'licensed'
  | 'generated'
  | 'restricted'

type RoomAsset = {
  id: string
  url: string
  thumbnailUrl?: string | null
  filename: string
  category: AssetRole | null
  altText?: string | null
  curationStatus: CurationStatus
  approvalStatus: 'pending' | 'approved' | 'rejected'
  rightsStatus: RightsStatus
  expiresAt?: string | null
  sourceIdentity?: string | null
  contentHash?: string | null
  duplicateOf?: string | null
  focalPoint?: { x?: number; y?: number } | null
  cropSuggestion?: { aspectRatio?: string } | null
  qualityScore?: number | null
  heroRank?: number | null
  usageManifest?: unknown[]
  analyzedAt?: string | null
  usable: boolean
  blockers: string[]
}

type Coverage = {
  matrix: Array<{
    role: AssetRole
    label: string
    required: number
    usable: number
    selected: number
    missing: number
    covered: boolean
  }>
  missingShots: Array<{
    role: AssetRole
    label: string
    missing: number
    instruction: string
  }>
  ready: boolean
}

type AssetSource = {
  id: string
  provider: 'google_drive' | 'dropbox'
  status: 'active' | 'paused' | 'revoked' | 'error'
  externalFolderId: string
  externalFolderName?: string | null
  hasCredential: boolean
  lastSyncedAt?: string | null
  lastError?: string | null
}

type AssetUpdate = {
  assetId: string
  curationStatus?: CurationStatus
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rightsStatus?: RightsStatus
  rightsMetadata?: Record<string, unknown>
  expiresAt?: string | null
  altText?: string | null
  focalPoint?: { x: number; y: number } | null
  assetRole?: AssetRole
  heroRank?: number | null
  rejectionReason?: string | null
}

const roles: Array<{ value: AssetRole; label: string }> = [
  { value: 'hero', label: 'Hero' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' },
  { value: 'amenity', label: 'Amenity' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'neighborhood', label: 'Neighborhood' },
  { value: 'gallery', label: 'Gallery' },
]

const curationFilters: Array<'all' | CurationStatus> = [
  'all',
  'raw',
  'needs_review',
  'approved',
  'selected',
  'rejected',
  'generated',
  'in_use',
]

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  return body && typeof body.error === 'string' ? body.error : fallback
}

export function SiteForgeAssetRoom({
  propertyId,
  onUsablePhotoCountChange,
}: {
  propertyId: string
  onUsablePhotoCountChange?: (count: number) => void
}) {
  const [assets, setAssets] = useState<RoomAsset[]>([])
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [sources, setSources] = useState<AssetSource[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState<'all' | CurationStatus>('all')
  const [uploadRole, setUploadRole] = useState<AssetRole>('hero')
  const [bulkRights, setBulkRights] = useState<RightsStatus>('owned')
  const [rejectionReason, setRejectionReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sourceProvider, setSourceProvider] = useState<
    'google_drive' | 'dropbox'
  >('google_drive')
  const [sourceFolder, setSourceFolder] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [credentialRef, setCredentialRef] = useState('')

  const loadRoom = useCallback(async () => {
    const query = `propertyId=${encodeURIComponent(propertyId)}`
    const [assetResponse, sourceResponse] = await Promise.all([
      fetch(`/api/siteforge/assets?${query}`),
      fetch(`/api/siteforge/assets/sources?${query}`),
    ])
    if (!assetResponse.ok) {
      throw new Error(await responseError(assetResponse, 'Could not load assets'))
    }
    if (!sourceResponse.ok) {
      throw new Error(
        await responseError(sourceResponse, 'Could not load asset sources')
      )
    }
    const [assetBody, sourceBody] = await Promise.all([
      assetResponse.json(),
      sourceResponse.json(),
    ])
    const nextAssets = Array.isArray(assetBody.assets)
      ? (assetBody.assets as RoomAsset[])
      : []
    setAssets(nextAssets)
    setCoverage((assetBody.coverage as Coverage) || null)
    setSources(
      Array.isArray(sourceBody.sources)
        ? (sourceBody.sources as AssetSource[])
        : []
    )
    setSelected((current) => {
      const visibleIds = new Set(nextAssets.map((asset) => asset.id))
      return new Set([...current].filter((id) => visibleIds.has(id)))
    })
    onUsablePhotoCountChange?.(
      nextAssets.filter(
        (asset) => asset.category !== 'floorplan' && asset.usable
      ).length
    )
  }, [onUsablePhotoCountChange, propertyId])

  useEffect(() => {
    void loadRoom().catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Could not load assets')
    })
  }, [loadRoom])

  const visibleAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset.category !== 'floorplan' &&
          (filter === 'all' || asset.curationStatus === filter)
      ),
    [assets, filter]
  )

  async function patchAssets(updates: AssetUpdate[], success: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/siteforge/assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, updates }),
      })
      if (!response.ok) {
        throw new Error(await responseError(response, 'Asset update failed'))
      }
      setNotice(success)
      setSelected(new Set())
      await loadRoom()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Asset update failed')
    } finally {
      setBusy(false)
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError('')
    setNotice('')
    let uploaded = 0
    let duplicates = 0
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.set('propertyId', propertyId)
        form.set('category', uploadRole)
        form.set('file', file)
        const response = await fetch('/api/siteforge/assets', {
          method: 'POST',
          body: form,
        })
        if (!response.ok) {
          throw new Error(await responseError(response, `Could not upload ${file.name}`))
        }
        const body = await response.json()
        if (body.duplicate) duplicates += 1
        else uploaded += 1
      }
      setNotice(
        `${uploaded} image${uploaded === 1 ? '' : 's'} added for review${
          duplicates ? `; ${duplicates} duplicate${duplicates === 1 ? '' : 's'} reused` : ''
        }.`
      )
      await loadRoom()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Image upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function analyzeAsset(assetId: string) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/siteforge/assets/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, assetId }),
      })
      if (!response.ok) {
        throw new Error(await responseError(response, 'Image analysis failed'))
      }
      const body = await response.json()
      setNotice(
        body.analysis?.mode === 'visual_ai'
          ? 'Visual analysis completed.'
          : 'AI was unavailable; deterministic file metadata was recorded without visual claims.'
      )
      await loadRoom()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Image analysis failed')
    } finally {
      setBusy(false)
    }
  }

  async function createSource() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/siteforge/assets/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          provider: sourceProvider,
          externalFolderId: sourceFolder,
          externalFolderName: sourceName || null,
          credentialRef,
        }),
      })
      if (!response.ok) {
        throw new Error(await responseError(response, 'Could not add source'))
      }
      setSourceFolder('')
      setSourceName('')
      setCredentialRef('')
      setNotice('Read-only folder source added.')
      await loadRoom()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add source')
    } finally {
      setBusy(false)
    }
  }

  async function syncSource(source: AssetSource) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        `/api/siteforge/assets/sources/${source.id}/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId }),
        }
      )
      if (!response.ok) {
        throw new Error(await responseError(response, 'Source sync failed'))
      }
      const body = await response.json()
      setNotice(
        `Source sync imported ${body.run?.imported_count || 0} and found ${body.run?.duplicate_count || 0} duplicate images.`
      )
      await loadRoom()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Source sync failed')
      await loadRoom().catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  async function revokeSource(source: AssetSource) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        `/api/siteforge/assets/sources/${source.id}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId }),
        }
      )
      if (!response.ok) {
        throw new Error(await responseError(response, 'Could not revoke source'))
      }
      setNotice('Source revoked and its credential reference removed.')
      await loadRoom()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke source')
    } finally {
      setBusy(false)
    }
  }

  const selectedIds = [...selected]
  const selectedAssets = assets.filter((asset) => selected.has(asset.id))

  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">SiteForge asset room</h3>
          <p className="mt-1 max-w-3xl text-xs text-gray-500">
            Ingest, inspect, clear rights, rank, and select the photography that
            SiteForge may use. An image is usable only after rights clearance
            and approval.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs ${
            coverage?.ready
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-800'
          }`}
        >
          {coverage?.ready ? 'Coverage ready' : 'Shots missing'}
        </span>
      </div>

      {coverage ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Coverage matrix
          </h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {coverage.matrix.map((entry) => (
              <div key={entry.role} className="rounded-md border px-3 py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{entry.label}</span>
                  <span className={entry.covered ? 'text-emerald-700' : 'text-amber-700'}>
                    {entry.usable}/{entry.required}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  {entry.selected} selected · {entry.missing} missing
                </div>
              </div>
            ))}
          </div>
          {coverage.missingShots.length > 0 ? (
            <ul className="rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {coverage.missingShots.map((shot) => (
                <li key={shot.role}>□ {shot.instruction}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-md bg-gray-50 p-3 dark:bg-gray-900 sm:grid-cols-[160px_1fr]">
        <select
          value={uploadRole}
          onChange={(event) => setUploadRole(event.target.value as AssetRole)}
          className="h-10 rounded-md border bg-background px-3 text-sm"
          aria-label="Upload image role"
        >
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
        <label className="flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-dashed bg-background px-3 text-sm">
          {busy ? 'Working…' : 'Choose or drop images'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              void uploadFiles(event.target.files)
              event.currentTarget.value = ''
            }}
          />
        </label>
      </div>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Drive and Dropbox folder sources
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">
            Use a tenant-bound env or Supabase Vault reference. Never paste an
            access token. Imports are read-only and provider failures stop
            checkpoint advancement.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <select
              value={sourceProvider}
              onChange={(event) =>
                setSourceProvider(
                  event.target.value as 'google_drive' | 'dropbox'
                )
              }
              className="h-9 rounded-md border bg-background px-2 text-xs"
              aria-label="Asset source provider"
            >
              <option value="google_drive">Google Drive</option>
              <option value="dropbox">Dropbox</option>
            </select>
            <input
              value={sourceFolder}
              onChange={(event) => setSourceFolder(event.target.value)}
              placeholder={sourceProvider === 'google_drive' ? 'Folder ID' : '/folder/path'}
              className="h-9 rounded-md border bg-background px-2 text-xs"
              aria-label="Provider folder"
            />
            <input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder="Folder label (optional)"
              className="h-9 rounded-md border bg-background px-2 text-xs"
              aria-label="Folder label"
            />
            <input
              type="password"
              autoComplete="off"
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
              placeholder="env:… or supabase-vault:…"
              className="h-9 rounded-md border bg-background px-2 text-xs"
              aria-label="Opaque credential reference"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !sourceFolder || !credentialRef}
            onClick={() => void createSource()}
          >
            Add read-only source
          </Button>
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <div>
                <span className="font-medium">
                  {source.externalFolderName || source.externalFolderId}
                </span>
                <span className="ml-2 capitalize text-gray-500">
                  {source.provider.replace('_', ' ')} · {source.status}
                </span>
                {source.lastError ? (
                  <div className="mt-1 text-red-600">{source.lastError}</div>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    source.status === 'paused' ||
                    source.status === 'revoked'
                  }
                  onClick={() => void syncSource(source)}
                >
                  {source.status === 'error' ? 'Retry' : 'Sync'}
                </Button>
                {source.status !== 'revoked' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void revokeSource(source)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter}
          onChange={(event) =>
            setFilter(event.target.value as 'all' | CurationStatus)
          }
          className="h-9 rounded-md border bg-background px-2 text-xs"
          aria-label="Curation status filter"
        >
          {curationFilters.map((status) => (
            <option key={status} value={status}>
              {status.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select
          value={bulkRights}
          onChange={(event) =>
            setBulkRights(event.target.value as RightsStatus)
          }
          className="h-9 rounded-md border bg-background px-2 text-xs"
          aria-label="Rights status for approval"
        >
          <option value="owned">Owned</option>
          <option value="licensed">Licensed</option>
          <option value="generated">Generated</option>
        </select>
        <Button
          type="button"
          size="sm"
          disabled={busy || selectedIds.length === 0}
          onClick={() =>
            void patchAssets(
              selectedIds.map((assetId) => ({
                assetId,
                rightsStatus: bulkRights,
                rightsMetadata: { operatorConfirmed: true },
                approvalStatus: 'approved',
                curationStatus: 'approved',
              })),
              'Selected assets approved with rights clearance.'
            )
          }
        >
          Approve batch
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            busy ||
            selectedIds.length === 0 ||
            selectedAssets.some((asset) => !asset.usable)
          }
          onClick={() =>
            void patchAssets(
              selectedIds.map((assetId) => ({
                assetId,
                curationStatus: 'selected',
              })),
              'Assets selected for production.'
            )
          }
        >
          Select for production
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            busy ||
            selectedIds.length === 0 ||
            selectedAssets.some((asset) => asset.category !== 'hero')
          }
          onClick={() =>
            void patchAssets(
              selectedIds.map((assetId, index) => ({
                assetId,
                heroRank: index + 1,
              })),
              'Hero ranking saved.'
            )
          }
        >
          Rank selected heroes
        </Button>
        <input
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
          placeholder="Batch rejection reason"
          className="h-9 min-w-48 rounded-md border bg-background px-2 text-xs"
          aria-label="Batch rejection reason"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            busy || selectedIds.length === 0 || !rejectionReason.trim()
          }
          onClick={() =>
            void patchAssets(
              selectedIds.map((assetId) => ({
                assetId,
                curationStatus: 'rejected',
                approvalStatus: 'rejected',
                rejectionReason: rejectionReason.trim(),
              })),
              'Assets rejected.'
            )
          }
        >
          Reject batch
        </Button>
      </div>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      {visibleAssets.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleAssets.map((asset) => (
            <AssetCard
              key={`${asset.id}:${asset.curationStatus}:${asset.rightsStatus}:${asset.altText || ''}:${asset.heroRank || ''}:${asset.analyzedAt || ''}`}
              asset={asset}
              checked={selected.has(asset.id)}
              disabled={busy}
              onChecked={(checked) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (checked) next.add(asset.id)
                  else next.delete(asset.id)
                  return next
                })
              }
              onAnalyze={() => void analyzeAsset(asset.id)}
              onSave={(patch) =>
                void patchAssets(
                  [{ assetId: asset.id, ...patch }],
                  'Asset metadata saved.'
                )
              }
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md bg-gray-50 px-3 py-6 text-center text-xs text-gray-500 dark:bg-gray-900">
          No assets match this view.
        </div>
      )}
    </section>
  )
}

function AssetCard({
  asset,
  checked,
  disabled,
  onChecked,
  onAnalyze,
  onSave,
}: {
  asset: RoomAsset
  checked: boolean
  disabled: boolean
  onChecked: (checked: boolean) => void
  onAnalyze: () => void
  onSave: (patch: Omit<AssetUpdate, 'assetId'>) => void
}) {
  const [altText, setAltText] = useState(asset.altText || '')
  const [role, setRole] = useState<AssetRole>(asset.category || 'gallery')
  const [rights, setRights] = useState<RightsStatus>(asset.rightsStatus)
  const [expiresAt, setExpiresAt] = useState(
    asset.expiresAt?.slice(0, 10) || ''
  )
  const [focalX, setFocalX] = useState(
    asset.focalPoint?.x?.toString() || '0.5'
  )
  const [focalY, setFocalY] = useState(
    asset.focalPoint?.y?.toString() || '0.5'
  )
  const [heroRank, setHeroRank] = useState(asset.heroRank?.toString() || '')

  return (
    <article className="overflow-hidden rounded-md border">
      <div className="relative aspect-[4/3] bg-gray-100 dark:bg-gray-900">
        <Image
          src={asset.thumbnailUrl || asset.url}
          alt={asset.altText || ''}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover"
        />
        <label className="absolute left-2 top-2 rounded bg-background/90 p-1">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChecked(event.target.checked)}
            aria-label={`Select ${asset.filename}`}
          />
        </label>
        <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 text-[10px] font-medium">
          {asset.curationStatus.replace('_', ' ')}
        </span>
      </div>
      <div className="space-y-3 p-3 text-xs">
        <div>
          <div className="truncate font-medium">{asset.filename}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
            <span className={asset.usable ? 'text-emerald-700' : 'text-amber-700'}>
              {asset.usable ? 'Usable' : asset.blockers.join(' · ')}
            </span>
            {asset.duplicateOf ? <span>· duplicate</span> : null}
            {asset.qualityScore != null ? (
              <span>· quality {Math.round(asset.qualityScore * 100)}%</span>
            ) : null}
            {asset.cropSuggestion?.aspectRatio ? (
              <span>· crop {asset.cropSuggestion.aspectRatio}</span>
            ) : null}
            {asset.usageManifest?.length ? (
              <span>· used {asset.usageManifest.length}×</span>
            ) : null}
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-gray-500">Alt text</span>
          <input
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            maxLength={300}
            className="h-9 w-full rounded-md border bg-background px-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-gray-500">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as AssetRole)}
              className="h-9 w-full rounded-md border bg-background px-2"
            >
              {roles.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-500">Rights</span>
            <select
              value={rights}
              onChange={(event) =>
                setRights(event.target.value as RightsStatus)
              }
              className="h-9 w-full rounded-md border bg-background px-2"
            >
              <option value="unknown">Unknown</option>
              <option value="owned">Owned</option>
              <option value="licensed">Licensed</option>
              <option value="generated">Generated</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-500">Rights expiry</span>
            <input
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-500">Hero rank</span>
            <input
              type="number"
              min="1"
              value={heroRank}
              onChange={(event) => setHeroRank(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-500">Focal X</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={focalX}
              onChange={(event) => setFocalX(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-500">Focal Y</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={focalY}
              onChange={(event) => setFocalY(event.target.value)}
              className="h-9 w-full rounded-md border bg-background px-2"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onSave({
                altText: altText.trim() || null,
                assetRole: role,
                rightsStatus: rights,
                expiresAt: expiresAt
                  ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString()
                  : null,
                focalPoint: {
                  x: Number(focalX),
                  y: Number(focalY),
                },
                heroRank: heroRank ? Number(heroRank) : null,
              })
            }
          >
            Save metadata
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={onAnalyze}
          >
            Analyze image
          </Button>
        </div>
      </div>
    </article>
  )
}
