import type {
  GenerationPreferences,
  GenerationStatus,
  WebsiteStatusResponse,
} from '@/types/siteforge'
import type { CreateGenerationRequest } from '@/utils/siteforge/contracts'

export type ApprovedPlanIdentity = {
  planId: string
  revision: number
  contentHash: string
}

export type SiteForgeCapability = 'crm' | 'tours' | 'chatbot' | 'analytics'

const SITEFORGE_CAPABILITY_ORDER: SiteForgeCapability[] = [
  'crm',
  'tours',
  'chatbot',
  'analytics',
]

export function approvedReadinessCapabilities(value: unknown): SiteForgeCapability[] {
  if (!Array.isArray(value)) return []
  const approved = value.find(snapshot => {
    return Boolean(
      snapshot &&
        typeof snapshot === 'object' &&
        !Array.isArray(snapshot) &&
        (snapshot as { status?: unknown }).status === 'approved'
    )
  })
  if (!approved || typeof approved !== 'object' || Array.isArray(approved)) {
    return []
  }
  const payload = (approved as { snapshot_payload?: unknown }).snapshot_payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const capabilities = (payload as { enabledCapabilities?: unknown })
    .enabledCapabilities
  if (!Array.isArray(capabilities)) return []
  const selected = new Set(
    capabilities.filter(
      (capability): capability is SiteForgeCapability =>
        typeof capability === 'string' &&
        SITEFORGE_CAPABILITY_ORDER.includes(capability as SiteForgeCapability)
    )
  )
  return SITEFORGE_CAPABILITY_ORDER.filter(capability => selected.has(capability))
}

export function isExactArtifactPreview(input: {
  currentArtifactId: string | null | undefined
  currentContentHash: string | null | undefined
  previewArtifactId: string | null | undefined
  previewContentHash: string | null | undefined
}): boolean {
  return Boolean(
    input.currentArtifactId &&
      input.currentContentHash &&
      input.previewArtifactId === input.currentArtifactId &&
      input.previewContentHash === input.currentContentHash
  )
}

export function buildGenerationRequest(
  websiteId: string,
  plan: ApprovedPlanIdentity,
  idempotencyKey: string
): CreateGenerationRequest {
  return {
    websiteId,
    planId: plan.planId,
    confirmedRevision: plan.revision,
    contentHash: plan.contentHash,
    idempotencyKey,
  }
}

export function siteForgeStatusEndpoint(websiteId: string): string {
  return `/api/siteforge/status/${encodeURIComponent(websiteId)}`
}

export function regenerationPlanUrl(
  propertyId: string,
  websiteId: string
): string {
  const params = new URLSearchParams({
    regeneratePropertyId: propertyId,
    sourceWebsiteId: websiteId,
  })
  return `/dashboard/siteforge?${params.toString()}`
}

export function responseErrorMessage(
  status: number,
  payload: unknown,
  action: string
): string {
  const serverMessage =
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error.trim()
      : ''

  if (status === 401) {
    return `Your session expired while ${action}. Sign in again and retry.`
  }
  if (status === 403) {
    return `You do not have permission to continue ${action}. Ask an administrator for access.`
  }
  if (status >= 500) {
    return serverMessage
      ? `${serverMessage} The SiteForge server could not complete ${action}; retry or check server logs.`
      : `The SiteForge server could not complete ${action}. Retry or check server logs.`
  }
  return serverMessage || `SiteForge could not complete ${action} (HTTP ${status}).`
}

export type WebsitePollOutcome =
  | { terminal: false }
  | { terminal: true; succeeded: true }
  | { terminal: true; succeeded: false; message: string }

export function classifyWebsiteStatus(
  status: Pick<
    WebsiteStatusResponse,
    'status' | 'errorMessage' | 'currentStep' | 'deploymentDiagnostics'
  >,
  operation: 'generation' | 'deployment'
): WebsitePollOutcome {
  const successfulStatuses: GenerationStatus[] =
    operation === 'generation'
      ? ['ready_for_preview', 'complete']
      : ['complete']

  if (successfulStatuses.includes(status.status)) {
    return { terminal: true, succeeded: true }
  }

  const failedStatuses: GenerationStatus[] =
    operation === 'generation' ? ['failed'] : ['deploy_failed', 'failed']
  if (!failedStatuses.includes(status.status)) {
    return { terminal: false }
  }

  const message =
    status.deploymentDiagnostics?.error?.message ||
    status.errorMessage ||
    status.currentStep?.replace(/^Error:\s*/i, '').trim() ||
    (operation === 'generation'
      ? 'Website generation failed. Review the plan and retry.'
      : 'Staging deployment failed. Review deployment diagnostics and retry.')
  return { terminal: true, succeeded: false, message }
}

export function preferencesMatch(
  persisted: GenerationPreferences | undefined,
  selected: GenerationPreferences
): boolean {
  const persistedCapabilities = [
    ...(persisted?.enabledCapabilities || []),
  ].sort()
  const selectedCapabilities = [
    ...(selected.enabledCapabilities || []),
  ].sort()
  return (
    persisted?.style === selected.style &&
    persisted?.emphasis === selected.emphasis &&
    persisted?.ctaPriority === selected.ctaPriority &&
    JSON.stringify(persistedCapabilities) ===
      JSON.stringify(selectedCapabilities)
  )
}

export function partitionUploadResults<T>(
  files: ReadonlyArray<{ name: string }>,
  results: ReadonlyArray<PromiseSettledResult<T>>
): { succeeded: T[]; failedNames: string[] } {
  return results.reduce<{ succeeded: T[]; failedNames: string[] }>(
    (summary, result, index) => {
      if (result.status === 'fulfilled') {
        summary.succeeded.push(result.value)
      } else {
        summary.failedNames.push(files[index]?.name || `file ${index + 1}`)
      }
      return summary
    },
    { succeeded: [], failedNames: [] }
  )
}
