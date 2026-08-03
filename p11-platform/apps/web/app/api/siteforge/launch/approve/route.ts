import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { createRequestContext } from '@/utils/services/request-context'
import { SiteForgeLaunchError } from '@/utils/siteforge/launch/repository'
import { approveLaunchRelease } from '@/utils/siteforge/launch/service'
import { SharedApprovalError } from '@/utils/services/shared-approvals'
import { requireLaunchManager } from '../auth'

const requestSchema = z.object({
  propertyId: z.string().uuid(),
  releaseId: z.string().uuid(),
  artifactId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rollbackArtifactId: z.string().uuid(),
  rollbackContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rationale: z.string().trim().min(1).max(2_000),
  legalRightsSnapshot: z.record(z.string(), z.unknown()).refine(
    value => value.confirmed === true,
    'Legal and asset rights must be explicitly confirmed'
  ),
  expiresAt: z.string().datetime(),
}).strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/launch/approve')
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Complete, exact launch approval evidence is required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId)
    if (!auth.user) return auth.response
    const result = await approveLaunchRelease({
      ...parsed.data,
      legalRightsSnapshot: parsed.data.legalRightsSnapshot as Json,
      approvedBy: auth.user.id,
      requestId: ctx.requestId,
    })
    ctx.logSuccess(200, { releaseId: result.release.id })
    return NextResponse.json(
      {
        release: result.release,
        promotionToken: result.promotionToken,
        warning: 'This signed token is shown once and authorizes only the exact approved release.',
        finalLaunchHumanOwned: true,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeLaunchError || error instanceof SharedApprovalError
        ? error.statusCode
        : 500
    ctx.logError(status, error)
    return NextResponse.json(
      { error: status === 500 ? 'Failed to approve SiteForge launch' : (error as Error).message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
