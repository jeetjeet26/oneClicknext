import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import {
  getLaunchStatus,
  SiteForgeLaunchError,
} from '@/utils/siteforge/launch/repository'
import { requireLaunchManager } from '../auth'

const querySchema = z.object({
  propertyId: z.string().uuid(),
  releaseId: z.string().uuid().optional(),
  websiteId: z.string().uuid().optional(),
}).refine(value => Boolean(value.releaseId || value.websiteId))

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/launch/status')
  ctx.logStart()
  try {
    const url = new URL(request.url)
    const parsed = querySchema.safeParse({
      propertyId: url.searchParams.get('propertyId'),
      releaseId: url.searchParams.get('releaseId') || undefined,
      websiteId: url.searchParams.get('websiteId') || undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Property and release or website identifier are required' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await requireLaunchManager(parsed.data.propertyId)
    if (!auth.user) return auth.response
    const status = await getLaunchStatus(parsed.data)
    ctx.logSuccess(200, { releaseId: status.release.id, state: status.release.state })
    return NextResponse.json(status, { headers: ctx.responseHeaders })
  } catch (error) {
    const status = error instanceof SiteForgeLaunchError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      { error: status === 500 ? 'Failed to load SiteForge launch status' : (error as Error).message },
      { status, headers: ctx.responseHeaders }
    )
  }
}
