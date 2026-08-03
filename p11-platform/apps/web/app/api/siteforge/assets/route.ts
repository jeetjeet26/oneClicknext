import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  STORAGE_BUCKETS,
  uploadFileAsset,
} from '@/utils/storage/asset-service'

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

function defaultAltText(filename: string, category: string): string {
  const name = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name || `${category} property photograph`
}

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

async function authorize(propertyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) {
    return { status: 401 as const, userId: null, orgId: null }
  }
  const access = await validatePropertyAccess(user.id, propertyId)
  if (!access.authorized) {
    return { status: 403 as const, userId: user.id, orgId: null }
  }
  return { status: 200 as const, userId: user.id, orgId: access.orgId || null }
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
    const authorization = await authorize(parsedPropertyId.data)
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
      .in('asset_role', [...categorySchema.options])
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Failed to load property assets: ${error.message}`)
    }

    const assets = (data || []).map((row) => ({
        id: row.id,
        url: row.file_url,
        filename: row.name,
        fileSize: row.file_size_bytes,
        mimeType: row.format,
        category: row.asset_role,
        altText: row.alt_text,
        approvalStatus: row.approval_status,
        rightsStatus: row.rights_status,
        createdAt: row.created_at,
      }))
    ctx.logSuccess(200, { assetCount: assets.length })
    return NextResponse.json({ assets }, { headers: ctx.responseHeaders })
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

    const authorization = await authorize(parsedPropertyId.data)
    if (authorization.status !== 200) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status, headers: ctx.responseHeaders }
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

    const altText =
      typeof altTextValue === 'string' && altTextValue.trim()
        ? altTextValue.trim().slice(0, 300)
        : defaultAltText(file.name, category)
    const service = createServiceClient()
    const contentHash = createHash('sha256')
      .update(new Uint8Array(await file.arrayBuffer()))
      .digest('hex')
    const { data: created, error: createError } = await service
      .from('content_assets')
      .insert({
        org_id: authorization.orgId,
        property_id: parsedPropertyId.data,
        name: file.name.slice(0, 255),
        description: `SiteForge ${category} image`,
        asset_type: 'image',
        asset_role: category,
        file_url: result.publicUrl,
        file_size_bytes: result.fileSize ?? file.size,
        format: file.type,
        storage_bucket: STORAGE_BUCKETS.PROPERTY_ASSETS,
        storage_path: result.storagePath,
        content_hash: contentHash,
        source_identity: `siteforge-upload:${file.name}`,
        source_metadata: { uploadedAt: new Date().toISOString() },
        rights_status: 'unknown',
        approval_status: 'pending',
        alt_text: altText,
        uploaded_by: authorization.userId,
      })
      .select(
        'id, file_url, name, file_size_bytes, format, asset_role, alt_text, approval_status, rights_status, created_at'
      )
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
        asset: {
          id: created.id,
          url: created.file_url,
          filename: created.name,
          fileSize: created.file_size_bytes,
          mimeType: created.format,
          category,
          altText: created.alt_text,
          approvalStatus: created.approval_status,
          rightsStatus: created.rights_status,
          createdAt: created.created_at,
        },
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
    const authorization = await authorize(parsed.data.propertyId)
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
