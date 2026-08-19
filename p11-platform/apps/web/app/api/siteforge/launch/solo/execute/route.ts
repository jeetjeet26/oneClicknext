import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { SiteForgeLaunchError } from '@/utils/siteforge/launch/repository'
import { executeSoloLaunch } from '@/utils/siteforge/launch/solo-step-up'
import { requireLaunchManager } from '../../auth'

export const maxDuration = 300

const requestSchema = z
  .object({
    propertyId: z.guid(),
    websiteId: z.guid(),
    releaseId: z.guid().optional(),
  })
  .strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/launch/solo/execute'
  )
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Exact property and website identifiers are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId, request)
    if (!auth.user) return auth.response
    const result = await executeSoloLaunch({
      ...parsed.data,
      actorId: auth.user.id,
      requestId: ctx.requestId,
    })
    ctx.logSuccess(200, { releaseId: result.release.id })
    return NextResponse.json(result, {
      status: 200,
      headers: ctx.responseHeaders,
    })
  } catch (error) {
    const status = error instanceof SiteForgeLaunchError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to execute owner SiteForge launch'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
