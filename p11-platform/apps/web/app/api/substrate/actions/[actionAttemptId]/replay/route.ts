import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { SharedDispatchError, resumeSharedActionAttempt } from '@/utils/services/shared-dispatcher'

async function loadReviewerRole(userId: string) {
  const supabase = await createClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    throw new SharedDispatchError('Profile not found', 404)
  }

  return profile.role || ''
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ actionAttemptId: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const reviewerRole = await loadReviewerRole(user.id)
    if (!['admin', 'manager'].includes(reviewerRole)) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const { actionAttemptId } = await context.params
    if (!actionAttemptId) {
      return NextResponse.json({ error: 'actionAttemptId is required' }, { status: 400 })
    }

    const serviceClient = createServiceClient()
    const { data: actionAttempt, error: actionError } = await serviceClient
      .from('shared_action_attempts')
      .select('property_id')
      .eq('id', actionAttemptId)
      .single()

    if (actionError || !actionAttempt?.property_id) {
      return NextResponse.json({ error: 'Shared action attempt not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, actionAttempt.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await resumeSharedActionAttempt(actionAttemptId, 'replay')
    return NextResponse.json({ success: true, result })
  } catch (error) {
    if (error instanceof SharedDispatchError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    console.error('Shared replay error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
