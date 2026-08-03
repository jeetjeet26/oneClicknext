import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  decideSiteForgePlan,
  SiteForgePlanError,
} from '@/utils/siteforge/plans/repository'
import { SharedApprovalError } from '@/utils/services/shared-approvals'

const decisionRequestSchema = z
  .object({
    propertyId: z.guid(),
    expectedRevision: z.number().int().positive(),
    contentHash: z.string().length(64),
    decisionStatus: z.enum(['approved', 'denied', 'modified']),
    decisionReason: z.string().trim().min(1).max(2_000),
    modifiedPlan: z.unknown().optional(),
  })
  .superRefine((value, context) => {
    if (value.decisionStatus === 'modified' && value.modifiedPlan === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modifiedPlan'],
        message: 'modifiedPlan is required for a modified decision',
      })
    }
  })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  try {
    const { planId } = await params
    if (!z.string().uuid().safeParse(planId).success) {
      return NextResponse.json({ error: 'Invalid plan identifier' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = decisionRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid plan decision' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (profileError || !profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json({ error: 'Approval permission required' }, { status: 403 })
    }

    const result = await decideSiteForgePlan({
      planId,
      propertyId: parsed.data.propertyId,
      expectedRevision: parsed.data.expectedRevision,
      contentHash: parsed.data.contentHash,
      reviewerProfileId: user.id,
      decisionStatus: parsed.data.decisionStatus,
      decisionReason: parsed.data.decisionReason,
      modifiedPlan: parsed.data.modifiedPlan,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof SiteForgePlanError || error instanceof SharedApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('SiteForge plan decision error:', error)
    return NextResponse.json({ error: 'Failed to record plan decision' }, { status: 500 })
  }
}
