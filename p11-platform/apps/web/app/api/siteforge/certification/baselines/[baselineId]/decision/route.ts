import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { SharedApprovalError } from '@/utils/services/shared-approvals'
import {
  decideVisualBaseline,
  VisualBaselineError,
} from '@/utils/siteforge/verification/visual-baselines'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

const requestSchema = z.object({
  propertyId: z.string().uuid(),
  operation: z.enum(['approve', 'deny', 'revoke']),
  reason: z.string().trim().min(1).max(2_000),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ baselineId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/certification/baselines/[baselineId]/decision'
  )
  ctx.logStart()
  try {
    const { baselineId } = await context.params
    if (!z.string().uuid().safeParse(baselineId).success) {
      return NextResponse.json(
        { error: 'Invalid visual baseline identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const parsed = requestSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid visual baseline decision' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(
      user.id,
      parsed.data.propertyId
    )
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .single()
    if (
      profileError ||
      !profile?.org_id ||
      !['admin', 'manager'].includes(profile.role || '')
    ) {
      return NextResponse.json(
        { error: 'Visual baseline manager permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const service = createServiceClient()
    const { data: baselineIdentity } = await service
      .from('siteforge_visual_baselines')
      .select('property_id, website_id')
      .eq('id', baselineId)
      .eq('property_id', parsed.data.propertyId)
      .maybeSingle()
    if (!baselineIdentity) {
      return NextResponse.json(
        { error: 'Visual baseline not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    await assertActiveAuroraLifecycleLease(
      request,
      {
        propertyId: baselineIdentity.property_id,
        websiteId: baselineIdentity.website_id,
      },
      service
    )

    const baseline = await decideVisualBaseline({
      baselineId,
      propertyId: parsed.data.propertyId,
      reviewerProfileId: user.id,
      operation: parsed.data.operation,
      reason: parsed.data.reason,
    })
    ctx.logSuccess(200, {
      baselineId,
      propertyId: parsed.data.propertyId,
      operation: parsed.data.operation,
    })
    return NextResponse.json(
      { success: true, baseline },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof VisualBaselineError ||
      error instanceof SharedApprovalError ||
      error instanceof AuroraLifecycleControlError
        ? error.statusCode
        : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to record visual baseline decision'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
