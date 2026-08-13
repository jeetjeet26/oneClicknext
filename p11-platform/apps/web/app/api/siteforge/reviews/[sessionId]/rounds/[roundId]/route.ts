import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { updateRevisionRoundSchema } from '@/utils/siteforge/review/contracts'
import { safeReviewError } from '@/utils/siteforge/review/http'
import { requireSessionReviewAccess } from '@/utils/siteforge/review/internal-auth'
import { updateRevisionRound } from '@/utils/siteforge/review/service'

const idSchema = z.string().uuid()

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ sessionId: string; roundId: string }>
  }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reviews/[sessionId]/rounds/[roundId]'
  )
  ctx.logStart()
  try {
    const resolved = await params
    const sessionId = idSchema.parse(resolved.sessionId)
    const roundId = idSchema.parse(resolved.roundId)
    const input = updateRevisionRoundSchema.parse(await request.json())
    await requireSessionReviewAccess(sessionId)
    const round = await updateRevisionRound(sessionId, roundId, input)
    ctx.logSuccess(200, {
      reviewSessionId: sessionId,
      revisionRoundId: round.id,
      status: round.status,
    })
    return NextResponse.json({ round }, { headers: ctx.responseHeaders })
  } catch (error) {
    const safe = safeReviewError(error)
    ctx.logError(safe.status, error, { code: safe.code })
    return NextResponse.json(
      { error: safe.message, code: safe.code },
      { status: safe.status, headers: ctx.responseHeaders }
    )
  }
}
