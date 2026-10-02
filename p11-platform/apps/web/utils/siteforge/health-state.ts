export type HealthEvidenceState = 'healthy' | 'failed' | 'not_configured' | 'unobservable'

export function healthEvidenceState(value: unknown): HealthEvidenceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unobservable'
  const result = value as Record<string, unknown>
  if (result.state === 'not_configured' || result.state === 'unobservable') return result.state
  if (result.state === 'failed') return 'failed'
  if (result.passed === true && result.evidence && typeof result.evidence === 'object' &&
      (result.evidence as Record<string, unknown>).applicable === false) return 'unobservable'
  if (result.passed === true) return 'healthy'
  if (result.passed === false) return 'failed'
  return 'unobservable'
}

export const isVerifiedHealthCheck = (value: unknown) => healthEvidenceState(value) === 'healthy'

export function summarizeHealthChecks(checks: Record<string, unknown>) {
  const counts = { healthy: 0, failed: 0, not_configured: 0, unobservable: 0 }
  for (const check of Object.values(checks)) counts[healthEvidenceState(check)]++
  return counts
}

export type MonitoringPurpose = 'production' | 'testbed' | 'review' | 'staging' | 'unknown'
export function monitoringPurpose(target: {
  target_type: string; is_active: boolean; site_url: string | null; metadata: unknown
} | null, productionUrl: string): MonitoringPurpose {
  if (!target || !target.is_active || !target.site_url) return 'unknown'
  try {
    const normalize = (value: string) => new URL(value).href.replace(/\/$/, '')
    if (normalize(target.site_url) !== normalize(productionUrl)) return 'unknown'
  } catch { return 'unknown' }
  const metadata = target.metadata && typeof target.metadata === 'object' && !Array.isArray(target.metadata)
    ? target.metadata as Record<string, unknown> : {}
  // These fields identify resources created by the retained lifecycle test tooling.
  if (metadata.lifecycleOwnerId && metadata.lifecycleRunId) return 'testbed'
  if (metadata.monitoringPurpose === 'production' && target.target_type !== 'production') return 'unknown'
  if (['production', 'testbed', 'review', 'staging'].includes(String(metadata.monitoringPurpose)))
    return metadata.monitoringPurpose as MonitoringPurpose
  if (target.target_type === 'production') return 'production'
  if (target.target_type === 'staging') return 'staging'
  if (target.target_type === 'canonical_preview') return 'review'
  return 'unknown'
}
