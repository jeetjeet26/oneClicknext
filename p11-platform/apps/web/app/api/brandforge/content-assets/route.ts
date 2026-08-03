import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { STORAGE_BUCKETS, uploadFileAsset } from '@/utils/storage/asset-service'
import type { Json } from '@/types/supabase'

const assetRoleSchema = z.enum([
  'primary_logo', 'secondary_logo', 'monochrome_logo', 'brand_mark',
  'favicon', 'font', 'pattern', 'icon', 'brand_example', 'hero',
  'amenity', 'gallery', 'interior', 'exterior', 'lifestyle',
  'neighborhood', 'floorplan',
])
const rightsStatusSchema = z.enum(['unknown', 'owned', 'licensed', 'generated', 'restricted'])
const reviewSchema = z.object({
  propertyId: z.string().uuid(),
  assetId: z.string().uuid(),
  approvalStatus: z.enum(['approved', 'rejected']),
  rightsStatus: rightsStatusSchema,
  rightsMetadata: z.record(z.string(), z.unknown()).optional(),
  altText: z.string().max(300).optional(),
  focalPoint: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
})

const allowedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'font/woff2',
  'application/font-woff2',
])
const MAX_BYTES = 20 * 1024 * 1024

async function validateFile(file: File): Promise<Uint8Array> {
  if (!allowedTypes.has(file.type)) throw new Error('Unsupported brand asset type')
  if (file.size > MAX_BYTES) throw new Error('Brand assets must be 20MB or smaller')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (file.type === 'image/jpeg' && !(bytes[0] === 0xff && bytes[1] === 0xd8)) {
    throw new Error('Invalid JPEG signature')
  }
  if (file.type === 'image/png' && !(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    throw new Error('Invalid PNG signature')
  }
  if (file.type === 'image/webp' && new TextDecoder().decode(bytes.slice(8, 12)) !== 'WEBP') {
    throw new Error('Invalid WebP signature')
  }
  if (file.type.includes('woff2') && new TextDecoder().decode(bytes.slice(0, 4)) !== 'wOF2') {
    throw new Error('Invalid WOFF2 signature')
  }
  if (file.type === 'image/svg+xml') {
    const svg = new TextDecoder().decode(bytes)
    if (
      !/<svg[\s>]/i.test(svg)
      || /<script|<foreignObject|on\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:)/i.test(svg)
    ) {
      throw new Error('SVG contains executable or external content')
    }
  }
  return bytes
}

async function authenticatedUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return error ? null : user
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/content-assets')
  ctx.logStart()
  const propertyId = request.nextUrl.searchParams.get('propertyId')
  const user = await authenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const parsed = z.string().uuid().safeParse(propertyId)
  if (!parsed.success) return NextResponse.json({ error: 'Valid property ID required' }, { status: 400, headers: ctx.responseHeaders })
  const access = await validatePropertyAccess(user.id, parsed.data)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })

  const service = createServiceClient()
  const { data, error } = await service
    .from('content_assets')
    .select('*')
    .eq('property_id', parsed.data)
    .order('created_at', { ascending: false })
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json({ error: 'Failed to load brand assets' }, { status: 500, headers: ctx.responseHeaders })
  }
  ctx.logSuccess(200, { assetCount: data.length })
  return NextResponse.json({ assets: data }, { headers: ctx.responseHeaders })
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/content-assets')
  ctx.logStart()
  try {
    const user = await authenticatedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
    const form = await request.formData()
    const propertyId = z.string().uuid().parse(form.get('propertyId'))
    const role = assetRoleSchema.parse(form.get('role'))
    const rightsStatus = rightsStatusSchema.parse(form.get('rightsStatus') || 'unknown')
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('Brand asset file required')
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
    }
    const bytes = await validateFile(file)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const service = createServiceClient()
    const { data: duplicate } = await service
      .from('content_assets')
      .select('*')
      .eq('property_id', propertyId)
      .eq('content_hash', contentHash)
      .maybeSingle()
    if (duplicate) {
      return NextResponse.json({ asset: duplicate, duplicate: true }, { status: 200, headers: ctx.responseHeaders })
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || (
      file.type.includes('woff2') ? 'woff2' : file.type === 'image/svg+xml' ? 'svg' : 'bin'
    )
    const upload = await uploadFileAsset(file, {
      bucket: STORAGE_BUCKETS.PROPERTY_ASSETS,
      propertyId,
      folder: `brandforge/${role}`,
      filename: `${randomUUID()}.${extension}`,
      contentType: file.type,
      upsert: false,
    })
    if (!upload.success || !upload.publicUrl || !upload.storagePath) {
      throw new Error(upload.error || 'Brand asset upload failed')
    }
    const altText = String(form.get('altText') || '').trim().slice(0, 300)
    const { data: asset, error } = await service
      .from('content_assets')
      .insert({
        org_id: access.orgId,
        property_id: propertyId,
        name: file.name.slice(0, 255),
        description: String(form.get('description') || '').slice(0, 2_000),
        asset_type: role === 'font' ? 'font' : 'image',
        asset_role: role,
        file_url: upload.publicUrl,
        file_size_bytes: upload.fileSize ?? file.size,
        format: extension,
        storage_bucket: STORAGE_BUCKETS.PROPERTY_ASSETS,
        storage_path: upload.storagePath,
        content_hash: contentHash,
        source_identity: `upload:${file.name}`,
        source_metadata: { uploadedAt: new Date().toISOString() },
        rights_status: rightsStatus,
        rights_metadata: {
          license: String(form.get('license') || ''),
          release: String(form.get('release') || ''),
          restrictions: String(form.get('restrictions') || ''),
        },
        approval_status: 'pending',
        alt_text: altText || null,
        uploaded_by: user.id,
      })
      .select('*')
      .single()
    if (error || !asset) {
      await service.storage.from(STORAGE_BUCKETS.PROPERTY_ASSETS).remove([upload.storagePath])
      throw new Error(`Failed to persist brand asset: ${error?.message}`)
    }
    ctx.logSuccess(201, { assetId: asset.id, role })
    return NextResponse.json({ asset }, { status: 201, headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(400, error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Brand asset upload failed',
    }, { status: 400, headers: ctx.responseHeaders })
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/content-assets')
  ctx.logStart()
  const user = await authenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const parsed = reviewSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid asset review' }, { status: 400, headers: ctx.responseHeaders })
  const access = await validatePropertyManagerAccess(user.id, parsed.data.propertyId)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
  if (
    parsed.data.approvalStatus === 'approved'
    && !['owned', 'licensed', 'generated'].includes(parsed.data.rightsStatus)
  ) {
    return NextResponse.json({ error: 'Rights must be cleared before approval' }, { status: 409, headers: ctx.responseHeaders })
  }
  const service = createServiceClient()
  const { data, error } = await service
    .from('content_assets')
    .update({
      approval_status: parsed.data.approvalStatus,
      rights_status: parsed.data.rightsStatus,
      rights_metadata: (parsed.data.rightsMetadata || {}) as Json,
      alt_text: parsed.data.altText,
      focal_point: parsed.data.focalPoint,
      expires_at: parsed.data.expiresAt,
      approved_by: user.id,
      approved_at: parsed.data.approvalStatus === 'approved' ? new Date().toISOString() : null,
    })
    .eq('id', parsed.data.assetId)
    .eq('property_id', parsed.data.propertyId)
    .select('*')
    .single()
  if (error || !data) return NextResponse.json({ error: 'Brand asset not found' }, { status: 404, headers: ctx.responseHeaders })
  ctx.logSuccess(200, { assetId: data.id, approvalStatus: data.approval_status })
  return NextResponse.json({ asset: data }, { headers: ctx.responseHeaders })
}
