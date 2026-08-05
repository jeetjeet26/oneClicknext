import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { SiteForgeLaunchError } from '@/utils/siteforge/launch/repository'
import { promoteLaunchRelease } from '@/utils/siteforge/launch/service'
import { requireLaunchManager } from '../auth'

const requestSchema = z.object({
  propertyId: z.string().uuid(),
  releaseId: z.string().uuid(),
  promotionToken: z.string().min(40).max(4_096),
  backupConfirmation: z.object({
    operationId: z.string().trim().min(1).max(500),
    backupId: z.string().trim().min(1).max(500),
  }).strict().optional(),
  manualConfirmation: z.object({
    operationId: z.string().trim().min(1).max(500),
  }).strict().optional(),
}).strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/launch/promote')
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A valid release and one-use promotion token are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId, request)
    if (!auth.user) return auth.response
    const result = await promoteLaunchRelease({
      ...parsed.data,
      actorId: auth.user.id,
      requestId: ctx.requestId,
    })
    const status = result.manualRequired ? 409 : 200
    ctx.logSuccess(status, {
      releaseId: result.release.id,
      manualRequired: result.manualRequired,
    })
    return NextResponse.json(result, { status, headers: ctx.responseHeaders })
  } catch (error) {
    const status = error instanceof SiteForgeLaunchError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      { error: status === 500 ? 'Failed to promote SiteForge release' : (error as Error).message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
