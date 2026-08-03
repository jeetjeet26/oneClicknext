import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { SiteForgeLaunchError } from '@/utils/siteforge/launch/repository'
import { restoreLaunchRelease } from '@/utils/siteforge/launch/service'
import { markRestoreDrillsReadyForVerification } from '@/utils/siteforge/restore-drill-runner'
import { requireLaunchManager } from '../auth'

const requestSchema = z.object({
  propertyId: z.string().uuid(),
  releaseId: z.string().uuid(),
  rationale: z.string().trim().min(1).max(2_000),
  manualConfirmation: z.object({
    operationId: z.string().trim().min(1).max(500),
  }).strict().optional(),
}).strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/launch/restore')
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Release identity and restore rationale are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId)
    if (!auth.user) return auth.response
    const result = await restoreLaunchRelease({
      ...parsed.data,
      actorId: auth.user.id,
      requestId: ctx.requestId,
    })
    if (!result.manualRequired) {
      await markRestoreDrillsReadyForVerification(
        parsed.data.releaseId,
        parsed.data.manualConfirmation?.operationId || ctx.requestId
      )
    }
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
      { error: status === 500 ? 'Failed to restore SiteForge release' : (error as Error).message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
