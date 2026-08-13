import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { SharedApprovalError } from '@/utils/services/shared-approvals'
import {
  decideSiteForgeCreativeDirection,
  SiteForgeDirectionError,
} from '@/utils/siteforge/directions/repository'

const decisionSchema = z
  .object({
    propertyId: z.guid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    selectedDirectionId: z.string().uuid(),
    decisionStatus: z.enum(['approved', 'denied', 'modified']),
    decisionReason: z.string().trim().min(1).max(2_000),
    modifiedDirection: z.unknown().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.decisionStatus === 'modified' &&
      value.modifiedDirection === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modifiedDirection'],
        message: 'modifiedDirection is required for a modified decision',
      })
    }
  })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ directionSetId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/directions/[directionSetId]/decision'
  )
  ctx.logStart()
  try {
    const { directionSetId } = await params
    if (!z.string().uuid().safeParse(directionSetId).success) {
      return NextResponse.json(
        { error: 'Invalid creative direction set identifier' },
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
        { error: 'Invalid creative direction decision' },
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
    const result = await decideSiteForgeCreativeDirection({
      directionSetId,
      propertyId: parsed.data.propertyId,
      reviewerProfileId: user.id,
      contentHash: parsed.data.contentHash,
      selectedDirectionId: parsed.data.selectedDirectionId,
      decisionStatus: parsed.data.decisionStatus,
      decisionReason: parsed.data.decisionReason,
      modifiedDirection: parsed.data.modifiedDirection,
    })
    ctx.logSuccess(200, {
      directionSetId,
      propertyId: parsed.data.propertyId,
      decisionStatus: parsed.data.decisionStatus,
    })
    return NextResponse.json(
      { success: true, ...result },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeDirectionError ||
      error instanceof SharedApprovalError
        ? error.statusCode
        : error instanceof z.ZodError
          ? 400
          : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeDirectionError ||
          error instanceof SharedApprovalError
            ? error.message
            : status === 400
              ? 'Modified creative direction is invalid'
              : 'Failed to record creative direction decision',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
