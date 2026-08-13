import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { SharedApprovalError } from '@/utils/services/shared-approvals'
import {
  decideSiteForgeBrief,
  SiteForgeBriefError,
} from '@/utils/siteforge/briefs/repository'

const decisionSchema = z
  .object({
    propertyId: z.guid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    decisionStatus: z.enum(['approved', 'denied', 'modified']),
    decisionReason: z.string().trim().min(1).max(2_000),
    modifiedBrief: z.unknown().optional(),
    unresolvedContradictions: z.unknown().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.decisionStatus === 'modified' &&
      value.modifiedBrief === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modifiedBrief'],
        message: 'modifiedBrief is required for a modified decision',
      })
    }
  })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ briefVersionId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/briefs/[briefVersionId]/decision'
  )
  ctx.logStart()
  try {
    const { briefVersionId } = await params
    if (!z.string().uuid().safeParse(briefVersionId).success) {
      return NextResponse.json(
        { error: 'Invalid brief version identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const parsed = decisionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid brief decision' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (
      profileError ||
      !profile ||
      !['admin', 'manager'].includes(profile.role || '')
    ) {
      return NextResponse.json(
        { error: 'Approval permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const result = await decideSiteForgeBrief({
      briefVersionId,
      propertyId: parsed.data.propertyId,
      reviewerProfileId: user.id,
      contentHash: parsed.data.contentHash,
      decisionStatus: parsed.data.decisionStatus,
      decisionReason: parsed.data.decisionReason,
      modifiedBrief: parsed.data.modifiedBrief,
      unresolvedContradictions: parsed.data.unresolvedContradictions,
    })
    ctx.logSuccess(200, {
      briefVersionId,
      propertyId: parsed.data.propertyId,
      decisionStatus: parsed.data.decisionStatus,
    })
    return NextResponse.json(
      { success: true, ...result },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeBriefError ||
      error instanceof SharedApprovalError
        ? error.statusCode
        : error instanceof z.ZodError
          ? 400
          : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeBriefError ||
          error instanceof SharedApprovalError
            ? error.message
            : status === 400
              ? 'Modified brief content is invalid'
              : 'Failed to record brief decision',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
