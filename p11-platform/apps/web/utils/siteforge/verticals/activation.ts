import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/supabase'
import type { AdaptiveVerticalContext } from '@/utils/siteforge/guided/adaptive-discovery'
import { VERTICAL_REGISTRY_VERSION } from './registry'

export const siteForgeVerticalModeSchema = z.enum([
  'off',
  'shadow',
  'canary',
  'on',
])
export type SiteForgeVerticalMode = z.infer<typeof siteForgeVerticalModeSchema>
type ActivationRow = Tables<'siteforge_vertical_activation_versions'>

export type SiteForgeVerticalActivationDecision = {
  configuredMode: SiteForgeVerticalMode
  effectiveMode: SiteForgeVerticalMode
  runShadow: boolean
  useV2: boolean
  reason:
    | 'global_disabled'
    | 'mode_off'
    | 'shadow_only'
    | 'registry_version_mismatch'
    | 'activated'
  activationVersionId: string | null
  qualificationReportHash: string | null
}

// Vertical Platform V2 is the default for every website. The env vars remain
// only as an explicit production kill switch (set to 'false'/'off' to revert
// to the legacy V1 plan builder). Per-website allowlisting is retired.
function configuredMode(): SiteForgeVerticalMode {
  if (process.env.SITEFORGE_VERTICALS_V2_ENABLED === 'false') return 'off'
  const parsed = siteForgeVerticalModeSchema.safeParse(
    process.env.SITEFORGE_VERTICALS_MODE || 'on'
  )
  return parsed.success ? parsed.data : 'on'
}

function disabledDecision(
  mode: SiteForgeVerticalMode,
  reason: SiteForgeVerticalActivationDecision['reason']
): SiteForgeVerticalActivationDecision {
  return {
    configuredMode: mode,
    effectiveMode: mode === 'shadow' ? 'shadow' : 'off',
    runShadow: mode === 'shadow',
    useV2: false,
    reason,
    activationVersionId: null,
    qualificationReportHash: null,
  }
}

export function evaluateVerticalActivation(input: {
  configuredMode: SiteForgeVerticalMode
  pinnedRegistryVersion: number | null
  context: AdaptiveVerticalContext
  activation: ActivationRow | null
}): SiteForgeVerticalActivationDecision {
  const { configuredMode: mode } = input
  if (mode === 'off') return disabledDecision(mode, 'mode_off')
  if (
    input.pinnedRegistryVersion !== null &&
    input.pinnedRegistryVersion !== VERTICAL_REGISTRY_VERSION
  ) {
    return disabledDecision(mode, 'registry_version_mismatch')
  }
  if (mode === 'shadow') return disabledDecision(mode, 'shadow_only')
  return {
    configuredMode: mode,
    effectiveMode: mode,
    runShadow: false,
    useV2: true,
    reason: 'activated',
    activationVersionId: input.activation?.id || null,
    qualificationReportHash:
      input.activation?.qualification_report_hash || null,
  }
}

export async function resolveVerticalActivation(
  identity: { websiteId: string; propertyId: string; orgId: string },
  context: AdaptiveVerticalContext,
  client: SupabaseClient<Database>
): Promise<SiteForgeVerticalActivationDecision> {
  const mode = configuredMode()
  if (mode === 'off') return disabledDecision(mode, 'global_disabled')
  const pinnedRegistryVersion = Number.parseInt(
    process.env.SITEFORGE_VERTICALS_PACK_VERSION || '',
    10
  )
  if (
    Number.isFinite(pinnedRegistryVersion) &&
    pinnedRegistryVersion !== VERTICAL_REGISTRY_VERSION
  ) {
    return disabledDecision(mode, 'registry_version_mismatch')
  }
  if (mode === 'shadow') return disabledDecision(mode, 'shadow_only')

  // The activation ledger is optional provenance metadata now; V2 no longer
  // requires a per-website allowlist row.
  const { data } = await client
    .from('siteforge_vertical_activation_versions')
    .select('*')
    .eq('website_id', identity.websiteId)
    .eq('property_id', identity.propertyId)
    .eq('org_id', identity.orgId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return evaluateVerticalActivation({
    configuredMode: mode,
    pinnedRegistryVersion: Number.isFinite(pinnedRegistryVersion)
      ? pinnedRegistryVersion
      : null,
    context,
    activation: data ?? null,
  })
}
