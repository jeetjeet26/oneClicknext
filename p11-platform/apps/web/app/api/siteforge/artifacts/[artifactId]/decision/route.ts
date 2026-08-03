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
      error instanceof SharedApprovalError
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
