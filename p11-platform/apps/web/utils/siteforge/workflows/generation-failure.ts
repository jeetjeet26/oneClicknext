import { FatalError } from 'workflow'
import type { SiteForgeGenerationFailure } from './generation-steps'

function workflowErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message
  }
  return 'SiteForge generation failed'
}

export function classifySiteForgeGenerationFailure(
  error: unknown,
  failedCheckpoint: string
): SiteForgeGenerationFailure {
  const message = workflowErrorMessage(error)
  if (
    /outside the approved rights-cleared asset manifest/i.test(message) &&
    /logo-(?:primary|variation)-\d+/i.test(message)
  ) {
    return {
      code: 'legacy_logo_identity_failure',
      retryable: true,
      failedCheckpoint,
      message,
      safeMessage:
        'The previous build used outdated logo references. SiteForge has repaired that path and the build can now be restarted.',
    }
  }
  if (
    /approved floor-plan inventory changed, became stale, or is no longer publishable/i.test(
      message
    )
  ) {
    return {
      code: 'floor_plan_inventory_changed',
      retryable: true,
      failedCheckpoint,
      message,
      safeMessage:
        'The approved floor-plan inventory changed during the build. Restart to use the current approved inventory.',
    }
  }
  const deterministicAssetMismatch =
    /outside the approved rights-cleared asset manifest|approved evidence snapshot|pinned .* (?:hash|context)|does not match the confirmed plan/i.test(
      message
    )
  if (deterministicAssetMismatch) {
    return {
      code: 'asset_evidence_mismatch',
      retryable: false,
      failedCheckpoint,
      message,
      safeMessage:
        'The approved website assets no longer match the pinned build evidence. Review the property assets and prepare a new recommendation.',
    }
  }
  if (
    error instanceof FatalError ||
    (error instanceof Error && error.name === 'FatalError')
  ) {
    return {
      code: 'deterministic_generation_failure',
      retryable: false,
      failedCheckpoint,
      message,
      safeMessage:
        'The build stopped because approved source information needs review. Nothing was published.',
    }
  }
  if (
    /timeout|timed out|temporar|unavailable|rate limit|overloaded|provider|network|fetch failed|connection/i.test(
      message
    )
  ) {
    return {
      code: 'temporary_provider_failure',
      retryable: true,
      failedCheckpoint,
      message,
      safeMessage:
        'A temporary provider problem interrupted the build. Your approved inputs are unchanged and this job can be retried.',
    }
  }
  return {
    code: 'generation_failure',
    retryable: false,
    failedCheckpoint,
    message,
    safeMessage:
      'The build stopped and needs review before another attempt. Nothing was published.',
  }
}
