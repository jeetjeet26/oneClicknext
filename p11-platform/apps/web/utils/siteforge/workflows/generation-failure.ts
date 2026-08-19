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
    /approved floor-plan inventory changed or is no longer publishable/i.test(
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
  if (
    /themeJson[\s\S]*spacingSizes|designTokens[\s\S]*spacing[\s\S]*sectionPadding|Invalid string: must match pattern[\s\S]*(?:px\|rem\|em\|vw\|%)/i.test(
      message
    )
  ) {
    return {
      code: 'theme_spacing_contract_mismatch',
      retryable: true,
      failedCheckpoint,
      message,
      safeMessage:
        'SiteForge produced a responsive spacing value that the theme artifact could not publish. That contract has been repaired and this build can be retried.',
    }
  }
  const qualityGateFailure = message.match(
    /Deterministic quality gates failed:\s*(.+)$/i
  )
  if (qualityGateFailure) {
    const failedGateIds = qualityGateFailure[1]
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    if (
      failedGateIds.length > 0 &&
      failedGateIds.every(id =>
        ['confirmed_plan_fidelity', 'exact_brand_tokens'].includes(id)
      )
    ) {
      return {
        code: 'deterministic_projection_contract_mismatch',
        retryable: true,
        failedCheckpoint,
        message,
        safeMessage:
          'SiteForge detected an internal mismatch between optional page structure, creative styling, and the pinned brand contract. Those projections have been repaired and this build can be retried.',
      }
    }
  }
  const deterministicAssetMismatch =
    /approved evidence snapshot|pinned .* (?:hash|context)|does not match the confirmed plan/i.test(
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
