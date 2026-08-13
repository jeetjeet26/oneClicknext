import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { issueReviewTokenSchema } from '@/utils/siteforge/review/contracts'
import { safeReviewError } from '@/utils/siteforge/review/http'
import { requireSessionReviewAccess } from '@/utils/siteforge/review/internal-auth'
import {
  issueReviewToken,
  revokeReviewToken,
} from '@/utils/siteforge/review/service'

const idSchema = z.string().uuid()
const revokeSchema = z.object({ tokenId: idSchema }).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reviews/[sessionId]/tokens'
  )
  ctx.logStart()
  try {
    const sessionId = idSchema.parse((await params).sessionId)
    const input = issueReviewTokenSchema.parse(await request.json())
    const { userId } = await requireSessionReviewAccess(sessionId)
    const issued = await issueReviewToken(sessionId, input, userId)
    ctx.logSuccess(201, {
      reviewSessionId: sessionId,
      reviewTokenId: issued.token.id,
      permissions: issued.token.permissions,
    })
    return NextResponse.json(
      {
        token: issued.token,
        reviewPath: `/siteforge-review/${encodeURIComponent(issued.rawToken)}`,
        warning:
          'This credential is shown once. Store and share the review link securely.',
      },
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reviews/[sessionId]/tokens'
  )
  ctx.logStart()
  try {
    const sessionId = idSchema.parse((await params).sessionId)
    const input = revokeSchema.parse(await request.json())
    await requireSessionReviewAccess(sessionId)
    const token = await revokeReviewToken(sessionId, input.tokenId)
    ctx.logSuccess(200, {
      reviewSessionId: sessionId,
      reviewTokenId: token.id,
      action: 'revoked',
    })
    return NextResponse.json(
      { success: true, revokedAt: token.revoked_at },
      { headers: ctx.responseHeaders }
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
