import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeAssetProperty } from '@/utils/siteforge/assets/auth'
import { updateAssetSourceSchema } from '@/utils/siteforge/assets/contracts'
import { presentAssetSource } from '@/utils/siteforge/assets/source-presentation'

const paramsSchema = z.object({ sourceId: z.string().uuid() })
const revokeSchema = z.object({ propertyId: z.guid() }).strict()

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ sourceId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/assets/sources/[sourceId]'
  )
  ctx.logStart()
  try {
    const parsedParams = paramsSchema.safeParse(await context.params)
    const parsed = updateAssetSourceSchema.safeParse(await request.json())
    if (!parsedParams.success || !parsed.success) {
      return NextResponse.json(
        { error: 'Invalid asset source update' },
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
    const { data: current } = await service
      .from('siteforge_asset_sources')
      .select('*')
      .eq('id', parsedParams.data.sourceId)
      .eq('org_id', authorization.orgId)
      .eq('property_id', parsed.data.propertyId)
      .maybeSingle()
    if (!current) {
      return NextResponse.json(
        { error: 'Asset source not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    if (
      parsed.data.status === 'active' &&
      !parsed.data.credentialRef &&
      !current.credential_ref
    ) {
      return NextResponse.json(
        { error: 'Active sources require a credential reference' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const revoked = parsed.data.status === 'revoked'
    const { data: source, error } = await service
      .from('siteforge_asset_sources')
      .update({
        status: parsed.data.status,
        external_folder_name: parsed.data.externalFolderName,
        credential_ref: revoked
          ? null
          : parsed.data.credentialRef ?? current.credential_ref,
        last_error: revoked ? null : current.last_error,
      })
      .eq('id', current.id)
      .eq('org_id', authorization.orgId)
      .eq('property_id', parsed.data.propertyId)
      .select('*')
      .single()
    if (error || !source) throw new Error('Failed to update asset source')
    ctx.logSuccess(200, { sourceId: source.id, status: source.status })
    return NextResponse.json(
      { source: presentAssetSource(source) },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to update asset source' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ sourceId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/assets/sources/[sourceId]'
  )
  ctx.logStart()
  const parsedParams = paramsSchema.safeParse(await context.params)
  const parsed = revokeSchema.safeParse(await request.json())
  if (!parsedParams.success || !parsed.success) {
    return NextResponse.json(
      { error: 'Invalid asset source revocation' },
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
  const { data: source, error } = await service
    .from('siteforge_asset_sources')
    .update({
      status: 'revoked',
      credential_ref: null,
      last_error: null,
    })
    .eq('id', parsedParams.data.sourceId)
    .eq('org_id', authorization.orgId)
    .eq('property_id', parsed.data.propertyId)
    .select('*')
    .single()
  if (error || !source) {
    return NextResponse.json(
      { error: 'Asset source not found' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }
  ctx.logSuccess(200, { sourceId: source.id, status: 'revoked' })
  return NextResponse.json(
    { source: presentAssetSource(source) },
    { headers: ctx.responseHeaders }
  )
}
