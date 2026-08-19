import { NextRequest, NextResponse } from 'next/server'
import { createRequestContext } from '@/utils/services/request-context'

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/launch/solo/intent'
  )
  ctx.logStart()
  ctx.logSuccess(410)
  return NextResponse.json(
    {
      error:
        'Launch intent confirmation was replaced by the owner one-button launch action',
      code: 'SITEFORGE_OWNER_LAUNCH_ONLY',
    },
    { status: 410, headers: ctx.responseHeaders }
  )
}
