import { createHash } from 'node:crypto'
import {requireTeamOrigin,teamBody}from '@/utils/team/http'
import {InventoryError}from '@/utils/knowledge/inventory'
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
import { brandId, brandReply, brandRpc } from '@/utils/brandforge/operations'

const assetRoleSchema = z.enum([
  'primary_logo', 'secondary_logo', 'monochrome_logo', 'brand_mark',
  'favicon', 'font', 'pattern', 'icon', 'brand_example', 'hero',
  'amenity', 'gallery', 'interior', 'exterior', 'lifestyle',
  'neighborhood', 'floorplan',
])
const rightsStatusSchema = z.enum(['unknown', 'owned', 'licensed', 'generated', 'restricted'])
const reviewSchema = z.object({
  propertyId: z.guid(),
  assetId: brandId,
  requestId: z.string().uuid(),
  revision: z.number().int().positive(),
  approvalStatus: z.enum(['approved', 'rejected']),
  rightsStatus: rightsStatusSchema,
  rightsMetadata: z.record(z.string(), z.unknown()).optional(),
  altText: z.string().max(300).optional(),
  focalPoint: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
}).strict()

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
      || /<script|<foreignObject|on\w+\s*=|<!DOCTYPE|<!ENTITY|@import|url\s*\(|(?:href|src)\s*=\s*["'](?!#)/i.test(svg)
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
  const parsed = z.guid().safeParse(propertyId)
  if (!parsed.success) return NextResponse.json({ error: 'Valid property ID required' }, { status: 400, headers: ctx.responseHeaders })
  const access = await validatePropertyAccess(user.id, parsed.data)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })

  const headers = {...ctx.responseHeaders, 'Cache-Control':'private, no-store'}
  try {
    const service = createServiceClient(), params = request.nextUrl.searchParams, mode = params.get('mode')
    if (mode === 'decision') {
      const id = brandId.parse(params.get('requestId'))
      const {data,error} = await service.from('shared_action_events').select('id,request,result,created_at').eq('id',id).eq('property_id',parsed.data).eq('actor_id',user.id).eq('action','brand.asset.reviewed').maybeSingle()
      if (error) throw new Error('The saved decision could not be checked.')
      return NextResponse.json({decision:data},{headers})
    }
    if (mode === 'history') {
      const assetId = brandId.parse(params.get('assetId'))
      let query = service.from('brand_asset_revisions').select('revision,snapshot,created_at').eq('property_id',parsed.data).eq('asset_id',assetId).order('revision',{ascending:false}).limit(31)
      if(params.get('before'))query=query.lt('revision',z.coerce.number().int().positive().parse(params.get('before')))
      const {data,error}=await query
      if(error)throw new Error('Saved asset versions could not be loaded.')
      const rows=data.slice(0,30)
      return NextResponse.json({history:rows,nextRevision:data.length>30?rows.at(-1)?.revision:null},{headers})
    }
    if(mode === 'asset'){
      const {data,error}=await service.from('content_assets').select('*').eq('property_id',parsed.data).eq('id',brandId.parse(params.get('assetId'))).maybeSingle()
      if(error)throw new Error('The asset could not be loaded.')
      return NextResponse.json({asset:data},{headers,status:data?200:404})
    }
    if(mode && mode!=='list')return NextResponse.json({error:'Choose a supported library view.'},{status:400,headers})
    let query=service.from('content_assets').select('*',{count:'exact'}).eq('property_id',parsed.data).order('created_at',{ascending:false,nullsFirst:false}).order('id',{ascending:false}).limit(31)
    const search=params.get('search')?.trim()
    if(search)query=query.ilike('name','%'+z.string().max(200).parse(search).replace(/[\\%_]/g,'\\$&')+'%')
    if(params.get('cursor')){
      const cursor=z.object({createdAt:z.iso.datetime({offset:true}).nullable(),id:brandId}).strict().parse(JSON.parse(Buffer.from(params.get('cursor')!,'base64url').toString()))
      query=cursor.createdAt?query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}),created_at.is.null`):query.is('created_at',null).lt('id',cursor.id)
    }
    const {data,error,count}=await query
    if(error)throw new Error('Failed to load brand assets.')
    const assets=data.slice(0,30),last=assets.at(-1)
    return NextResponse.json({assets,remainingCount:count,nextCursor:data.length>30&&last?Buffer.from(JSON.stringify({createdAt:last.created_at,id:last.id})).toString('base64url'):null},{headers})
  }catch(error){
    return NextResponse.json({error:error instanceof z.ZodError||error instanceof SyntaxError?'Reload the library with valid search and page choices.':error instanceof Error?error.message:'The asset library is unavailable.'},{status:error instanceof z.ZodError||error instanceof SyntaxError?400:503,headers})
  }
}

async function assetReply(result: Record<string, unknown>, propertyId: string, headers: HeadersInit) {
  if (!['applied', 'replayed'].includes(String(result.state))) {
    if (result.state === 'stale' || result.state === 'rights_required') return NextResponse.json({ ...result, error: result.state === 'stale' ? 'This asset changed. Reload the saved asset before reviewing it.' : 'Rights and expiry must be cleared before approval.' }, { status: 409, headers })
    if (result.state === 'role_conflict') return NextResponse.json({ ...result, error: 'This file is already saved for another asset role. Choose the correct saved asset or a different file.' }, { status: 409, headers })
    return brandReply(result)
  }
  const { data: asset, error } = await createServiceClient().from('content_assets').select('*').eq('id', String(result.assetId)).eq('property_id', propertyId).single()
  if (error || !asset) throw new Error('Saved asset could not be confirmed')
  return NextResponse.json({ ...result, asset }, { headers })
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/content-assets')
  ctx.logStart()
  let command: Record<string, unknown> | null = null
  try {
    const user = await authenticatedUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
    const form = await request.formData()
    const propertyId = z.guid().parse(form.get('propertyId'))
    const requestId = z.string().uuid().parse(form.get('requestId'))
    const role = assetRoleSchema.parse(form.get('role'))
    const rightsStatus = rightsStatusSchema.parse(form.get('rightsStatus') || 'unknown')
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('Brand asset file required')
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized || !access.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
    const bytes = await validateFile(file)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const extension = file.type.includes('woff2') ? 'woff2' : ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' } as Record<string,string>)[file.type]
    const metadata = {
      name: file.name.slice(0, 255), description: String(form.get('description') || '').slice(0, 2000),
      asset_type: role === 'font' ? 'font' : 'image', asset_role: role, file_size_bytes: file.size, format: extension,
      rights_status: rightsStatus, rights_metadata: { license: String(form.get('license') || '').slice(0, 2000), release: String(form.get('release') || '').slice(0, 2000), restrictions: String(form.get('restrictions') || '').slice(0, 2000) },
      alt_text: String(form.get('altText') || '').trim().slice(0, 300) || null,
    }
    command = { p_property_id: propertyId, p_actor_id: user.id, p_request_id: requestId, p_input: { contentHash, role, size: file.size, metadataHash: createHash('sha256').update(JSON.stringify(metadata)).digest('hex') } }
    const prepared = await brandRpc('begin_brand_asset_upload', command)
    if (prepared.state !== 'prepared') return assetReply(prepared, propertyId, ctx.responseHeaders)
    const service = createServiceClient()
    const { data: duplicate, error: readError } = await service.from('content_assets').select('id').eq('property_id', propertyId).eq('content_hash', contentHash).maybeSingle()
    if (readError) throw new Error('Asset lookup failed')
    let assetPayload: Record<string, unknown> | null = null
    if (!duplicate) {
      const storagePath = `${propertyId}/brandforge/${role}/${requestId}.${extension}`
      const upload = await uploadFileAsset(file, { bucket: STORAGE_BUCKETS.PROPERTY_ASSETS, propertyId, folder: `brandforge/${role}`, filename: `${requestId}.${extension}`, contentType: file.type, upsert: false })
      if (!upload.success) {
        // The first response may have been lost after storage accepted the bytes.
        const recovered = await service.storage.from(STORAGE_BUCKETS.PROPERTY_ASSETS).download(storagePath)
        if (recovered.error || !recovered.data || createHash('sha256').update(new Uint8Array(await recovered.data.arrayBuffer())).digest('hex') !== contentHash) {
          await brandRpc('finish_brand_asset_upload', { ...command, p_error: 'upload_failed' })
          return NextResponse.json({ error: 'The upload was not confirmed. Retry the same file.', state: 'upload_failed' }, { status: 503, headers: ctx.responseHeaders })
        }
      }
      const { data: url } = service.storage.from(STORAGE_BUCKETS.PROPERTY_ASSETS).getPublicUrl(storagePath)
      assetPayload = { ...metadata, storage_bucket: STORAGE_BUCKETS.PROPERTY_ASSETS, storage_path: storagePath, file_url: url.publicUrl }
    }
    const completed = await brandRpc('finish_brand_asset_upload', { ...command, p_asset: assetPayload })
    return assetReply(completed, propertyId, ctx.responseHeaders)
  } catch (error) {
    ctx.logError(command ? 503 : 400, error)
    // Preserve the object and request identity on an ambiguous database reply.
    if (command) {
      try {
        const recovered = await brandRpc('begin_brand_asset_upload', command)
        if (recovered.state === 'replayed') return await assetReply(recovered, String(command.p_property_id), ctx.responseHeaders)
      } catch { /* The same request can be retried when the database recovers. */ }
    }
    return NextResponse.json({ error: command ? 'The saved upload could not be confirmed. Retry the same file.' : error instanceof z.ZodError ? 'A valid property, request and asset are required.' : error instanceof Error ? error.message : 'Invalid brand asset' }, { status: command ? 503 : 400, headers: ctx.responseHeaders })
  }
}

export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/content-assets')
  ctx.logStart()
  const user = await authenticatedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  let body:unknown
  try{requireTeamOrigin(request);body=await teamBody(request)}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Asset review unavailable.'},{status:error instanceof InventoryError?error.status:400,headers:{'Cache-Control':'private, no-store'}})}
  const parsed = reviewSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'A valid review and saved asset version are required.' }, { status: 400, headers: ctx.responseHeaders })
  const { propertyId, assetId, requestId, revision, ...review } = parsed.data
  const access = await validatePropertyManagerAccess(user.id, propertyId)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
  try {
    const result = await brandRpc('review_brand_asset', { p_property_id: propertyId, p_asset_id: assetId, p_actor_id: user.id, p_request_id: requestId, p_revision: revision, p_review: review })
    return await assetReply(result, propertyId, ctx.responseHeaders)
  } catch {
    return NextResponse.json({ error: 'The review could not be confirmed. Retry the same decision.' }, { status: 503, headers: ctx.responseHeaders })
  }
}
