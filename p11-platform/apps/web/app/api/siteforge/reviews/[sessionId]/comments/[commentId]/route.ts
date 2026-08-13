import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import { updateCommentTraceSchema } from '@/utils/siteforge/review/contracts'
import { safeReviewError } from '@/utils/siteforge/review/http'
import { requireSessionReviewAccess } from '@/utils/siteforge/review/internal-auth'
import { updateCommentTrace } from '@/utils/siteforge/review/service'

const idSchema = z.string().uuid()

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ sessionId: string; commentId: string }>
  }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reviews/[sessionId]/comments/[commentId]'
  )
  ctx.logStart()
  try {
    const resolved = await params
    const sessionId = idSchema.parse(resolved.sessionId)
    const commentId = idSchema.parse(resolved.commentId)
    const input = updateCommentTraceSchema.parse(await request.json())
    await requireSessionReviewAccess(sessionId)
    const comment = await updateCommentTrace(sessionId, commentId, input)
    ctx.logSuccess(200, {
      reviewSessionId: sessionId,
      reviewCommentId: comment.id,
      traceStatus: comment.status,
      resultingArtifactId: comment.resulting_artifact_id,
    })
    return NextResponse.json({ comment }, { headers: ctx.responseHeaders })
  } catch (error) {
    const safe = safeReviewError(error)
    ctx.logError(safe.status, error, { code: safe.code })
    return NextResponse.json(
      { error: safe.message, code: safe.code },
      { status: safe.status, headers: ctx.responseHeaders }
    )
  }
}
