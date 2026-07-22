import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { isManagerRole, loadProfileRole } from '@/utils/reviewflow/access'
import {
  ReviewAiError,
  buildResponseGrounding,
  generateReviewResponse,
  type ResponseTone,
} from '@/utils/reviewflow/ai'
import { evaluateReviewPolicy } from '@/utils/reviewflow/policy'
import { transitionCaseForReview } from '@/utils/reviewflow/cases'
import {
  SharedExecutorApprovalRequiredError,
  executeExistingSharedJob,
  runSharedExecutorJob,
} from '@/utils/services/shared-executor'
import { SharedApprovalError, recordSharedApprovalDecision } from '@/utils/services/shared-approvals'
import { recordSharedOutcome } from '@/utils/services/shared-outcomes'
import {
  ProviderExecutionError,
  getProviderCapabilities,
  getProviderDeepLink,
  postGoogleReply,
  resolveGbpReviewName,
} from '@/utils/reviewflow/providers'

function parseTone(value: unknown, fallback: ResponseTone = 'professional'): ResponseTone {
  if (value === 'professional' || value === 'empathetic' || value === 'friendly' || value === 'apologetic') {
    return value
  }
  return fallback
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ---------------------------------------------------------------------------
// POST — generate a response draft (idempotent per active draft)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { reviewId, tone = 'professional', regenerate = false } = body

  if (!reviewId) {
    return NextResponse.json({ error: 'reviewId is required' }, { status: 400 })
  }

  // Fetch the review with property info
  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .select(`
      *,
      properties (
        name,
        org_id
      )
    `)
    .eq('id', reviewId)
    .single()

  if (reviewError || !review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  if (typeof review.property_id !== 'string') {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  }

  const access = await validatePropertyAccess(user.id, review.property_id)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceClient()

  // Idempotent generation: reuse the active draft unless regeneration is
  // explicitly requested.
  const { data: activeDraft } = await service
    .from('review_responses')
    .select('*')
    .eq('review_id', reviewId)
    .eq('status', 'draft')
    .is('superseded_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeDraft && !regenerate) {
    return NextResponse.json({
      response: activeDraft,
      responseText: activeDraft.response_text,
      reused: true,
    })
  }

  // Fetch ReviewFlow config + latest intelligence for grounding and policy.
  const [{ data: config }, { data: latestAnalysis }, grounding] = await Promise.all([
    service
      .from('reviewflow_config')
      .select('property_personality, default_tone')
      .eq('property_id', review.property_id)
      .maybeSingle(),
    service
      .from('review_analyses')
      .select('policy_class, is_urgent, confidence, risk_class')
      .eq('review_id', reviewId)
      .eq('status', 'completed')
      .order('analysis_version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    buildResponseGrounding(createServiceClient(), review.property_id),
  ])

  const policy = evaluateReviewPolicy({
    reviewText: review.review_text || '',
    modelPolicyClass:
      latestAnalysis?.policy_class &&
      typeof latestAnalysis.policy_class === 'string'
        ? (latestAnalysis.policy_class as never)
        : null,
    modelConfidence: latestAnalysis?.confidence ?? null,
    riskClass:
      latestAnalysis?.risk_class && typeof latestAnalysis.risk_class === 'string'
        ? (latestAnalysis.risk_class as never)
        : null,
  })

  const resolvedTone = parseTone(tone, parseTone(config?.default_tone))

  let generated
  try {
    generated = await generateReviewResponse({
      reviewText: review.review_text || '',
      rating: typeof review.rating === 'number' ? review.rating : null,
      sentiment: review.sentiment || 'neutral',
      topics: Array.isArray(review.topics)
        ? review.topics.filter((topic): topic is string => typeof topic === 'string')
        : [],
      tone: resolvedTone,
      reviewerName: review.reviewer_name || undefined,
      grounding: {
        ...grounding,
        propertyPersonality: config?.property_personality ?? grounding.propertyPersonality,
      },
      policyClass: policy.policyClass,
      isUrgent: Boolean(latestAnalysis?.is_urgent || review.is_urgent),
    })
  } catch (aiError) {
    if (aiError instanceof ReviewAiError) {
      return NextResponse.json(
        {
          error: 'Response generation failed',
          details: aiError.message,
          kind: aiError.kind,
          manualReviewRequired: true,
        },
        { status: aiError.kind === 'provider_unavailable' ? 503 : 422 }
      )
    }
    console.error('Response generation error:', aiError)
    return NextResponse.json(
      { error: aiError instanceof Error ? aiError.message : 'Failed to generate AI response' },
      { status: 500 }
    )
  }

  // Supersede any previous active draft (regeneration path).
  if (activeDraft) {
    await service
      .from('review_responses')
      .update({ superseded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', activeDraft.id)
  }

  // Create the shared action proposal for this public response. The executor
  // throws SharedExecutorApprovalRequiredError by design: the proposal waits
  // in the ledger until an operator decides.
  let sharedActionAttemptId: string | null = null
  const orgId = review.properties?.org_id
  if (typeof orgId === 'string' && orgId.length > 0) {
    try {
      await runSharedExecutorJob({
        orgId,
        propertyId: review.property_id,
        domain: 'reviewflow.respond',
        subjectType: 'review',
        subjectId: reviewId,
        requestedBy: user.id,
        payload: {
          reviewId,
          platform: review.platform,
          tone: resolvedTone,
        },
        action: {
          actionType: 'reviewflow_public_response',
          proposalDecisionStatus: 'proposed',
          policyReason: policy.reasons.join(' '),
          confidenceScore: latestAnalysis?.confidence ?? null,
          requestPayload: {
            reviewId,
            platform: review.platform,
            policyClass: policy.policyClass,
            requiresHumanReview: policy.requiresHumanReview,
          },
          executionPayload: {
            responseText: generated.responseText,
            usedFacts: generated.usedFacts,
            model: generated.provenance.model,
            promptVersion: generated.provenance.promptVersion,
          },
        },
        execute: async () => null,
      })
    } catch (error) {
      if (error instanceof SharedExecutorApprovalRequiredError) {
        sharedActionAttemptId = error.sharedActionAttemptId
      } else {
        console.error('Failed to create shared response proposal:', error)
      }
    }
  }

  // Save the generated response with full provenance.
  const { data: savedResponse, error: saveError } = await service
    .from('review_responses')
    .insert({
      review_id: reviewId,
      response_text: generated.responseText,
      response_type: 'ai_generated',
      status: 'draft',
      tone: resolvedTone,
      ai_model: generated.provenance.model,
      generation_prompt: JSON.stringify({
        promptVersion: generated.provenance.promptVersion,
        taxonomyVersion: generated.provenance.taxonomyVersion,
        policyClass: policy.policyClass,
        policyVersion: policy.policyVersion,
        requiresHumanReview: policy.requiresHumanReview,
        usedFacts: generated.usedFacts,
      }),
      created_by: user.id,
      shared_action_attempt_id: sharedActionAttemptId,
    })
    .select()
    .single()

  if (saveError) {
    console.error('Error saving response:', saveError)
    return NextResponse.json({ error: saveError.message }, { status: 500 })
  }

  // Update review + case workflow state.
  await service
    .from('reviews')
    .update({
      response_status: 'draft_ready',
      updated_at: new Date().toISOString()
    })
    .eq('id', reviewId)

  await transitionCaseForReview(service, reviewId, {
    status: 'awaiting_approval',
    eventType: 'response_drafted',
    actorProfileId: user.id,
    payload: {
      responseId: savedResponse.id,
      model: generated.provenance.model,
      tone: resolvedTone,
      policyClass: policy.policyClass,
      requiresHumanReview: policy.requiresHumanReview,
    },
  })

  return NextResponse.json({
    response: savedResponse,
    responseText: generated.responseText,
    policy: {
      policyClass: policy.policyClass,
      requiresHumanReview: policy.requiresHumanReview,
      reasons: policy.reasons,
    },
    provenance: generated.provenance,
  })
}

// ---------------------------------------------------------------------------
// PATCH — approve / reject / post with mandatory rationale
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const body = await request.json()

  const { responseId, action, editedText } = body
  const decisionReason = normalizeOptionalString(body.decisionReason ?? body.reason)

  if (!responseId || !action) {
    return NextResponse.json({ error: 'responseId and action are required' }, { status: 400 })
  }

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: existingResponse, error: existingResponseError } = await supabase
    .from('review_responses')
    .select(`
      id,
      review_id,
      status,
      response_text,
      shared_action_attempt_id,
      platform_response_id,
      provider_post_url,
      posting_mode,
      posted_at,
      reviews (
        id,
        platform,
        property_id,
        platform_review_id,
        raw_data
      )
    `)
    .eq('id', responseId)
    .single()

  if (existingResponseError || !existingResponse) {
    return NextResponse.json({ error: 'Response not found' }, { status: 404 })
  }

  const responseReview = Array.isArray(existingResponse.reviews)
    ? existingResponse.reviews[0]
    : existingResponse.reviews
  const responsePropertyId = responseReview?.property_id
  if (typeof responsePropertyId !== 'string') {
    return NextResponse.json({ error: 'Response not found' }, { status: 404 })
  }

  const access = await validatePropertyAccess(user.id, responsePropertyId)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const role = await loadProfileRole(user.id)
  if (!isManagerRole(role)) {
    return NextResponse.json(
      { error: 'Manager or admin role is required to decide on responses' },
      { status: 403 }
    )
  }

  const service = createServiceClient()
  const reviewId = typeof existingResponse.review_id === 'string' ? existingResponse.review_id : null
  const nowIso = new Date().toISOString()

  const recordApprovalDecision = async (
    decisionStatus: 'approved' | 'denied' | 'modified',
    modifiedPayload?: Record<string, unknown>
  ) => {
    if (!existingResponse.shared_action_attempt_id || !decisionReason) return
    try {
      await recordSharedApprovalDecision({
        propertyId: responsePropertyId,
        actionAttemptId: existingResponse.shared_action_attempt_id,
        reviewerProfileId: user.id,
        decisionStatus,
        decisionReason,
        modifiedPayload,
      })
    } catch (error) {
      if (error instanceof SharedApprovalError && error.statusCode === 409) {
        // Already decided (idempotent replays) — domain state remains source of truth.
        return
      }
      console.error('Failed to record shared approval decision:', error)
    }
  }

  if (action === 'approve') {
    if (existingResponse.status !== 'draft') {
      return NextResponse.json(
        { error: `Only draft responses can be approved (current status: ${existingResponse.status})` },
        { status: 409 }
      )
    }
    if (!decisionReason) {
      return NextResponse.json(
        { error: 'decisionReason is required to approve a response' },
        { status: 400 }
      )
    }

    const trimmedEdit = normalizeOptionalString(editedText)
    const isModification = Boolean(trimmedEdit && trimmedEdit !== existingResponse.response_text)

    let approvedResponseId = existingResponse.id

    if (isModification && trimmedEdit) {
      // Preserve the original proposal; the operator modification becomes a
      // new versioned response row.
      const { data: modifiedRow, error: modifyError } = await service
        .from('review_responses')
        .insert({
          review_id: reviewId,
          response_text: trimmedEdit,
          response_type: 'human_written',
          status: 'approved',
          tone: null,
          approved_by: user.id,
          approved_at: nowIso,
          decision_reason: decisionReason,
          created_by: user.id,
          shared_action_attempt_id: existingResponse.shared_action_attempt_id,
        })
        .select('id')
        .single()

      if (modifyError || !modifiedRow) {
        return NextResponse.json(
          { error: modifyError?.message || 'Failed to save modified response' },
          { status: 500 }
        )
      }
      approvedResponseId = modifiedRow.id

      await service
        .from('review_responses')
        .update({ superseded_at: nowIso, updated_at: nowIso })
        .eq('id', existingResponse.id)

      await recordApprovalDecision('modified', { responseText: trimmedEdit })
    } else {
      const { error } = await service
        .from('review_responses')
        .update({
          status: 'approved',
          approved_by: user.id,
          approved_at: nowIso,
          decision_reason: decisionReason,
          updated_at: nowIso,
        })
        .eq('id', responseId)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      await recordApprovalDecision('approved')
    }

    if (reviewId) {
      await service
        .from('reviews')
        .update({
          response_status: 'approved',
          updated_at: nowIso,
        })
        .eq('id', reviewId)

      await transitionCaseForReview(service, reviewId, {
        status: 'ready_to_post',
        eventType: isModification ? 'response_modified_and_approved' : 'response_approved',
        actorProfileId: user.id,
        payload: { responseId: approvedResponseId, decisionReason },
      })
    }

    return NextResponse.json({
      success: true,
      status: 'approved',
      responseId: approvedResponseId,
      modified: isModification,
    })
  }

  if (action === 'reject') {
    if (!['draft', 'approved'].includes(existingResponse.status || '')) {
      return NextResponse.json(
        { error: `Only draft or approved responses can be rejected (current status: ${existingResponse.status})` },
        { status: 409 }
      )
    }
    if (!decisionReason) {
      return NextResponse.json(
        { error: 'decisionReason is required to reject a response' },
        { status: 400 }
      )
    }

    const { error } = await service
      .from('review_responses')
      .update({
        status: 'rejected',
        rejected_reason: decisionReason,
        decision_reason: decisionReason,
        updated_at: nowIso,
      })
      .eq('id', responseId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await recordApprovalDecision('denied')

    if (reviewId) {
      await service
        .from('reviews')
        .update({ response_status: 'pending', updated_at: nowIso })
        .eq('id', reviewId)

      await transitionCaseForReview(service, reviewId, {
        status: 'triaged',
        eventType: 'response_rejected',
        actorProfileId: user.id,
        payload: { responseId, decisionReason },
      })
    }

    return NextResponse.json({ success: true, status: 'rejected' })
  }

  if (action === 'post') {
    // Idempotent: an already-posted response returns its existing evidence.
    if (existingResponse.status === 'posted') {
      return NextResponse.json({
        success: true,
        status: 'posted',
        alreadyPosted: true,
        postingMode: existingResponse.posting_mode,
        providerEvidence: {
          providerPostId: existingResponse.platform_response_id,
          providerPostUrl: existingResponse.provider_post_url,
        },
      })
    }

    if (existingResponse.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only approved responses can be posted' },
        { status: 409 }
      )
    }

    if (!reviewId) {
      return NextResponse.json({ error: 'Response review is missing context' }, { status: 409 })
    }

    const reviewPlatform = typeof responseReview?.platform === 'string' ? responseReview.platform : 'unknown'

    const { data: connection } = await service
      .from('review_platform_connections')
      .select('*')
      .eq('property_id', responsePropertyId)
      .eq('platform', reviewPlatform)
      .eq('is_active', true)
      .maybeSingle()

    const capabilities = getProviderCapabilities(connection, {
      platform_review_id: responseReview?.platform_review_id,
      raw_data: responseReview?.raw_data,
    })

    const finalizePosted = async (evidence: {
      providerPostId: string | null
      providerPostUrl: string | null
      providerNotes: string | null
      postingMode: 'manual_confirmed' | 'provider_api'
      verified: boolean
    }) => {
      const { error: updateError } = await service
        .from('review_responses')
        .update({
          status: 'posted',
          posted_at: nowIso,
          posted_by: user.id,
          posting_mode: evidence.postingMode,
          platform_response_id: evidence.providerPostId,
          provider_post_url: evidence.providerPostUrl,
          provider_notes: evidence.providerNotes,
          updated_at: nowIso,
        })
        .eq('id', responseId)

      if (updateError) {
        throw new Error(updateError.message)
      }

      await service
        .from('reviews')
        .update({ response_status: 'posted', updated_at: nowIso })
        .eq('id', reviewId)

      await transitionCaseForReview(service, reviewId, {
        status: 'resolved',
        eventType: 'response_posted',
        actorProfileId: user.id,
        resolutionNotes: `Response posted (${evidence.postingMode})`,
        payload: {
          responseId,
          postingMode: evidence.postingMode,
          providerPostId: evidence.providerPostId,
          providerPostUrl: evidence.providerPostUrl,
          verified: evidence.verified,
        },
      })

      if (existingResponse.shared_action_attempt_id) {
        try {
          await recordSharedOutcome({
            propertyId: responsePropertyId,
            actionAttemptId: existingResponse.shared_action_attempt_id,
            kpiName: 'reviewflow_response_posted',
            observedValue: 1,
            outcomeStatus: 'unknown',
            attributionPayload: {
              postingMode: evidence.postingMode,
              verified: evidence.verified,
              platform: reviewPlatform,
            },
          })
        } catch (error) {
          console.error('Failed to record shared outcome for posted response:', error)
        }
      }

      return evidence
    }

    const runThroughLedger = async <T>(execute: () => Promise<T>): Promise<T> => {
      // Execute through the shared action ledger when the proposal exists.
      if (existingResponse.shared_action_attempt_id) {
        const { data: attempt } = await service
          .from('shared_action_attempts')
          .select('id, job_id, proposal_decision_status')
          .eq('id', existingResponse.shared_action_attempt_id)
          .single()

        if (attempt?.job_id && ['approved', 'modified'].includes(attempt.proposal_decision_status || '')) {
          return executeExistingSharedJob({
            sharedJobId: attempt.job_id,
            sharedActionAttemptId: attempt.id,
            execute,
            statusReason: 'provider_execution',
          })
        }
      }
      return execute()
    }

    // Provider-API path: capability-gated Google Business Profile reply.
    if (capabilities.reply && reviewPlatform === 'google' && connection?.access_token) {
      const reviewName = resolveGbpReviewName({
        platform_review_id: responseReview?.platform_review_id,
        raw_data: responseReview?.raw_data,
      })
      if (reviewName) {
        try {
          const result = await runThroughLedger(async () => {
            const reply = await postGoogleReply({
              accessToken: connection.access_token as string,
              reviewName,
              responseText: existingResponse.response_text || '',
            })
            return finalizePosted({
              providerPostId: reply.providerPostId,
              providerPostUrl: reply.providerPostUrl,
              providerNotes: null,
              postingMode: 'provider_api',
              verified: reply.verified,
            })
          })

          return NextResponse.json({
            success: true,
            status: 'posted',
            postingMode: 'provider_api',
            verified: result.verified,
            providerEvidence: {
              providerPostId: result.providerPostId,
              providerPostUrl: result.providerPostUrl,
            },
          })
        } catch (error) {
          if (error instanceof ProviderExecutionError) {
            return NextResponse.json(
              {
                error: `Provider posting failed: ${error.message}`,
                retryable: error.retryable,
                fallback: 'manual_confirmed',
                deepLink: getProviderDeepLink(reviewPlatform, connection),
              },
              { status: error.retryable ? 502 : 422 }
            )
          }
          throw error
        }
      }
    }

    // Manual-confirmation path: operator posts externally and confirms with
    // structured evidence. This is honest manual execution, not fake success.
    if (body.manualConfirmed !== true) {
      return NextResponse.json(
        {
          error: 'manualConfirmed is required to mark a response as posted',
          capabilities,
          deepLink: getProviderDeepLink(reviewPlatform, connection),
        },
        { status: 400 }
      )
    }

    const providerPostId = normalizeOptionalString(body.providerPostId)
    const providerPostUrl = normalizeOptionalString(body.providerPostUrl)
    const providerNotes = normalizeOptionalString(body.providerNotes)

    if (!providerPostId && !providerPostUrl) {
      return NextResponse.json(
        { error: 'providerPostId or providerPostUrl is required to confirm provider-side execution' },
        { status: 400 }
      )
    }

    try {
      const result = await runThroughLedger(() =>
        finalizePosted({
          providerPostId,
          providerPostUrl,
          providerNotes,
          postingMode: 'manual_confirmed',
          verified: false,
        })
      )

      return NextResponse.json({
        success: true,
        status: 'posted',
        postingMode: 'manual_confirmed',
        providerEvidence: {
          providerPostId: result.providerPostId,
          providerPostUrl: result.providerPostUrl,
        },
      })
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to record posted response' },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
