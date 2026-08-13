import { NextRequest, NextResponse } from 'next/server'
import { getRateLimitKey } from '@/utils/services/rate-limiter'
import { exchangeReviewToken } from '@/utils/siteforge/review/access'
import { safeReviewError } from '@/utils/siteforge/review/http'
import {
  REVIEW_SESSION_COOKIE,
  reviewSessionCookieOptions,
} from '@/utils/siteforge/review/session'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  try {
    const access = await exchangeReviewToken(
      token,
      getRateLimitKey(request, 'siteforge-client-review')
    )
    const response = NextResponse.redirect(
      new URL('/siteforge-review', request.url),
      303
    )
    response.cookies.set(
      REVIEW_SESSION_COOKIE,
      access.sessionCookie,
      reviewSessionCookieOptions()
    )
    response.headers.set('Cache-Control', 'private, no-store, max-age=0')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch (error) {
    const safe = safeReviewError(error)
    return NextResponse.json(
      { error: safe.message, code: safe.code },
      {
        status: safe.status,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'Referrer-Policy': 'no-referrer',
        },
      }
    )
  }
}
