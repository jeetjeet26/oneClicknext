import { NextRequest, NextResponse } from 'next/server'
import { createRequestContext } from '@/utils/services/request-context'
import { getRateLimitKey } from '@/utils/services/rate-limiter'
import { authorizeReviewSession } from '@/utils/siteforge/review/access'
import { createReviewCommentSchema } from '@/utils/siteforge/review/contracts'
import { safeReviewError } from '@/utils/siteforge/review/http'
import { addClientComment } from '@/utils/siteforge/review/service'
import {
  REVIEW_SESSION_COOKIE,
  reviewSessionCookieFromRequest,
  reviewSessionCookieOptions,
} from '@/utils/siteforge/review/session'

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reviews/public/comments'
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
      'comment',
      getRateLimitKey(request, 'siteforge-client-review')
    )
    refreshedSessionCookie = access.sessionCookie
    const input = createReviewCommentSchema.parse(await request.json())
    const comment = await addClientComment(access.credential, input)
    ctx.logSuccess(201, {
      reviewSessionId: comment.review_session_id,
      reviewCommentId: comment.id,
      pagePath: comment.page_path,
      hasSectionScope: Boolean(comment.section_id),
      isThreadReply: Boolean(comment.parent_comment_id),
    })
    const response = NextResponse.json(
      { success: true, commentId: comment.id },
      { status: 201, headers }
    )
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
