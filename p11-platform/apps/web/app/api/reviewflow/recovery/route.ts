import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

/**
 * GET /api/reviewflow/recovery?propertyId=...
 *
 * Recovery queue for provider execution: surfaces responses whose provider
 * posting failed, stalled, or completed with uncertain evidence so operators
 * can retry (the post action is idempotent) or confirm manually.
 */

const STUCK_APPROVED_HOURS = 24

type RecoveryItem = {
  kind: 'failed_execution' | 'stuck_approved' | 'unverified_post'
  responseId: string
  reviewId: string | null
  platform: string | null
  status: string | null
  reason: string
  occurredAt: string | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const service = createServiceClient()
    const items: RecoveryItem[] = []

    // 1) Provider executions that failed in the shared action ledger.
    const { data: failedAttempts } = await service
      .from('shared_action_attempts')
      .select('id, execution_status, error_message, executed_at, updated_at')
      .eq('property_id', propertyId)
      .eq('action_type', 'reviewflow_public_response')
      .eq('execution_status', 'failed')

    const failedAttemptIds = (failedAttempts || []).map((a) => a.id)
    if (failedAttemptIds.length > 0) {
      const { data: failedResponses } = await service
        .from('review_responses')
        .select('id, review_id, status, shared_action_attempt_id, reviews!inner(platform, property_id)')
        .in('shared_action_attempt_id', failedAttemptIds)
        .neq('status', 'posted')

      for (const response of failedResponses || []) {
        const attempt = (failedAttempts || []).find(
          (a) => a.id === response.shared_action_attempt_id
        )
        const review = Array.isArray(response.reviews) ? response.reviews[0] : response.reviews
        items.push({
          kind: 'failed_execution',
          responseId: response.id,
          reviewId: response.review_id,
          platform: (review?.platform as string | null) ?? null,
          status: response.status,
          reason: attempt?.error_message || 'Provider execution failed',
          occurredAt: attempt?.executed_at || attempt?.updated_at || null,
        })
      }
    }

    // 2) Approved responses that never made it to posted within the window.
    const stuckCutoff = new Date(Date.now() - STUCK_APPROVED_HOURS * 60 * 60 * 1000).toISOString()
    const { data: stuckApproved } = await service
      .from('review_responses')
      .select('id, review_id, status, approved_at, reviews!inner(platform, property_id)')
      .eq('reviews.property_id', propertyId)
      .eq('status', 'approved')
      .is('superseded_at', null)
      .lt('approved_at', stuckCutoff)

    for (const response of stuckApproved || []) {
      const review = Array.isArray(response.reviews) ? response.reviews[0] : response.reviews
      items.push({
        kind: 'stuck_approved',
        responseId: response.id,
        reviewId: response.review_id,
        platform: (review?.platform as string | null) ?? null,
        status: response.status,
        reason: `Approved more than ${STUCK_APPROVED_HOURS}h ago but not posted`,
        occurredAt: response.approved_at,
      })
    }

    // 3) Provider-API posts without verifiable provider evidence.
    const { data: unverified } = await service
      .from('review_responses')
      .select('id, review_id, status, posted_at, posting_mode, platform_response_id, reviews!inner(platform, property_id)')
      .eq('reviews.property_id', propertyId)
      .eq('status', 'posted')
      .eq('posting_mode', 'provider_api')
      .is('platform_response_id', null)

    for (const response of unverified || []) {
      const review = Array.isArray(response.reviews) ? response.reviews[0] : response.reviews
      items.push({
        kind: 'unverified_post',
        responseId: response.id,
        reviewId: response.review_id,
        platform: (review?.platform as string | null) ?? null,
        status: response.status,
        reason: 'Posted via provider API but no provider response ID was recorded',
        occurredAt: response.posted_at,
      })
    }

    return NextResponse.json({
      items,
      counts: {
        failed_execution: items.filter((i) => i.kind === 'failed_execution').length,
        stuck_approved: items.filter((i) => i.kind === 'stuck_approved').length,
        unverified_post: items.filter((i) => i.kind === 'unverified_post').length,
      },
    })
  } catch (error) {
    console.error('ReviewFlow GET /recovery error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
