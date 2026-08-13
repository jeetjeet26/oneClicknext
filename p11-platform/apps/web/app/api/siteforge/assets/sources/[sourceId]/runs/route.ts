import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeAssetProperty } from '@/utils/siteforge/assets/auth'
import { runAssetSourceSchema } from '@/utils/siteforge/assets/contracts'
import { runAssetSourceIngestion } from '@/utils/siteforge/assets/source-ingestion'

const paramsSchema = z.object({ sourceId: z.string().uuid() })
const propertyIdSchema = z.guid()

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sourceId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/assets/sources/[sourceId]/runs'
  )
  ctx.logStart()
  const parsedParams = paramsSchema.safeParse(await context.params)
  const parsedPropertyId = propertyIdSchema.safeParse(
    request.nextUrl.searchParams.get('propertyId')
  )
  if (!parsedParams.success || !parsedPropertyId.success) {
    return NextResponse.json(
      { error: 'Valid source and property IDs required' },
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
    .from('siteforge_asset_ingest_runs')
    .select(
      'id, source_id, status, source_checkpoint, result_manifest, discovered_count, imported_count, duplicate_count, rejected_count, error_message, started_at, completed_at, created_at'
    )
    .eq('source_id', parsedParams.data.sourceId)
    .eq('org_id', authorization.orgId)
    .eq('property_id', parsedPropertyId.data)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to load asset ingest runs' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  ctx.logSuccess(200, { runCount: data.length })
  return NextResponse.json({ runs: data }, { headers: ctx.responseHeaders })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sourceId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/assets/sources/[sourceId]/runs'
  )
  ctx.logStart()
  try {
    const parsedParams = paramsSchema.safeParse(await context.params)
    const parsed = runAssetSourceSchema.safeParse(await request.json())
    if (!parsedParams.success || !parsed.success) {
      return NextResponse.json(
        { error: 'Invalid asset ingest request' },
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
    const { data: source, error: sourceError } = await service
      .from('siteforge_asset_sources')
      .select('*')
      .eq('id', parsedParams.data.sourceId)
      .eq('org_id', authorization.orgId)
      .eq('property_id', parsed.data.propertyId)
      .single()
    if (sourceError || !source) {
      return NextResponse.json(
        { error: 'Asset source not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    if (source.status === 'paused' || source.status === 'revoked') {
      return NextResponse.json(
        { error: `Asset source is ${source.status}` },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const activeSource =
      source.status === 'error'
        ? ({ ...source, status: 'active' } as typeof source)
        : source
    if (source.status === 'error') {
      const { error: retryError } = await service
        .from('siteforge_asset_sources')
        .update({ status: 'active', last_error: null })
        .eq('id', source.id)
        .eq('org_id', authorization.orgId)
        .eq('property_id', parsed.data.propertyId)
      if (retryError) throw new Error('Failed to prepare asset source retry')
    }
    const run = await runAssetSourceIngestion({
      source: activeSource,
      userId: authorization.userId,
      supabase: service,
    })
    ctx.logSuccess(201, {
      runId: run.id,
      importedCount: run.imported_count,
      duplicateCount: run.duplicate_count,
    })
    return NextResponse.json(
      { run },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(502, error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Asset provider ingestion failed',
      },
      { status: 502, headers: ctx.responseHeaders }
    )
  }
}
