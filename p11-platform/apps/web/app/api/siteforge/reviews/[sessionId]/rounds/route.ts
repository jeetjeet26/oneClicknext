import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { createRevisionRoundSchema } from '@/utils/siteforge/review/contracts'
import { safeReviewError } from '@/utils/siteforge/review/http'
import { requireSessionReviewAccess } from '@/utils/siteforge/review/internal-auth'
import { createRevisionRound } from '@/utils/siteforge/review/service'

const idSchema = z.string().uuid()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reviews/[sessionId]/rounds'
  )
  ctx.logStart()
  try {
    const sessionId = idSchema.parse((await params).sessionId)
    const input = createRevisionRoundSchema.parse(await request.json())
    await requireSessionReviewAccess(sessionId)
    const round = await createRevisionRound(sessionId, input)
    ctx.logSuccess(201, {
      reviewSessionId: sessionId,
      revisionRoundId: round.id,
      roundNumber: round.round_number,
    })
    return NextResponse.json(
      { round },
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
