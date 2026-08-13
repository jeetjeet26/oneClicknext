import { NextRequest, NextResponse } from 'next/server'
import { createRequestContext } from '@/utils/services/request-context'
import { getRateLimitKey } from '@/utils/services/rate-limiter'
import { authorizeReviewSession } from '@/utils/siteforge/review/access'
import { safeReviewError } from '@/utils/siteforge/review/http'
import { getPublicReviewData } from '@/utils/siteforge/review/service'
import {
  REVIEW_SESSION_COOKIE,
  reviewSessionCookieFromRequest,
  reviewSessionCookieOptions,
} from '@/utils/siteforge/review/session'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reviews/public'
  )
  ctx.logStart()
  const headers = {
    ...ctx.responseHeaders,
    'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
  }
  let refreshedSessionCookie: string | null = null

  try {
    const access = await authorizeReviewSession(
      reviewSessionCookieFromRequest(request),
      'view',
      getRateLimitKey(request, 'siteforge-client-review')
    )
    refreshedSessionCookie = access.sessionCookie
    const review = await getPublicReviewData(access.credential)
    ctx.logSuccess(200, {
      reviewSessionId: review.session.id,
      artifactId: review.artifact.id,
      artifactCurrent: review.artifact.isCurrent,
    })
    const response = NextResponse.json(review, { headers })
    response.cookies.set(
      REVIEW_SESSION_COOKIE,
      access.sessionCookie,
      reviewSessionCookieOptions()
    )
    return response
  } catch (error) {
    const safe = safeReviewError(error)
    ctx.logError(safe.status, error, { code: safe.code })
    const response = NextResponse.json(
      { error: safe.message, code: safe.code },
      { status: safe.status, headers }
    )
    if (refreshedSessionCookie) {
      response.cookies.set(
        REVIEW_SESSION_COOKIE,
        refreshedSessionCookie,
        reviewSessionCookieOptions()
      )
    }
    return response
  }
}
