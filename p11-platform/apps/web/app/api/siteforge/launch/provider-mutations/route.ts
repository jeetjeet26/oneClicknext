import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { SiteForgeLaunchError } from '@/utils/siteforge/launch/repository'
import { executeLaunchProviderMutation } from '@/utils/siteforge/launch/service'
import { requireLaunchManager } from '../auth'

// Cloudways backups and staging pushes can take several minutes to complete.
export const maxDuration = 300

const requestSchema = z.object({
  propertyId: z.guid(),
  releaseId: z.string().uuid(),
  mutation: z.enum(['backup', 'promotion', 'restore']),
}).strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/launch/provider-mutations'
  )
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A release identity and provider mutation are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId, request)
    if (!auth.user) return auth.response
    const result = await executeLaunchProviderMutation({
      ...parsed.data,
      actorId: auth.user.id,
      requestId: ctx.requestId,
    })
    ctx.logSuccess(200, {
      releaseId: parsed.data.releaseId,
      mutation: result.mutation,
      idempotent: result.idempotent,
    })
    return NextResponse.json(result, { headers: ctx.responseHeaders })
  } catch (error) {
    const status = error instanceof SiteForgeLaunchError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to execute the launch provider mutation'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
