'use client'

import Image from 'next/image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { partitionUploadResults } from './orchestration'

type AssetCategory =
  | 'hero'
  | 'amenity'
  | 'gallery'
  | 'interior'
  | 'exterior'
  | 'lifestyle'
  | 'neighborhood'
  | 'floorplan'

type PropertyAsset = {
  id: string
  url: string
  filename: string
  fileSize?: number
  mimeType?: string
  category: AssetCategory
  altText?: string
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  rightsStatus?: 'unknown' | 'owned' | 'licensed' | 'generated' | 'restricted'
  createdAt?: string
}

type FloorPlanDraft = {
  id: string
  name: string
  bedrooms: string
  bathrooms: string
  sqftMin: string
  sqftMax: string
  rentMin: string
  rentMax: string
  availableCount: string
  specials: string
  imageUrl: string
  imageAssetId: string
  imageAlt: string
  availabilityUrl: string
  applyUrl: string
}

type NormalizedFloorPlan = {
  unit_type: string
  bedrooms: number
  bathrooms?: number
  sqft_min?: number
  sqft_max?: number
  rent_min?: number
  rent_max?: number
  available_count?: number
  floor_plan_image_url?: string
}

type FloorPlanPreview = {
  importId: string
  rows: NormalizedFloorPlan[]
  errors: Array<{ row: number; field?: string; message: string }>
  canConfirm: boolean
}

const photoCategories: Array<{ value: AssetCategory; label: string }> = [
  { value: 'hero', label: 'Hero / exterior' },
  { value: 'amenity', label: 'Amenities' },
  { value: 'interior', label: 'Apartment interiors' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'neighborhood', label: 'Neighborhood' },
  { value: 'exterior', label: 'Building exterior' },
]

function emptyFloorPlan(): FloorPlanDraft {
  return {
    id: crypto.randomUUID(),
    name: '',
    bedrooms: '',
    bathrooms: '',
    sqftMin: '',
    sqftMax: '',
    rentMin: '',
    rentMax: '',
    availableCount: '',
    specials: '',
    imageUrl: '',
    imageAssetId: '',
    imageAlt: '',
    availabilityUrl: '',
    applyUrl: '',
  }
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  return body && typeof body.error === 'string' ? body.error : fallback
}

export function PropertyAssetsStep({
  propertyId,
  onPhotoCountChange,
}: {
  propertyId: string
  onPhotoCountChange?: (count: number) => void
}) {
  const [assets, setAssets] = useState<PropertyAsset[]>([])
  const [category, setCategory] = useState<AssetCategory>('hero')
  const [uploading, setUploading] = useState(false)
  const [assetError, setAssetError] = useState('')
  const [floorPlanMode, setFloorPlanMode] = useState<'manual' | 'csv'>('manual')
  const [floorPlans, setFloorPlans] = useState<FloorPlanDraft[]>([
    emptyFloorPlan(),
  ])
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<FloorPlanPreview | null>(null)
  const [floorPlanError, setFloorPlanError] = useState('')
  const [floorPlanStatus, setFloorPlanStatus] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const photoAssets = useMemo(
    () => assets.filter((asset) => asset.category !== 'floorplan'),
    [assets]
  )
  const approvedPhotoCount = useMemo(
    () =>
      photoAssets.filter((asset) => asset.approvalStatus === 'approved').length,
    [photoAssets]
  )

  const loadAssets = useCallback(async () => {
    const response = await fetch(
      `/api/siteforge/assets?propertyId=${encodeURIComponent(propertyId)}`
    )
    if (!response.ok) {
      throw new Error(await responseError(response, 'Could not load assets'))
    }
    const body = await response.json()
    const nextAssets = Array.isArray(body.assets)
      ? (body.assets as PropertyAsset[])
      : []
    setAssets(nextAssets)
    onPhotoCountChange?.(
      nextAssets.filter(
        (asset) =>
          asset.category !== 'floorplan' && asset.approvalStatus === 'approved'
      ).length
    )
  }, [onPhotoCountChange, propertyId])

  useEffect(() => {
    void loadAssets().catch((error) => {
      setAssetError(
        error instanceof Error ? error.message : 'Could not load property assets'
      )
    })
  }, [loadAssets])

  async function uploadAsset(
    file: File,
    assetCategory: AssetCategory,
    altText?: string
  ): Promise<PropertyAsset> {
    const formData = new FormData()
    formData.set('propertyId', propertyId)
    formData.set('category', assetCategory)
    formData.set('file', file)
    if (altText?.trim()) formData.set('altText', altText.trim())
    const response = await fetch('/api/siteforge/assets', {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      throw new Error(await responseError(response, 'Image upload failed'))
    }
    const body = await response.json()
    return body.asset as PropertyAsset
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    setAssetError('')
    try {
      const selectedFiles = Array.from(files)
      const results = await Promise.allSettled(
        selectedFiles.map((file) => uploadAsset(file, category))
      )
      const { succeeded: created, failedNames: failedFiles } =
        partitionUploadResults(selectedFiles, results)
      if (created.length > 0) {
        setAssets((current) => [...created, ...current])
      }
      if (failedFiles.length > 0) {
        setAssetError(
          `${created.length} photo${created.length === 1 ? '' : 's'} uploaded. Could not upload: ${failedFiles.join(', ')}.`
        )
      }
    } catch {
      setAssetError('Image upload failed before any files could be saved')
    } finally {
      setUploading(false)
    }
  }

  async function approveAsset(asset: PropertyAsset) {
    setAssetError('')
    const response = await fetch('/api/siteforge/assets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        updates: [
          {
            assetId: asset.id,
            approvalStatus: 'approved',
            curationStatus: 'approved',
            rightsStatus: 'owned',
            rightsMetadata: { operatorConfirmed: true },
            altText: asset.altText || asset.filename,
          },
        ],
      }),
    })
    if (!response.ok) {
      setAssetError(await responseError(response, 'Could not approve image rights'))
      return
    }
    const nextAssets = assets.map((item) =>
      item.id === asset.id
        ? { ...item, approvalStatus: 'approved' as const, rightsStatus: 'owned' as const }
        : item
    )
    setAssets(nextAssets)
    onPhotoCountChange?.(
      nextAssets.filter(
        (item) =>
          item.category !== 'floorplan' && item.approvalStatus === 'approved'
      ).length
    )
  }

  async function deleteAsset(asset: PropertyAsset) {
    setAssetError('')
    const response = await fetch('/api/siteforge/assets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId, assetId: asset.id }),
    })
    if (!response.ok) {
      setAssetError(await responseError(response, 'Could not remove image'))
      return
    }
    const nextAssets = assets.filter((item) => item.id !== asset.id)
    setAssets(nextAssets)
    onPhotoCountChange?.(
      nextAssets.filter(
        (item) =>
          item.category !== 'floorplan' && item.approvalStatus === 'approved'
      ).length
    )
  }

  function updateFloorPlan(
    id: string,
    field: keyof FloorPlanDraft,
    value: string
  ) {
    setFloorPlans((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    )
    setPreview(null)
    setFloorPlanStatus('')
  }

  async function uploadFloorPlanImage(row: FloorPlanDraft, file?: File) {
    if (!file) return
    setAssetError('')
    setUploading(true)
    try {
      const altText =
        row.imageAlt.trim() ||
        `${row.name.trim() || 'Apartment'} floor plan layout`
      const asset = await uploadAsset(file, 'floorplan', altText)
      setAssets((current) => [asset, ...current])
      setFloorPlans((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                imageUrl: asset.url,
                imageAssetId: asset.id,
                imageAlt: altText,
              }
            : item
        )
      )
    } catch (error) {
      setAssetError(
        error instanceof Error ? error.message : 'Floor-plan image upload failed'
      )
    } finally {
      setUploading(false)
    }
  }

  async function previewFloorPlans() {
    setPreviewing(true)
    setFloorPlanError('')
    setFloorPlanStatus('')
    try {
      let payload: Record<string, unknown>
      if (floorPlanMode === 'csv') {
        if (!csvFile) throw new Error('Choose a CSV file first')
        payload = {
          propertyId,
          sourceType: 'csv',
          sourceIdentity: 'siteforge-csv-upload',
          filename: csvFile.name,
          csv: await csvFile.text(),
        }
      } else {
        const pendingLayout = floorPlans.find(row =>
          row.imageAssetId
          && assets.find(asset => asset.id === row.imageAssetId)?.approvalStatus !== 'approved'
        )
        if (pendingLayout) {
          throw new Error('Approve ownership and rights for each uploaded floor-plan image before previewing')
        }
        payload = {
          propertyId,
          sourceType: 'manual',
          sourceIdentity: 'siteforge-manual-entry',
          rows: floorPlans.map((row) => ({
            name: row.name,
            bedrooms: row.bedrooms,
            bathrooms: row.bathrooms,
            sqftMin: row.sqftMin,
            sqftMax: row.sqftMax,
            rentMin: row.rentMin,
            rentMax: row.rentMax,
            availableCount: row.availableCount,
            specials: row.specials,
            imageUrl: row.imageUrl,
            imageAlt: row.imageAlt,
            availabilityUrl: row.availabilityUrl,
            applyUrl: row.applyUrl,
          })),
        }
      }

      const response = await fetch(
        '/api/siteforge/floor-plans/import/preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!response.ok) {
        throw new Error(
          await responseError(response, 'Floor-plan preview failed')
        )
      }
      setPreview((await response.json()) as FloorPlanPreview)
    } catch (error) {
      setFloorPlanError(
        error instanceof Error ? error.message : 'Floor-plan preview failed'
      )
    } finally {
      setPreviewing(false)
    }
  }

  async function confirmFloorPlans() {
    if (!preview?.canConfirm) return
    setConfirming(true)
    setFloorPlanError('')
    try {
      const response = await fetch(
        '/api/siteforge/floor-plans/import/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId,
            importId: preview.importId,
          }),
        }
      )
      if (!response.ok) {
        throw new Error(
          await responseError(response, 'Floor-plan import failed')
        )
      }
      const body = await response.json()
      setFloorPlanStatus(
        `${body.applied || preview.rows.length} floor plan${
          (body.applied || preview.rows.length) === 1 ? '' : 's'
        } saved for this property.`
      )
      setPreview(null)
    } catch (error) {
      setFloorPlanError(
        error instanceof Error ? error.message : 'Floor-plan import failed'
      )
    } finally {
      setConfirming(false)
    }
  }

  function downloadCsvTemplate() {
    const csv = [
      'name,bedrooms,bathrooms,sqft_min,sqft_max,rent_min,rent_max,available_count,specials,image_url,image_alt,availability_url,apply_url',
      'A1,1,1,650,700,1800,1950,2,,https://example.com/a1.jpg,A1 floor plan layout,,',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'siteforge-floor-plans-template.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="mb-4 min-w-0 space-y-5 rounded-lg border p-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Property assets</h3>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            Optional, but recommended
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Add real photography and floor plans before generation. SiteForge
          will use these instead of placeholders where they fit.
        </p>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-medium">Property photography</h4>
            <p className="text-xs text-gray-500">
              Optional. Add JPG, PNG, or WebP files only when you want SiteForge
              to use real property photography.
            </p>
          </div>
          {approvedPhotoCount > 0 ? (
            <span className="text-xs text-emerald-700">
              {approvedPhotoCount} approved
            </span>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as AssetCategory)
            }
            className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
            aria-label="Photo category"
          >
            {photoCategories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="flex min-h-10 min-w-0 cursor-pointer items-center justify-center rounded-md border border-dashed px-3 text-center text-sm hover:bg-gray-50 dark:hover:bg-gray-900">
            {uploading ? 'Uploading…' : 'Choose property photos'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                void uploadPhotos(event.target.files)
                event.currentTarget.value = ''
              }}
            />
          </label>
        </div>
        {assetError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {assetError}
          </p>
        )}
        {photoAssets.length > 0 ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            {photoAssets.map((asset) => (
              <div
                key={asset.id}
                className="min-w-0 overflow-hidden rounded-md border"
              >
                <div className="relative aspect-[4/3] bg-gray-100 dark:bg-gray-900">
                  <Image
                    src={asset.url}
                    alt={asset.altText || asset.filename}
                    fill
                    unoptimized
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 space-y-1 p-2">
                  <div className="truncate text-xs font-medium">
                    {asset.filename}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] capitalize text-gray-500">
                      {asset.category}
                    </span>
                    <button
                      type="button"
                      onClick={() => void deleteAsset(asset)}
                      className="shrink-0 text-[11px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  {asset.approvalStatus !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => void approveAsset(asset)}
                      className="text-left text-[11px] font-medium text-emerald-700 hover:underline"
                    >
                      Confirm ownership and approve
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md bg-gray-50 px-3 py-4 text-center text-xs text-gray-500 dark:bg-gray-900">
            No property photos added. You can continue without them.
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3 border-t pt-4">
        <div>
          <h4 className="text-sm font-medium">Floor plans</h4>
          <p className="text-xs text-gray-500">
            Required: plan name and bedroom count. Recommended: bathrooms,
            square footage, rent range, availability, a layout image, and
            availability/apply links. Omitted pricing or availability stays
            hidden on the public site.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={floorPlanMode === 'manual' ? 'default' : 'outline'}
            onClick={() => {
              setFloorPlanMode('manual')
              setPreview(null)
            }}
          >
            Enter manually
          </Button>
          <Button
            type="button"
            size="sm"
            variant={floorPlanMode === 'csv' ? 'default' : 'outline'}
            onClick={() => {
              setFloorPlanMode('csv')
              setPreview(null)
            }}
          >
            Import CSV
          </Button>
        </div>

        {floorPlanMode === 'manual' ? (
          <div className="space-y-3">
            {floorPlans.map((row, index) => (
              <div
                key={row.id}
                className="min-w-0 space-y-3 rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    Floor plan {index + 1}
                  </span>
                  {floorPlans.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() =>
                        setFloorPlans((current) =>
                          current.filter((item) => item.id !== row.id)
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-4">
                  <AssetInput
                    label="Plan name *"
                    value={row.name}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'name', value)
                    }
                    className="sm:col-span-2"
                  />
                  <AssetInput
                    label="Bedrooms *"
                    type="number"
                    min="0"
                    value={row.bedrooms}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'bedrooms', value)
                    }
                  />
                  <AssetInput
                    label="Bathrooms"
                    type="number"
                    min="0"
                    step="0.5"
                    value={row.bathrooms}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'bathrooms', value)
                    }
                  />
                  <AssetInput
                    label="Sq. ft. minimum"
                    type="number"
                    min="0"
                    value={row.sqftMin}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'sqftMin', value)
                    }
                  />
                  <AssetInput
                    label="Sq. ft. maximum"
                    type="number"
                    min="0"
                    value={row.sqftMax}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'sqftMax', value)
                    }
                  />
                  <AssetInput
                    label="Rent minimum"
                    type="number"
                    min="0"
                    value={row.rentMin}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'rentMin', value)
                    }
                  />
                  <AssetInput
                    label="Rent maximum"
                    type="number"
                    min="0"
                    value={row.rentMax}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'rentMax', value)
                    }
                  />
                  <AssetInput
                    label="Available homes"
                    type="number"
                    min="0"
                    value={row.availableCount}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'availableCount', value)
                    }
                  />
                  <AssetInput
                    label="Special"
                    value={row.specials}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'specials', value)
                    }
                    className="sm:col-span-3"
                  />
                  <AssetInput
                    label="Availability URL"
                    type="url"
                    value={row.availabilityUrl}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'availabilityUrl', value)
                    }
                    className="sm:col-span-2"
                  />
                  <AssetInput
                    label="Apply URL"
                    type="url"
                    value={row.applyUrl}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'applyUrl', value)
                    }
                    className="sm:col-span-2"
                  />
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <AssetInput
                    label="Floor-plan image alt text"
                    value={row.imageAlt}
                    onChange={(value) =>
                      updateFloorPlan(row.id, 'imageAlt', value)
                    }
                    placeholder={`${row.name || 'Apartment'} floor plan layout`}
                  />
                  <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-xs hover:bg-gray-50 dark:hover:bg-gray-900">
                    {row.imageUrl ? 'Replace layout image' : 'Upload layout image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(event) => {
                        void uploadFloorPlanImage(row, event.target.files?.[0])
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                </div>
                {row.imageAssetId
                  && assets.find(asset => asset.id === row.imageAssetId)?.approvalStatus !== 'approved'
                  && (
                    <button
                      type="button"
                      className="text-xs font-medium text-emerald-700 hover:underline"
                      onClick={() => {
                        const asset = assets.find(item => item.id === row.imageAssetId)
                        if (asset) void approveAsset(asset)
                      }}
                    >
                      Confirm ownership and approve layout image
                    </button>
                  )}
                {row.imageUrl && (
                  <div className="text-xs text-green-700 dark:text-green-400">
                    Layout image attached
                  </div>
                )}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setFloorPlans((current) => [...current, emptyFloorPlan()])
              }
            >
              + Add another floor plan
            </Button>
          </div>
        ) : (
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500">
                Use the template headers so SiteForge can validate every row
                before saving.
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={downloadCsvTemplate}
              >
                Download CSV template
              </Button>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setCsvFile(event.target.files?.[0] || null)
                setPreview(null)
              }}
              className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-xs dark:file:bg-gray-800"
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void previewFloorPlans()}
            disabled={previewing || confirming}
          >
            {previewing ? 'Validating…' : 'Preview floor plans'}
          </Button>
        </div>

        {floorPlanError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {floorPlanError}
          </p>
        )}
        {floorPlanStatus && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-950/40 dark:text-green-300">
            {floorPlanStatus}
          </p>
        )}

        {preview && (
          <div className="space-y-3 rounded-md bg-gray-50 p-3 dark:bg-gray-900">
            <div className="text-xs font-semibold">
              Preview: {preview.rows.length} valid row
              {preview.rows.length === 1 ? '' : 's'}
            </div>
            {preview.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="pb-2">Plan</th>
                      <th className="pb-2">Beds / baths</th>
                      <th className="pb-2">Sq. ft.</th>
                      <th className="pb-2">Rent</th>
                      <th className="pb-2">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={`${row.unit_type}-${row.bedrooms}`}>
                        <td className="border-t py-2 font-medium">
                          {row.unit_type}
                        </td>
                        <td className="border-t py-2">
                          {row.bedrooms} / {row.bathrooms ?? '—'}
                        </td>
                        <td className="border-t py-2">
                          {row.sqft_min ?? '—'}
                          {row.sqft_max && row.sqft_max !== row.sqft_min
                            ? `–${row.sqft_max}`
                            : ''}
                        </td>
                        <td className="border-t py-2">
                          {row.rent_min != null
                            ? `$${row.rent_min.toLocaleString()}`
                            : 'Hidden'}
                        </td>
                        <td className="border-t py-2">
                          {row.available_count ?? 'Hidden'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.errors.map((error) => (
              <div
                key={`${error.row}-${error.field}-${error.message}`}
                className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
              >
                Row {error.row}
                {error.field ? `, ${error.field}` : ''}: {error.message}
              </div>
            ))}
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => void confirmFloorPlans()}
                disabled={!preview.canConfirm || confirming}
              >
                {confirming ? 'Saving…' : 'Confirm and save floor plans'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function AssetInput({
  label,
  value,
  onChange,
  className = '',
  type = 'text',
  min,
  step,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  type?: string
  min?: string
  step?: string
  placeholder?: string
}) {
  return (
    <label className={`space-y-1 text-xs ${className}`}>
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <input
        type={type}
        min={min}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
      />
    </label>
  )
}
