import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { createReviewSessionSchema } from '@/utils/siteforge/review/contracts'
import { safeReviewError } from '@/utils/siteforge/review/http'
import { requireWebsiteReviewAccess } from '@/utils/siteforge/review/internal-auth'
import {
  createReviewSession,
  getInternalReviewState,
} from '@/utils/siteforge/review/service'

const websiteIdSchema = z.string().uuid()

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/reviews')
  ctx.logStart()
  try {
    const websiteId = websiteIdSchema.parse(
      request.nextUrl.searchParams.get('websiteId')
    )
    await requireWebsiteReviewAccess(websiteId)
    const state = await getInternalReviewState(websiteId)
    ctx.logSuccess(200, {
      websiteId,
      sessionCount: state.sessions.length,
    })
    return NextResponse.json(state, { headers: ctx.responseHeaders })
  } catch (error) {
    const safe = safeReviewError(error)
    ctx.logError(safe.status, error, { code: safe.code })
    return NextResponse.json(
      { error: safe.message, code: safe.code },
      { status: safe.status, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/siteforge/reviews')
  ctx.logStart()
  try {
    const input = createReviewSessionSchema.parse(await request.json())
    const { userId } = await requireWebsiteReviewAccess(input.websiteId)
    const session = await createReviewSession(input, userId)
    ctx.logSuccess(201, {
      websiteId: session.website_id,
      reviewSessionId: session.id,
      artifactId: session.artifact_id,
    })
    return NextResponse.json(
      { session },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const safe = safeReviewError(error)
    ctx.logError(safe.status, error, { code: safe.code })
    return NextResponse.json(
      { error: safe.message, code: safe.code },
      { status: safe.status, headers: ctx.responseHeaders }
    )
  }
}
