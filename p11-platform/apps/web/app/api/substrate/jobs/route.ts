import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

async function loadReviewerRole(userId: string) {
  const supabase = await createClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    throw new Error('Profile not found')
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
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') || '20'), 1), 100)
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

    const serviceClient = createServiceClient()
    const { data, error } = await serviceClient
      .from('shared_jobs')
      .select(
        `
          id,
          domain,
          subject_type,
          subject_id,
          lifecycle_status,
          status_reason,
          attempt_count,
          max_attempts,
          queued_at,
          started_at,
          finished_at,
          error_message,
          created_at,
          shared_context_snapshots (
            id,
            source_domain,
            source_ref,
            created_at
          ),
          shared_action_attempts (
            id,
            action_type,
            lifecycle_status,
            proposal_decision_status,
            execution_status,
            proposed_at,
            decided_at,
            executed_at,
            error_message,
            policy_reason,
            confidence_score,
            reviewed_by,
            shared_approvals (
              id,
              decision_status,
              decision_reason,
              created_at
            ),
            shared_experiment_outcomes (
              id,
              kpi_name,
              baseline_value,
              observed_value,
              delta_value,
              outcome_status,
              measured_at
            )
          )
        `
      )
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: 'Failed to load shared substrate activity' }, { status: 500 })
    }

    return NextResponse.json({ jobs: data || [] })
  } catch (error) {
    console.error('Shared jobs GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
