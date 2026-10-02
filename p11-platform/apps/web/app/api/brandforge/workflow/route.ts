import { NextRequest, NextResponse } from 'next/server'
import { brandId, brandRpc, brandReply } from '@/utils/brandforge/operations'
import { start } from 'workflow/api'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  brandForgeContractV1Schema,
  brandForgeVerticalSchema,
  brandForgeWorkflowInputSchema,
} from '@/utils/brandforge/contracts'
import { brandForgeWorkflow } from '@/workflows/brandforge'

const workflowRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('generated'),
    requestId: brandId,
    revision: z.number().int().min(0),
    propertyId: brandId,
    brandAssetId: brandId.optional(),
    vertical: brandForgeVerticalSchema,
    creativeBrief: z.object({
      brandName: z.string().trim().min(1).max(200),
      vision: z.string().trim().max(5_000).default(''),
      targetAudience: z.string().trim().max(2_000).default(''),
      brandVoice: z.string().trim().max(500).default(''),
      personality: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
      visualPreferences: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
    }),
  }),
  z.object({
    mode: z.literal('supplied'),
    requestId: brandId,
    revision: z.number().int().min(0),
    propertyId: brandId,
    brandAssetId: brandId.optional(),
    vertical: brandForgeVerticalSchema,
    suppliedContract: brandForgeContractV1Schema,
  }),
])

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/brandforge/workflow')
  ctx.logStart()
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }

    const parsed = workflowRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid BrandForge workflow request', details: parsed.error.flatten() },
        { status: 400, headers: ctx.responseHeaders }
      )
    }

    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized || !access.orgId) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('id, org_id')
      .eq('id', parsed.data.propertyId)
      .eq('org_id', access.orgId)
      .single()
    if (propertyError || !property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const { requestId, revision, ...requested } = parsed.data
    const claim = await brandRpc('begin_brand_operation', { p_property_id: parsed.data.propertyId, p_brand_asset_id: parsed.data.brandAssetId || null, p_actor_id: user.id, p_request_id: requestId, p_revision: revision, p_kind: 'contract', p_input: requested })
    if (claim.state !== 'claimed') return brandReply(claim)
    const brandAssetId = String(claim.brandAssetId)
    const input = brandForgeWorkflowInputSchema.parse({
      ...parsed.data,
      operationId: requestId,
      operationToken: claim.claimToken,
      brandAssetId,
      orgId: access.orgId,
      requestedBy: user.id,
    })
    const run = await start(brandForgeWorkflow, [input])

    ctx.logSuccess(202, {
      brandAssetId,
      runId: run.runId,
      mode: input.mode,
      vertical: input.vertical,
    })
    return NextResponse.json({
      success: true,
      brandAssetId,
      runId: run.runId,
      status: 'generating',
      mode: input.mode,
      vertical: input.vertical,
      requestId,
    }, { status: 202, headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Unable to start BrandForge workflow' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
