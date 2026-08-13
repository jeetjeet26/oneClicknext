import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeAssetProperty } from '@/utils/siteforge/assets/auth'
import { analyzeImageContent } from '@/utils/siteforge/assets/image-analysis'
import type { Json, TablesUpdate } from '@/types/supabase'

const requestSchema = z
  .object({
    propertyId: z.guid(),
    assetId: z.string().uuid(),
  })
  .strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/assets/analyze')
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid asset analysis request' },
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
      .select('*')
      .eq('id', parsed.data.assetId)
      .eq('property_id', parsed.data.propertyId)
      .eq('asset_type', 'image')
      .single()
    if (assetError || !asset) {
      return NextResponse.json(
        { error: 'Property asset not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    if (!asset.storage_bucket || !asset.storage_path) {
      return NextResponse.json(
        { error: 'Asset has no trusted stored image bytes' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { data: blob, error: downloadError } = await service.storage
      .from(asset.storage_bucket)
      .download(asset.storage_path)
    if (downloadError || !blob) {
      throw new Error('Failed to load stored image bytes')
    }
    const mediaType = blob.type || asset.format || ''
    const analysis = await analyzeImageContent({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mediaType,
      filename: asset.name,
      operatorRole: asset.asset_role,
    })
    const sourceMetadata =
      asset.source_metadata &&
      typeof asset.source_metadata === 'object' &&
      !Array.isArray(asset.source_metadata)
        ? asset.source_metadata
        : {}
    const update: TablesUpdate<'content_assets'> = {
      width: analysis.metadata.width,
      height: analysis.metadata.height,
      content_hash: analysis.metadata.contentHash,
      analyzed_at: new Date().toISOString(),
      source_metadata: {
        ...sourceMetadata,
        analysisMode: analysis.mode,
        observedElements: analysis.observedElements,
        qualityNotes: analysis.qualityNotes,
      } as Json,
    }
    if (analysis.mode === 'visual_ai') {
      update.asset_role = asset.asset_role || analysis.suggestedRole
      update.alt_text = asset.alt_text || analysis.altText
      update.focal_point = analysis.focalPoint
      update.crop_suggestion = analysis.cropSuggestion
      update.quality_score = analysis.qualityScore
    }
    const { error: updateError } = await service
      .from('content_assets')
      .update(update)
      .eq('id', asset.id)
      .eq('property_id', parsed.data.propertyId)
    if (updateError) throw new Error('Failed to save image analysis')

    ctx.logSuccess(200, { assetId: asset.id, mode: analysis.mode })
    return NextResponse.json(
      { assetId: asset.id, analysis },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to analyze property asset' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
