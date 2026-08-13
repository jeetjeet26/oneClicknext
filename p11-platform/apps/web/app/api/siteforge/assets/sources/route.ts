import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeAssetProperty } from '@/utils/siteforge/assets/auth'
import { createAssetSourceSchema } from '@/utils/siteforge/assets/contracts'
import { assetSourceScopeManifest } from '@/utils/siteforge/assets/source-adapters'
import { presentAssetSource } from '@/utils/siteforge/assets/source-presentation'

const propertyIdSchema = z.guid()

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/assets/sources')
  ctx.logStart()
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
    .from('siteforge_asset_sources')
    .select('*')
    .eq('org_id', authorization.orgId)
    .eq('property_id', parsedPropertyId.data)
    .order('created_at', { ascending: false })
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to load asset sources' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  ctx.logSuccess(200, { sourceCount: data.length })
  return NextResponse.json(
    { sources: data.map(presentAssetSource) },
    { headers: ctx.responseHeaders }
  )
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/assets/sources')
  ctx.logStart()
  try {
    const parsed = createAssetSourceSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid asset source configuration' },
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
    if (parsed.data.websiteId) {
      const { data: website } = await service
        .from('property_websites')
        .select('id')
        .eq('id', parsed.data.websiteId)
        .eq('org_id', authorization.orgId)
        .eq('property_id', parsed.data.propertyId)
        .maybeSingle()
      if (!website) {
        return NextResponse.json(
          { error: 'Website does not belong to this property' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
    }
    const { data: source, error } = await service
      .from('siteforge_asset_sources')
      .insert({
        org_id: authorization.orgId,
        property_id: parsed.data.propertyId,
        website_id: parsed.data.websiteId || null,
        provider: parsed.data.provider,
        status: 'active',
        external_folder_id: parsed.data.externalFolderId,
        external_folder_name: parsed.data.externalFolderName || null,
        credential_ref: parsed.data.credentialRef,
        scope_manifest: {
          ...assetSourceScopeManifest[parsed.data.provider],
          scopes: [
            ...assetSourceScopeManifest[parsed.data.provider].scopes,
          ],
        },
        checkpoint: {},
        created_by: authorization.userId,
      })
      .select('*')
      .single()
    if (error || !source) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'This folder source is already configured' },
          { status: 409, headers: ctx.responseHeaders }
        )
      }
      throw new Error('Failed to create asset source')
    }
    ctx.logSuccess(201, {
      sourceId: source.id,
      provider: source.provider,
    })
    return NextResponse.json(
      { source: presentAssetSource(source) },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to create asset source' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
