import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { listSiteForgeIncidents } from '@/utils/siteforge/incidents'
import { authorizeSiteForgeWebsite } from '@/utils/siteforge/operations-auth'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/incidents')
  const websiteId = new URL(request.url).searchParams.get('websiteId')
  if (!websiteId || !z.string().uuid().safeParse(websiteId).success) {
    return NextResponse.json(
      { error: 'Valid websiteId is required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(websiteId)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  try {
    return NextResponse.json(await listSiteForgeIncidents(websiteId), {
      headers: ctx.responseHeaders,
    })
  } catch (cause) {
    ctx.logError(500, cause)
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : 'Failed to list incidents' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
