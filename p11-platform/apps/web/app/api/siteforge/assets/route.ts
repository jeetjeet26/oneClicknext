import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import {
  STORAGE_BUCKETS,
  uploadFileAsset,
} from '@/utils/storage/asset-service'
import type { Json, Tables, TablesUpdate } from '@/types/supabase'
import { authorizeAssetProperty } from '@/utils/siteforge/assets/auth'
import {
  assetRoles,
  batchAssetPatchSchema,
} from '@/utils/siteforge/assets/contracts'
import {
  buildCoverageMatrix,
  buildValidatedAssetUpdate,
  getAssetUsability,
} from '@/utils/siteforge/assets/curation'
import { analyzeImageContent } from '@/utils/siteforge/assets/image-analysis'

const propertyIdSchema = z.guid()
const categorySchema = z.enum([
  'hero',
  'amenity',
  'gallery',
  'interior',
  'exterior',
  'lifestyle',
  'neighborhood',
  'floorplan',
])
const deleteSchema = z.object({
  propertyId: z.guid(),
  assetId: z.string().uuid(),
})

const supportedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const maxFileSize = 20 * 1024 * 1024

async function hasSupportedImageSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (file.type === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (file.type === 'image/png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
  }
  if (file.type === 'image/webp') {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    )
  }
  return false
}

function sanitizeMetadata(value: Json): Json {
  if (Array.isArray(value)) return value.map(sanitizeMetadata)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/(?:token|secret|credential|authorization|password)/i.test(key)
        )
        .map(([key, item]) => [key, sanitizeMetadata(item as Json)])
    )
  }
  return value
}

function isSiteForgeAsset(row: Tables<'content_assets'>) {
  return (
    assetRoles.includes(row.asset_role as (typeof assetRoles)[number]) ||
    row.source_identity?.startsWith('siteforge-') ||
    row.source_identity?.startsWith('google_drive:') ||
    row.source_identity?.startsWith('dropbox:')
  )
}

function mapAsset(row: Tables<'content_assets'>) {
  const usability = getAssetUsability(row)
  return {
    id: row.id,
    url: row.file_url,
    thumbnailUrl: row.thumbnail_url,
    filename: row.name,
    description: row.description,
    fileSize: row.file_size_bytes,
    mimeType: row.format,
    width: row.width,
    height: row.height,
    category: row.asset_role,
    altText: row.alt_text,
    approvalStatus: row.approval_status,
    curationStatus: row.curation_status,
    rightsStatus: row.rights_status,
    rightsMetadata: sanitizeMetadata(row.rights_metadata),
    expiresAt: row.expires_at,
    sourceIdentity: row.source_identity,
    sourceMetadata: sanitizeMetadata(row.source_metadata),
    contentHash: row.content_hash,
    duplicateOf: row.duplicate_of,
    focalPoint: row.focal_point,
    cropSuggestion: row.crop_suggestion,
    qualityScore: row.quality_score,
    heroRank: row.hero_rank,
    usageManifest: row.usage_manifest,
    analyzedAt: row.analyzed_at,
    usable: usability.usable,
    blockers: usability.blockers,
    createdAt: row.created_at,
  }
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/assets')
  ctx.logStart()
  try {
    const parsedPropertyId = propertyIdSchema.safeParse(
      request.nextUrl.searchParams.get('propertyId')
    )
    if (!parsedPropertyId.success) {
      return NextResponse.json(
        { error: 'Valid property ID required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const authorization = await authorizeAssetProperty(parsedPropertyId.data)
    if (authorization.status !== 200) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status, headers: ctx.responseHeaders }
      )
    }

    const service = createServiceClient()
    const { data, error } = await service
      .from('content_assets')
      .select('*')
      .eq('property_id', parsedPropertyId.data)
      .eq('asset_type', 'image')
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to load property assets: ${error.message}`)
    }

    const rows = (data || []).filter(isSiteForgeAsset)
    const assets = rows.map(mapAsset)
    const coverage = buildCoverageMatrix(rows)
    ctx.logSuccess(200, { assetCount: assets.length })
    return NextResponse.json(
      { assets, coverage },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to load property assets' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/assets')
  ctx.logStart()
  try {
    const formData = await request.formData()
    const parsedPropertyId = propertyIdSchema.safeParse(
      formData.get('propertyId')
    )
    const parsedCategory = categorySchema.safeParse(formData.get('category'))
    const file = formData.get('file')
    const altTextValue = formData.get('altText')

    if (!parsedPropertyId.success) {
      return NextResponse.json(
        { error: 'Valid property ID required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    if (!parsedCategory.success) {
      return NextResponse.json(
        { error: 'Choose a valid asset category' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Image file required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    if (!supportedImageTypes.has(file.type)) {
      return NextResponse.json(
        { error: 'Use a JPG, PNG, or WebP image' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    if (file.size > maxFileSize) {
      return NextResponse.json(
        { error: 'Each image must be 20MB or smaller' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    if (!(await hasSupportedImageSignature(file))) {
      return NextResponse.json(
        { error: 'The uploaded file does not contain a valid image' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const authorization = await authorizeAssetProperty(parsedPropertyId.data)
    if (authorization.status !== 200) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status, headers: ctx.responseHeaders }
      )
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer())
    const analysis = await analyzeImageContent({
      bytes: fileBytes,
      mediaType: file.type,
      filename: file.name,
      operatorRole: parsedCategory.data,
    })
    const service = createServiceClient()
    const { data: duplicate, error: duplicateError } = await service
      .from('content_assets')
      .select('*')
      .eq('property_id', parsedPropertyId.data)
      .eq('content_hash', analysis.metadata.contentHash)
      .is('duplicate_of', null)
      .maybeSingle()
    if (duplicateError) {
      throw new Error(`Failed to check duplicate asset: ${duplicateError.message}`)
    }
    if (duplicate) {
      ctx.logSuccess(200, { assetId: duplicate.id, duplicate: true })
      return NextResponse.json(
        { asset: mapAsset(duplicate), duplicate: true },
        { status: 200, headers: ctx.responseHeaders }
      )
    }

    const extension =
      file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : 'jpg'
    const category = parsedCategory.data
    const filename = `${crypto.randomUUID()}.${extension}`
    const result = await uploadFileAsset(file, {
      bucket: STORAGE_BUCKETS.PROPERTY_ASSETS,
      propertyId: parsedPropertyId.data,
      folder: `siteforge/${category}`,
      filename,
      contentType: file.type,
      upsert: false,
    })
    if (!result.success || !result.publicUrl || !result.storagePath) {
      throw new Error(result.error || 'Property asset upload failed')
    }

    const operatorAltText =
      typeof altTextValue === 'string' && altTextValue.trim()
        ? altTextValue.trim().slice(0, 300)
        : null
    const altText = operatorAltText || analysis.altText
    const { data: created, error: createError } = await service
      .from('content_assets')
      .insert({
        org_id: authorization.orgId,
        property_id: parsedPropertyId.data,
        name: file.name.slice(0, 255),
        description: null,
        asset_type: 'image',
        asset_role: analysis.suggestedRole || category,
        file_url: result.publicUrl,
        file_size_bytes: result.fileSize ?? file.size,
        width: analysis.metadata.width,
        height: analysis.metadata.height,
        format: file.type,
        storage_bucket: STORAGE_BUCKETS.PROPERTY_ASSETS,
        storage_path: result.storagePath,
        content_hash: analysis.metadata.contentHash,
        source_identity: `siteforge-upload:${file.name}`,
        source_metadata: {
          uploadedAt: new Date().toISOString(),
          analysisMode: analysis.mode,
          observedElements: analysis.observedElements,
          qualityNotes: analysis.qualityNotes,
        },
        rights_status: 'unknown',
        rights_metadata: {},
        approval_status: 'pending',
        curation_status: 'needs_review',
        alt_text: altText,
        focal_point: analysis.focalPoint,
        crop_suggestion: analysis.cropSuggestion,
        quality_score: analysis.qualityScore,
        usage_manifest: [],
        analyzed_at: new Date().toISOString(),
        uploaded_by: authorization.userId,
      })
      .select('*')
      .single()

    if (createError || !created) {
      await service.storage
        .from(STORAGE_BUCKETS.PROPERTY_ASSETS)
        .remove([result.storagePath])
      throw new Error(
        `Failed to persist property asset: ${createError?.message || 'unknown error'}`
      )
    }

    ctx.logSuccess(201, { assetId: created.id, category })
    return NextResponse.json(
      {
        asset: mapAsset(created),
        duplicate: false,
      },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to upload property asset' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/assets')
  ctx.logStart()
  try {
    const parsed = batchAssetPatchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid asset curation batch' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const authorization = await authorizeAssetProperty(parsed.data.propertyId, {
      manager: true,
    })
    if (authorization.status !== 200) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status, headers: ctx.responseHeaders }
      )
    }

    const service = createServiceClient()
    const assetIds = parsed.data.updates.map((update) => update.assetId)
    const { data: currentAssets, error: currentError } = await service
      .from('content_assets')
      .select('*')
      .eq('property_id', parsed.data.propertyId)
      .in('id', assetIds)
    if (currentError) {
      throw new Error(`Failed to load curation batch: ${currentError.message}`)
    }
    if ((currentAssets || []).length !== assetIds.length) {
      return NextResponse.json(
        { error: 'One or more property assets were not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const duplicateIds = [
      ...new Set(
        parsed.data.updates.flatMap((update) =>
          update.duplicateOf ? [update.duplicateOf] : []
        )
      ),
    ]
    if (
      parsed.data.updates.some(
        (update) => update.duplicateOf === update.assetId
      )
    ) {
      return NextResponse.json(
        { error: 'An asset cannot duplicate itself' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    if (duplicateIds.length > 0) {
      const { data: duplicateTargets, error: duplicateTargetError } =
        await service
          .from('content_assets')
          .select('id')
          .eq('property_id', parsed.data.propertyId)
          .in('id', duplicateIds)
      if (duplicateTargetError) {
        throw new Error('Failed to validate duplicate assets')
      }
      if ((duplicateTargets || []).length !== duplicateIds.length) {
        return NextResponse.json(
          { error: 'Duplicate targets must belong to the same property' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
    }

    const currentById = new Map(
      (currentAssets || []).map((asset) => [asset.id, asset])
    )
    const validated: Array<{
      assetId: string
      update: TablesUpdate<'content_assets'>
    }> = []
    try {
      for (const item of parsed.data.updates) {
        const current = currentById.get(item.assetId)
        if (!current) throw new Error('Asset not found')
        const { assetId, ...patch } = item
        validated.push({
          assetId,
          update: buildValidatedAssetUpdate({
            current,
            patch,
            userId: authorization.userId,
          }) as TablesUpdate<'content_assets'>,
        })
      }
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Asset curation update is not allowed',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const updated: Tables<'content_assets'>[] = []
    for (const item of validated) {
      const { data, error } = await service
        .from('content_assets')
        .update(item.update)
        .eq('id', item.assetId)
        .eq('property_id', parsed.data.propertyId)
        .select('*')
        .single()
      if (error || !data) {
        throw new Error(`Failed to update asset ${item.assetId}`)
      }
      updated.push(data)
    }
    ctx.logSuccess(200, { assetCount: updated.length })
    return NextResponse.json(
      { assets: updated.map(mapAsset) },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to update property assets' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/assets')
  ctx.logStart()
  try {
    const parsed = deleteSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid asset deletion request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const authorization = await authorizeAssetProperty(parsed.data.propertyId, {
      manager: true,
    })
    if (authorization.status !== 200) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status, headers: ctx.responseHeaders }
      )
    }

    const service = createServiceClient()
    const { data: asset, error: assetError } = await service
      .from('content_assets')
      .select('id, storage_bucket, storage_path')
      .eq('id', parsed.data.assetId)
      .eq('property_id', parsed.data.propertyId)
      .single()
    if (assetError || !asset) {
      return NextResponse.json(
        { error: 'Property asset not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const { error: deleteError } = await service
      .from('content_assets')
      .delete()
      .eq('id', asset.id)
      .eq('property_id', parsed.data.propertyId)
    if (deleteError) {
      throw new Error(`Failed to delete property asset: ${deleteError.message}`)
    }
    if (asset.storage_path) {
      await service.storage
        .from(asset.storage_bucket || STORAGE_BUCKETS.PROPERTY_ASSETS)
        .remove([asset.storage_path])
    }

    ctx.logSuccess(200, { assetId: asset.id })
    return NextResponse.json(
      { success: true, assetId: asset.id },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to delete property asset' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
