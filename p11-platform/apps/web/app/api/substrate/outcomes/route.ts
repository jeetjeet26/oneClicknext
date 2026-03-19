import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { recordSharedOutcome, SharedOutcomeError } from '@/utils/services/shared-outcomes'

type SharedOutcomeRequest = {
  propertyId: string
  actionAttemptId: string
  kpiName: string
  baselineValue?: number | null
  observedValue?: number | null
  deltaValue?: number | null
  outcomeStatus?: 'unknown' | 'positive' | 'neutral' | 'negative'
  measurementWindowStart?: string | null
  measurementWindowEnd?: string | null
  attributionPayload?: Record<string, unknown>
}

async function loadReviewerRole(userId: string) {
  const supabase = await createClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    throw new SharedOutcomeError('Profile not found', 404)
  }

  return profile.role || ''
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

    const body = (await request.json()) as SharedOutcomeRequest
    if (!body.propertyId || !body.actionAttemptId || !body.kpiName) {
      return NextResponse.json(
        { error: 'propertyId, actionAttemptId, and kpiName are required' },
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

    const outcome = await recordSharedOutcome(body)
    return NextResponse.json({ success: true, outcome })
  } catch (error) {
    if (error instanceof SharedOutcomeError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    console.error('Shared outcomes POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
