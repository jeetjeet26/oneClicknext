import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  createIntegrationAuthInvite,
  buildExternalIntegrationLink,
} from '@/utils/services/integration-auth-invites'
import {z} from 'zod'
import { createRequestContext } from '@/utils/services/request-context'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const input=z.object({propertyId:z.string().regex(uuid),requestId:z.string().regex(uuid),provider:z.enum(['google','microsoft']),capabilities:z.array(z.enum(['calendar','email'])).min(1).max(2)}).strict()

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integration-invites')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')
    if (!propertyId || !uuid.test(propertyId)) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    let cursor:{createdAt:string;id:string}|null=null
    try {
      const encoded=searchParams.get('cursor')
      if(encoded){
        if(encoded.length>512)throw new Error('Cursor too long')
        cursor=JSON.parse(Buffer.from(encoded,'base64url').toString())
        if(!cursor||typeof cursor.id!=='string'||!uuid.test(cursor.id)||typeof cursor.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)||!Number.isFinite(Date.parse(cursor.createdAt)))throw new Error('Invalid cursor')
      }
    }catch{return badRequest('Invalid authorization-link page.',ctx.responseHeaders)}
    const serviceSupabase = createServiceClient()
    let query=serviceSupabase.from('integration_auth_invites')
      .select('id, property_id, provider, requested_capabilities, expires_at, consumed_at, revoked_at, created_at, created_by_profile_id, metadata')
      .eq('property_id',propertyId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(26)
    if(cursor)query=query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    const {data,error}=await query
    if (error) {
      ctx.logError(500, error, { operation: 'list_integration_invites', propertyId })
      return serverError(error, ctx.responseHeaders)
    }

    ctx.logSuccess(200, { propertyId, count: data?.length || 0 })
    const rows=(data||[]).slice(0,25),last=rows.at(-1)
    const invites=rows.map(({metadata,created_by_profile_id,...row})=>({...row,recoverable:created_by_profile_id===user.id&&!!metadata&&typeof metadata==='object'&&!Array.isArray(metadata)&&metadata.issuedVia==='recorded_v1',state:row.consumed_at?'used':row.revoked_at?'revoked':Date.parse(row.expires_at)<=Date.now()?'expired':'pending'}))
    return NextResponse.json({invites,nextCursor:(data?.length||0)>25&&last?Buffer.from(JSON.stringify({createdAt:last.created_at,id:last.id})).toString('base64url'):null},{headers:ctx.responseHeaders})
  } catch (error) {
    ctx.logError(500, error, { operation: 'list_integration_invites' })
    return serverError(error, ctx.responseHeaders)
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/integration-invites')
  ctx.logStart()

  try {
    const parsed=input.safeParse(await request.json().catch(()=>null))
    if(!parsed.success)return badRequest('A property, provider, capabilities and saved request identity are required.',ctx.responseHeaders)
    const {propertyId,provider,capabilities,requestId}=parsed.data

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    const result = await createIntegrationAuthInvite({
      requestId,
      propertyId,
      provider,
      capabilities,
      createdByProfileId: user.id,
    })

    ctx.logSuccess(201, { propertyId, provider, capabilities })
    return NextResponse.json(
      {
        actionEventId: result.actionEventId,
        replayed: result.replayed,
        invite: result.invite,
        token: result.token,
        url: result.url,
      },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'create_integration_invite' })
    return serverError(error, ctx.responseHeaders)
  }
}

export function inviteUrlFromToken(token: string) {
  return buildExternalIntegrationLink(token)
}
