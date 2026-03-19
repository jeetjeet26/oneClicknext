import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  SharedApprovalError,
  listPendingSharedApprovalCandidates,
  recordSharedApprovalDecision,
  type SharedApprovalDecisionStatus,
} from '@/utils/services/shared-approvals'
import { SharedDispatchError, resumeSharedActionAttempt } from '@/utils/services/shared-dispatcher'

type ApprovalDecisionRequest = {
  propertyId: string
  actionAttemptId: string
  decisionStatus: SharedApprovalDecisionStatus
  decisionReason: string
  modifiedPayload?: Record<string, unknown>
  decisionPayload?: Record<string, unknown>
  policyDecision?: {
    policyName: string
    policyVersion?: string | null
    confidenceScore?: number | null
    decisionPayload?: Record<string, unknown>
  }
  executeNow?: boolean
}

async function loadReviewerRole(userId: string) {
  const supabase = await createClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  if (error || !profile) {
    throw new SharedApprovalError('Profile not found', 404)
  }
  return profile.role || ''
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = new URL(request.url).searchParams.get('propertyId')
    const limit = Number(new URL(request.url).searchParams.get('limit') || '20')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const reviewerRole = await loadReviewerRole(user.id)
    if (!['admin', 'manager'].includes(reviewerRole)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const approvals = await listPendingSharedApprovalCandidates(propertyId, limit)
    return NextResponse.json({ approvals })
  } catch (error) {
    if (error instanceof SharedApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Shared approvals GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as ApprovalDecisionRequest
    if (!body.propertyId || !body.actionAttemptId || !body.decisionStatus) {
      return NextResponse.json(
        { error: 'propertyId, actionAttemptId, and decisionStatus are required' },
        { status: 400 }
      )
    }

    const reviewerRole = await loadReviewerRole(user.id)
    if (!['admin', 'manager'].includes(reviewerRole)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const access = await validatePropertyAccess(user.id, body.propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await recordSharedApprovalDecision({
      propertyId: body.propertyId,
      actionAttemptId: body.actionAttemptId,
      reviewerProfileId: user.id,
      decisionStatus: body.decisionStatus,
      decisionReason: body.decisionReason,
      modifiedPayload: body.modifiedPayload,
      decisionPayload: body.decisionPayload,
      policyDecision: body.policyDecision,
    })

    let executionResult: unknown = null
    if (body.executeNow !== false && ['approved', 'modified'].includes(body.decisionStatus)) {
      try {
        executionResult = await resumeSharedActionAttempt(body.actionAttemptId, 'resume')
      } catch (error) {
        if (error instanceof SharedDispatchError) {
          return NextResponse.json(
            {
              success: false,
              approvalRecorded: true,
              error: error.message,
              ...result,
            },
            { status: error.statusCode }
          )
        }
        throw error
      }
    }

    return NextResponse.json({ success: true, executionResult, ...result })
  } catch (error) {
    if (error instanceof SharedApprovalError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Shared approvals POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

