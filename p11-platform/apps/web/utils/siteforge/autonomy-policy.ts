import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'

export const SITEFORGE_AUTONOMY_MODES = [
  'observe_only',
  'recommend',
  'supervised',
  'bounded_auto',
] as const
export type SiteForgeAutonomyMode = (typeof SITEFORGE_AUTONOMY_MODES)[number]

export type AutonomyPromotionEvidence = {
  evaluatedRuns: number
  completedJobs: number
  supervisedSuccesses: number
  approvalDecisions: number
  incidentCount: number
  incidentRate: number
  rollbackVerified: boolean
  restoreEvidenceRuns: number
  providerEvidenceRuns: number
  renderedEvidenceRuns: number
  outcomeMeasurements: number
  negativeOutcomeRate: number
  derivedAt: string
}

const modeIndex = (mode: SiteForgeAutonomyMode) =>
  SITEFORGE_AUTONOMY_MODES.indexOf(mode)

export function isProductionLaunchScope(actionScope: string) {
  return /(^|[.:/_-])(?:production[.:/_-]?)?launch($|[.:/_-])/i.test(
    actionScope.trim()
  )
}

export function isRenderedExtensionScope(actionScope: string) {
  return /(^|[.:/_-])(?:runtime[.:/_-]?)?(?:extension|overlay|css)($|[.:/_-])/i.test(
    actionScope.trim()
  )
}

export function canSiteForgeActAutomatically(
  actionScope: string,
  mode: SiteForgeAutonomyMode
) {
  return mode === 'bounded_auto' && !isProductionLaunchScope(actionScope)
}

export function validateAutonomyPromotion(input: {
  actionScope: string
  currentMode: SiteForgeAutonomyMode | null
  requestedMode: SiteForgeAutonomyMode
  holdoutPercent: number
  limits: Record<string, unknown>
  evidence: AutonomyPromotionEvidence
}) {
  const currentIndex = input.currentMode ? modeIndex(input.currentMode) : -1
  const requestedIndex = modeIndex(input.requestedMode)
  if (requestedIndex !== currentIndex + 1) {
    throw new Error('Autonomy modes must promote one stage at a time')
  }
  if (input.requestedMode !== 'observe_only' && input.evidence.evaluatedRuns < 1) {
    throw new Error('Promotion requires recorded evaluation evidence')
  }
  if (input.requestedMode === 'supervised' && input.evidence.evaluatedRuns < 2) {
    throw new Error('Supervised mode requires at least two recommendation evaluations')
  }
  if (
    input.requestedMode === 'supervised' &&
    input.evidence.approvalDecisions < 1
  ) {
    throw new Error('Supervised mode requires durable approval evidence')
  }
  if (input.requestedMode === 'bounded_auto') {
    if (isProductionLaunchScope(input.actionScope)) {
      throw new Error('Production launch can never use automatic execution')
    }
    if (
      input.evidence.supervisedSuccesses < 5 ||
      input.evidence.rollbackVerified !== true ||
      input.evidence.incidentRate > 0.1 ||
      input.evidence.providerEvidenceRuns < 2 ||
      input.evidence.outcomeMeasurements < 3 ||
      input.evidence.negativeOutcomeRate > 0.1
    ) {
      throw new Error(
        'Bounded auto requires five supervised successes, repeated provider evidence, verified rollback, measured outcomes, and incident/negative-outcome rates at or below 10%'
      )
    }
    if (
      isRenderedExtensionScope(input.actionScope) &&
      input.evidence.renderedEvidenceRuns <
        input.evidence.supervisedSuccesses
    ) {
      throw new Error(
        'Bounded auto for runtime extensions requires passing parent-versus-edited rendered evidence for every supervised success'
      )
    }
    if (
      input.holdoutPercent < 1 ||
      typeof input.limits.maxActionsPerDay !== 'number' ||
      input.limits.maxActionsPerDay < 1
    ) {
      throw new Error('Bounded auto requires a holdout and a daily action limit')
    }
  }
}

function record(value: Json | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export async function deriveSiteForgeAutonomyEvidence(input: {
  orgId: string
  propertyId: string | null
  actionScope: string
}): Promise<AutonomyPromotionEvidence> {
  const service = createServiceClient()
  let actionQuery = service
    .from('shared_action_attempts')
    .select(
      'id, job_id, proposal_decision_status, execution_status, execution_result, rollback_metadata, proposed_at'
    )
    .eq('org_id', input.orgId)
    .eq('action_type', input.actionScope)
  actionQuery = input.propertyId
    ? actionQuery.eq('property_id', input.propertyId)
    : actionQuery.is('property_id', null)
  const { data: actions, error: actionError } = await actionQuery
  if (actionError) {
    throw new Error(`Failed to derive autonomy action evidence: ${actionError.message}`)
  }
  const actionRows = actions || []
  const actionIds = actionRows.map(action => action.id)
  const jobIds = [...new Set(actionRows.map(action => action.job_id))]

  let jobsQuery = service
    .from('shared_jobs')
    .select('id, lifecycle_status, output, error_details')
    .eq('org_id', input.orgId)
    .in('id', jobIds.length ? jobIds : ['00000000-0000-0000-0000-000000000000'])
  jobsQuery = input.propertyId
    ? jobsQuery.eq('property_id', input.propertyId)
    : jobsQuery.is('property_id', null)

  let incidentQuery = service
    .from('siteforge_incidents')
    .select('id, status, severity, category, created_at')
    .eq('org_id', input.orgId)
  incidentQuery = input.propertyId
    ? incidentQuery.eq('property_id', input.propertyId)
    : incidentQuery.limit(0)

  let restoreQuery = service
    .from('siteforge_restore_drills')
    .select('id, status, verification_report, completed_at')
    .eq('org_id', input.orgId)
  restoreQuery = input.propertyId
    ? restoreQuery.eq('property_id', input.propertyId)
    : restoreQuery.limit(0)

  const [jobsResult, incidentsResult, restoresResult, approvalsResult, outcomesResult] =
    await Promise.all([
      jobsQuery,
      incidentQuery,
      restoreQuery,
      service
        .from('shared_approvals')
        .select('id, action_attempt_id, decision_status')
        .eq('org_id', input.orgId)
        .in(
          'action_attempt_id',
          actionIds.length
            ? actionIds
            : ['00000000-0000-0000-0000-000000000000']
        ),
      service
        .from('shared_experiment_outcomes')
        .select('id, action_attempt_id, outcome_status, kpi_name')
        .eq('org_id', input.orgId)
        .in(
          'action_attempt_id',
          actionIds.length
            ? actionIds
            : ['00000000-0000-0000-0000-000000000000']
        ),
    ])
  const evidenceError = [
    jobsResult,
    incidentsResult,
    restoresResult,
    approvalsResult,
    outcomesResult,
  ].find(result => result.error)?.error
  if (evidenceError) {
    throw new Error(`Failed to derive autonomy evidence: ${evidenceError.message}`)
  }

  const approvals = approvalsResult.data || []
  const approvedIds = new Set(
    approvals
      .filter(approval => ['approved', 'modified'].includes(approval.decision_status))
      .map(approval => approval.action_attempt_id)
  )
  const completedJobs = (jobsResult.data || []).filter(job =>
    ['succeeded', 'failed', 'cancelled'].includes(job.lifecycle_status)
  )
  const supervisedSuccesses = actionRows.filter(
    action =>
      approvedIds.has(action.id) &&
      action.proposal_decision_status !== 'proposed' &&
      action.execution_status === 'executed' &&
      completedJobs.some(
        job => job.id === action.job_id && job.lifecycle_status === 'succeeded'
      )
  ).length
  const providerEvidence = new Set<string>()
  const renderedEvidence = new Set<string>()
  for (const action of actionRows) {
    const result = record(action.execution_result)
    const rollback = record(action.rollback_metadata)
    const provider =
      typeof result.provider === 'string'
        ? result.provider
        : typeof rollback.provider === 'string'
          ? rollback.provider
          : null
    const operationId =
      typeof result.providerOperationId === 'string'
        ? result.providerOperationId
        : typeof result.providerRequestId === 'string'
          ? result.providerRequestId
          : typeof rollback.providerOperationId === 'string'
            ? rollback.providerOperationId
            : null
    if (provider && operationId) providerEvidence.add(`${provider}:${operationId}`)
    const effect = record(result.renderedEffectEvidence as Json | null)
    if (
      effect.passed === true &&
      typeof effect.contractHash === 'string' &&
      /^[a-f0-9]{64}$/.test(effect.contractHash)
    ) {
      renderedEvidence.add(`${action.id}:${effect.contractHash}`)
    }
  }
  const restores = restoresResult.data || []
  const verifiedRestores = restores.filter(restore => {
    if (restore.status !== 'succeeded' || !restore.completed_at) return false
    const report = record(restore.verification_report)
    return report.passed === true || report.verified === true
  })
  const outcomes = outcomesResult.data || []
  const negativeOutcomes = outcomes.filter(
    outcome => outcome.outcome_status === 'negative'
  ).length
  const incidentCount = (incidentsResult.data || []).filter(
    incident => incident.status !== 'resolved'
  ).length
  const denominator = Math.max(1, completedJobs.length)

  return {
    evaluatedRuns: actionRows.length,
    completedJobs: completedJobs.length,
    supervisedSuccesses,
    approvalDecisions: approvals.length,
    incidentCount,
    incidentRate: incidentCount / denominator,
    rollbackVerified:
      verifiedRestores.length > 0 ||
      actionRows.some(action => action.execution_status === 'reversed'),
    restoreEvidenceRuns: verifiedRestores.length,
    providerEvidenceRuns: providerEvidence.size,
    renderedEvidenceRuns: renderedEvidence.size,
    outcomeMeasurements: outcomes.length,
    negativeOutcomeRate: outcomes.length ? negativeOutcomes / outcomes.length : 1,
    derivedAt: new Date().toISOString(),
  }
}

export async function getActiveSiteForgeAutonomyMode(input: {
  orgId: string
  propertyId: string | null
  actionScope: string
}) {
  const service = createServiceClient()
  let query = service
    .from('siteforge_autonomy_modes')
    .select('*')
    .eq('org_id', input.orgId)
    .eq('action_scope', input.actionScope)
    .is('superseded_at', null)
  query = input.propertyId
    ? query.eq('property_id', input.propertyId)
    : query.is('property_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`Failed to load autonomy mode: ${error.message}`)
  return data
}

export async function promoteSiteForgeAutonomyMode(input: {
  orgId: string
  propertyId: string | null
  actionScope: string
  requestedMode: SiteForgeAutonomyMode
  holdoutPercent: number
  limits: Record<string, unknown>
  policyVersion: string
  rationale: string
  actorId: string
}) {
  const service = createServiceClient()
  const current = await getActiveSiteForgeAutonomyMode(input)
  const evidence = await deriveSiteForgeAutonomyEvidence(input)
  validateAutonomyPromotion({
    actionScope: input.actionScope,
    currentMode: (current?.mode as SiteForgeAutonomyMode | undefined) || null,
    requestedMode: input.requestedMode,
    holdoutPercent: input.holdoutPercent,
    limits: input.limits,
    evidence,
  })
  const now = new Date().toISOString()
  if (current) {
    const { error } = await service
      .from('siteforge_autonomy_modes')
      .update({ superseded_at: now })
      .eq('id', current.id)
      .is('superseded_at', null)
    if (error) throw new Error(`Failed to supersede autonomy policy: ${error.message}`)
  }
  const { data, error } = await service
    .from('siteforge_autonomy_modes')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      action_scope: input.actionScope,
      mode: input.requestedMode,
      limits: {
        ...input.limits,
        promotionEvidence: evidence,
        automaticExecutionAllowed: canSiteForgeActAutomatically(
          input.actionScope,
          input.requestedMode
        ),
        automaticProductionLaunch: false,
      } as Json,
      holdout_percent: input.holdoutPercent,
      policy_version: input.policyVersion,
      rationale: input.rationale,
      promoted_by: input.actorId,
    })
    .select('*')
    .single()
  if (error || !data) {
    if (current) {
      await service
        .from('siteforge_autonomy_modes')
        .update({ superseded_at: null })
        .eq('id', current.id)
        .eq('superseded_at', now)
    }
    throw new Error(`Failed to promote autonomy mode: ${error?.message || ''}`)
  }
  return data
}
