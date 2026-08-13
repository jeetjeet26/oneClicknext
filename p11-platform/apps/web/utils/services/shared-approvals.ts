import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, TablesInsert, TablesUpdate } from '@/types/supabase'

export type SharedApprovalDecisionStatus = 'approved' | 'denied' | 'modified'

type ServiceClient = ReturnType<typeof createServiceClient>

type SharedApprovalPayload = Record<string, unknown>

type SharedPolicyDecisionInput = {
  policyName: string
  policyVersion?: string | null
  confidenceScore?: number | null
  decisionPayload?: SharedApprovalPayload
}

export type SharedApprovalCandidate = {
  id: string
  jobId: string
  orgId: string
  propertyId: string | null
  actionType: string
  lifecycleStatus: string
  proposalDecisionStatus: string
  executionStatus: string
  requestPayload: Json
  executionPayload: Json
  proposedAt: string
  decidedAt: string | null
  reviewedBy: string | null
  policyReason: string | null
  confidenceScore: number | null
}

export type RecordSharedApprovalDecisionInput = {
  propertyId: string
  actionAttemptId: string
  reviewerProfileId: string
  decisionStatus: SharedApprovalDecisionStatus
  decisionReason: string
  modifiedPayload?: SharedApprovalPayload | null
  decisionPayload?: SharedApprovalPayload | null
  policyDecision?: SharedPolicyDecisionInput
}

export class SharedApprovalError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'SharedApprovalError'
    this.statusCode = statusCode
  }
}

function toJson(payload: SharedApprovalPayload | null | undefined): Json {
  return ((payload || {}) as Json) ?? {}
}

function trimReason(reason: string | null | undefined): string {
  return typeof reason === 'string' ? reason.trim() : ''
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function decisionPayload(input: RecordSharedApprovalDecisionInput): Json {
  return toJson(
    input.decisionPayload ||
      (input.decisionStatus === 'modified' ? input.modifiedPayload || {} : {})
  )
}

async function recordOrResumeDecisionRows(
  input: RecordSharedApprovalDecisionInput,
  actionAttempt: {
    id: string
    job_id: string
    org_id: string
    property_id: string | null
    action_type: string
  },
  decisionReason: string,
  now: string,
  supabase: ServiceClient,
  repairExpectedUpdatedAt?: string | null
) {
  const expectedPayload = decisionPayload(input)
  const existingApprovalResult = await supabase
    .from('shared_approvals')
    .select('*')
    .eq('action_attempt_id', actionAttempt.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingApprovalResult.error) {
    throw new SharedApprovalError('Failed to reconcile approval decision', 500)
  }

  let approval = existingApprovalResult.data
  if (!approval && repairExpectedUpdatedAt) {
    const repairClaimAt = new Date(
      Math.max(Date.now(), Date.parse(repairExpectedUpdatedAt) + 1)
    ).toISOString()
    const repairClaim = await supabase
      .from('shared_action_attempts')
      .update({ updated_at: repairClaimAt })
      .eq('id', actionAttempt.id)
      .eq('proposal_decision_status', input.decisionStatus)
      .eq('reviewed_by', input.reviewerProfileId)
      .eq('updated_at', repairExpectedUpdatedAt)
      .select('id')
      .maybeSingle()
    if (repairClaim.error) {
      throw new SharedApprovalError(
        'Failed to claim approval decision reconciliation',
        500
      )
    }
    if (!repairClaim.data) {
      const concurrent = await supabase
        .from('shared_approvals')
        .select('*')
        .eq('action_attempt_id', actionAttempt.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (concurrent.error) {
        throw new SharedApprovalError(
          'Failed to reconcile approval decision',
          500
        )
      }
      if (!concurrent.data) {
        throw new SharedApprovalError(
          'Approval decision reconciliation is already in progress',
          409
        )
      }
      approval = concurrent.data
    }
  }
  if (approval) {
    if (
      approval.decision_status !== input.decisionStatus ||
      approval.reviewer_profile_id !== input.reviewerProfileId ||
      trimReason(approval.decision_reason) !== decisionReason ||
      canonicalJson(approval.decision_payload) !== canonicalJson(expectedPayload)
    ) {
      throw new SharedApprovalError(
        'Approval candidate was already decided with different decision details',
        409
      )
    }
  } else {
    const approvalInsert: TablesInsert<'shared_approvals'> = {
      action_attempt_id: actionAttempt.id,
      org_id: actionAttempt.org_id,
      property_id: actionAttempt.property_id,
      decision_status: input.decisionStatus,
      decision_reason: decisionReason,
      reviewer_profile_id: input.reviewerProfileId,
      decision_payload: expectedPayload,
      created_at: now,
    }
    const inserted = await supabase
      .from('shared_approvals')
      .insert(approvalInsert)
      .select('*')
      .single()
    if (inserted.error || !inserted.data) {
      throw new SharedApprovalError('Failed to record approval decision', 500)
    }
    approval = inserted.data
  }

  let policyDecision: {
    id: string
    policy_name: string
    decision_status: string
    decision_reason: string
  } | null = null
  if (input.policyDecision?.policyName) {
    const existingPolicy = await supabase
      .from('shared_policy_decisions')
      .select(
        'id, policy_name, policy_version, decision_status, decision_reason, confidence_score, decision_payload'
      )
      .eq('action_attempt_id', actionAttempt.id)
      .eq('policy_name', input.policyDecision.policyName)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingPolicy.error) {
      throw new SharedApprovalError('Failed to reconcile policy decision', 500)
    }
    if (existingPolicy.data) {
      if (
        existingPolicy.data.decision_status !== input.decisionStatus ||
        trimReason(existingPolicy.data.decision_reason) !== decisionReason ||
        (existingPolicy.data.policy_version ?? null) !==
          (input.policyDecision.policyVersion ?? null) ||
        (existingPolicy.data.confidence_score ?? null) !==
          (input.policyDecision.confidenceScore ?? null) ||
        canonicalJson(existingPolicy.data.decision_payload) !==
          canonicalJson(toJson(input.policyDecision.decisionPayload))
      ) {
        throw new SharedApprovalError(
          'Approval policy was already recorded with different decision details',
          409
        )
      }
      policyDecision = existingPolicy.data
    } else {
      const policyInsert: TablesInsert<'shared_policy_decisions'> = {
        org_id: actionAttempt.org_id,
        property_id: actionAttempt.property_id,
        job_id: actionAttempt.job_id,
        action_attempt_id: actionAttempt.id,
        policy_name: input.policyDecision.policyName,
        policy_version: input.policyDecision.policyVersion ?? null,
        decision_status: input.decisionStatus,
        decision_reason: decisionReason,
        confidence_score: input.policyDecision.confidenceScore ?? null,
        decision_payload: toJson(input.policyDecision.decisionPayload),
        created_at: now,
      }
      const insertedPolicy = await supabase
        .from('shared_policy_decisions')
        .insert(policyInsert)
        .select('id, policy_name, decision_status, decision_reason')
        .single()
      if (insertedPolicy.error || !insertedPolicy.data) {
        throw new SharedApprovalError('Failed to record policy decision', 500)
      }
      policyDecision = insertedPolicy.data
    }
  }

  return { approval, policyDecision }
}

export async function listPendingSharedApprovalCandidates(
  propertyId: string,
  limit = 20,
  supabase: ServiceClient = createServiceClient()
): Promise<SharedApprovalCandidate[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100)
  const { data, error } = await supabase
    .from('shared_action_attempts')
    .select(
      'id, job_id, org_id, property_id, action_type, lifecycle_status, proposal_decision_status, execution_status, request_payload, execution_payload, proposed_at, decided_at, reviewed_by, policy_reason, confidence_score'
    )
    .eq('property_id', propertyId)
    .eq('proposal_decision_status', 'proposed')
    .order('created_at', { ascending: false })
    .limit(safeLimit)

  if (error) {
    throw new SharedApprovalError('Failed to fetch approval candidates', 500)
  }

  return (data || []).map((row) => ({
    id: row.id,
    jobId: row.job_id,
    orgId: row.org_id,
    propertyId: row.property_id,
    actionType: row.action_type,
    lifecycleStatus: row.lifecycle_status,
    proposalDecisionStatus: row.proposal_decision_status,
    executionStatus: row.execution_status,
    requestPayload: row.request_payload,
    executionPayload: row.execution_payload,
    proposedAt: row.proposed_at,
    decidedAt: row.decided_at,
    reviewedBy: row.reviewed_by,
    policyReason: row.policy_reason,
    confidenceScore: row.confidence_score,
  }))
}

export async function recordSharedApprovalDecision(
  input: RecordSharedApprovalDecisionInput,
  supabase: ServiceClient = createServiceClient()
) {
  const decisionReason = trimReason(input.decisionReason)
  if (!decisionReason) {
    throw new SharedApprovalError('decisionReason is required', 400)
  }

  if (input.decisionStatus === 'modified') {
    const hasModifiedPayload =
      Boolean(input.modifiedPayload) && typeof input.modifiedPayload === 'object'
    if (!hasModifiedPayload) {
      throw new SharedApprovalError('modifiedPayload is required when decisionStatus is modified', 400)
    }
  }

  const { data: actionAttempt, error: actionAttemptError } = await supabase
    .from('shared_action_attempts')
    .select(
      'id, job_id, org_id, property_id, action_type, proposal_decision_status, request_payload, execution_payload, reviewed_by, updated_at'
    )
    .eq('id', input.actionAttemptId)
    .eq('property_id', input.propertyId)
    .single()

  if (actionAttemptError || !actionAttempt) {
    throw new SharedApprovalError('Approval candidate not found', 404)
  }

  const now = new Date().toISOString()
  if (actionAttempt.proposal_decision_status !== 'proposed') {
    if (
      actionAttempt.proposal_decision_status !== input.decisionStatus ||
      actionAttempt.reviewed_by !== input.reviewerProfileId
    ) {
      throw new SharedApprovalError('Approval candidate has already been decided', 409)
    }
    const resumed = await recordOrResumeDecisionRows(
      input,
      actionAttempt,
      decisionReason,
      now,
      supabase,
      actionAttempt.updated_at
    )
    return {
      ...resumed,
      actionAttempt: {
        id: actionAttempt.id,
        proposalDecisionStatus: input.decisionStatus,
        propertyId: actionAttempt.property_id,
        actionType: actionAttempt.action_type,
      },
    }
  }

  const actionUpdate: TablesUpdate<'shared_action_attempts'> = {
    proposal_decision_status: input.decisionStatus,
    reviewed_by: input.reviewerProfileId,
    decided_at: now,
    updated_at: now,
  }

  if (input.decisionStatus === 'denied') {
    actionUpdate.lifecycle_status = 'cancelled'
    actionUpdate.execution_status = 'cancelled'
    actionUpdate.error_message = `Denied: ${decisionReason}`
  } else {
    actionUpdate.lifecycle_status = 'queued'
    actionUpdate.execution_status = 'approved_pending_execution'
    actionUpdate.error_message = null
  }

  if (input.decisionStatus === 'modified' && input.modifiedPayload) {
    actionUpdate.execution_payload = toJson(input.modifiedPayload)
  }

  if (typeof input.policyDecision?.confidenceScore === 'number') {
    actionUpdate.confidence_score = input.policyDecision.confidenceScore
  }

  const { data: claimedAction, error: updateError } = await supabase
    .from('shared_action_attempts')
    .update(actionUpdate)
    .eq('id', input.actionAttemptId)
    .eq('proposal_decision_status', 'proposed')
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new SharedApprovalError('Failed to update approval candidate', 500)
  }
  if (!claimedAction) {
    throw new SharedApprovalError('Approval candidate was decided concurrently', 409)
  }

  const { approval, policyDecision } = await recordOrResumeDecisionRows(
    input,
    actionAttempt,
    decisionReason,
    now,
    supabase
  )

  return {
    approval,
    policyDecision,
    actionAttempt: {
      id: actionAttempt.id,
      proposalDecisionStatus: input.decisionStatus,
      propertyId: actionAttempt.property_id,
      actionType: actionAttempt.action_type,
    },
  }
}

