import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  decideSiteForgeArtifactDeployment,
  SiteForgeArtifactApprovalError,
} from '@/utils/siteforge/artifacts/approval'
import { SharedApprovalError } from '@/utils/services/shared-approvals'
import { createRequestContext } from '@/utils/services/request-context'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  assertActiveAuroraLifecycleLease,
  AuroraLifecycleControlError,
} from '@/utils/siteforge/testing/aurora-lifecycle-control'

const requestSchema = z.object({
  propertyId: z.guid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  decisionStatus: z.enum(['approved', 'denied']),
  decisionReason: z.string().trim().min(1).max(2_000),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/artifacts/[artifactId]/decision'
  )
  ctx.logStart()
  try {
    const { artifactId } = await params
    if (!z.string().uuid().safeParse(artifactId).success) {
      return NextResponse.json(
        { error: 'Invalid artifact identifier' },
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
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid artifact decision' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (
      profileError ||
      !profile ||
      !['admin', 'manager'].includes(profile.role || '')
    ) {
      return NextResponse.json(
        { error: 'Deployment approval permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const service = createServiceClient()
    const { data: artifactIdentity } = await service
      .from('siteforge_blueprint_versions')
      .select('property_id, website_id')
      .eq('id', artifactId)
      .eq('property_id', parsed.data.propertyId)
      .maybeSingle()
    if (!artifactIdentity) {
      return NextResponse.json(
        { error: 'Artifact not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    await assertActiveAuroraLifecycleLease(
      request,
      {
        propertyId: artifactIdentity.property_id,
        websiteId: artifactIdentity.website_id,
      },
      service
    )

    const result = await decideSiteForgeArtifactDeployment({
      artifactId,
      propertyId: parsed.data.propertyId,
      reviewerProfileId: user.id,
      contentHash: parsed.data.contentHash,
      decisionStatus: parsed.data.decisionStatus,
      decisionReason: parsed.data.decisionReason,
    })
    ctx.logSuccess(200, {
      artifactId,
      decisionStatus: parsed.data.decisionStatus,
    })
    return NextResponse.json(
      { success: true, ...result },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeArtifactApprovalError ||
      error instanceof SharedApprovalError ||
      error instanceof AuroraLifecycleControlError
        ? error.statusCode
        : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to record artifact deployment decision'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
