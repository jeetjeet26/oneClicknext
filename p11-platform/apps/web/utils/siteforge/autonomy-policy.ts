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
  supervisedSuccesses?: number
  incidentRate?: number
  rollbackVerified?: boolean
}

const modeIndex = (mode: SiteForgeAutonomyMode) =>
  SITEFORGE_AUTONOMY_MODES.indexOf(mode)

export function isProductionLaunchScope(actionScope: string) {
  return /(^|[.:/_-])(?:production[.:/_-]?)?launch($|[.:/_-])/i.test(
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
  if (input.requestedMode === 'bounded_auto') {
    if (isProductionLaunchScope(input.actionScope)) {
      throw new Error('Production launch can never use automatic execution')
    }
    if (
      (input.evidence.supervisedSuccesses || 0) < 5 ||
      input.evidence.rollbackVerified !== true ||
      (input.evidence.incidentRate ?? 1) > 0.1
    ) {
      throw new Error(
        'Bounded auto requires five supervised successes, verified rollback, and incident rate at or below 10%'
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
  evidence: AutonomyPromotionEvidence
  policyVersion: string
  rationale: string
  actorId: string
}) {
  const service = createServiceClient()
  const current = await getActiveSiteForgeAutonomyMode(input)
  validateAutonomyPromotion({
    actionScope: input.actionScope,
    currentMode: (current?.mode as SiteForgeAutonomyMode | undefined) || null,
    requestedMode: input.requestedMode,
    holdoutPercent: input.holdoutPercent,
    limits: input.limits,
    evidence: input.evidence,
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
        promotionEvidence: input.evidence,
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
