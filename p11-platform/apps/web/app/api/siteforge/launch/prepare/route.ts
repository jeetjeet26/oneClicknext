import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import {
  prepareLaunchRelease,
  SiteForgeLaunchError,
} from '@/utils/siteforge/launch/repository'
import { requireLaunchManager } from '../auth'

const requestSchema = z.object({
  propertyId: z.string().uuid(),
  websiteId: z.string().uuid(),
  artifactId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rollbackArtifactId: z.string().uuid(),
  rollbackContentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/launch/prepare')
  ctx.logStart()
  try {
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Exact launch and rollback artifact identities are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId)
    if (!auth.user) return auth.response
    const release = await prepareLaunchRelease({
      ...parsed.data,
      requestedBy: auth.user.id,
      requestId: ctx.requestId,
    })
    ctx.logSuccess(201, { releaseId: release.id, state: release.state })
    return NextResponse.json(
      { release, finalLaunchHumanOwned: true },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status = error instanceof SiteForgeLaunchError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      { error: status === 500 ? 'Failed to prepare SiteForge launch' : (error as Error).message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
