import { NextRequest, NextResponse } from 'next/server'
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
    propertyId: z.string().uuid(),
    brandAssetId: z.string().uuid().optional(),
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
    propertyId: z.string().uuid(),
    brandAssetId: z.string().uuid().optional(),
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

    let brandAssetId = parsed.data.brandAssetId
    if (brandAssetId) {
      const { data: existing, error } = await supabase
        .from('property_brand_assets')
        .select('id')
        .eq('id', brandAssetId)
        .eq('property_id', parsed.data.propertyId)
        .single()
      if (error || !existing) {
        return NextResponse.json(
          { error: 'Brand asset not found' },
          { status: 404, headers: ctx.responseHeaders }
        )
      }
    } else {
      const { data: existing } = await supabase
        .from('property_brand_assets')
        .select('id')
        .eq('property_id', parsed.data.propertyId)
        .maybeSingle()
      brandAssetId = existing?.id
    }

    if (!brandAssetId) {
      const { data: created, error } = await supabase
        .from('property_brand_assets')
        .insert({
          property_id: parsed.data.propertyId,
          generated_by: user.id,
          generation_status: 'generating',
          current_step: 1,
          current_step_name: 'competitive_snapshot',
          contract_version: '1.0',
          brand_origin: parsed.data.mode === 'supplied'
            ? parsed.data.suppliedContract.origin
            : 'generated',
          approval_status: 'draft',
          source_manifest: {
            workflow: {
              mode: parsed.data.mode,
              vertical: parsed.data.vertical,
              requestedBy: user.id,
            },
          },
        })
        .select('id')
        .single()
      if (error || !created) {
        throw new Error(`Unable to create BrandForge asset: ${error?.message || 'unknown error'}`)
      }
      brandAssetId = created.id
    } else {
      const { error } = await supabase
        .from('property_brand_assets')
        .update({
          generation_status: 'generating',
          current_step: 1,
          current_step_name: 'competitive_snapshot',
          draft_section: null,
          approval_status: 'draft',
          source_manifest: {
            workflow: {
              mode: parsed.data.mode,
              vertical: parsed.data.vertical,
              requestedBy: user.id,
            },
          },
        })
        .eq('id', brandAssetId)
        .eq('property_id', parsed.data.propertyId)
      if (error) {
        throw new Error(`Unable to prepare BrandForge asset: ${error.message}`)
      }
    }

    const input = brandForgeWorkflowInputSchema.parse({
      ...parsed.data,
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
    }, { status: 202, headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Unable to start BrandForge workflow' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
