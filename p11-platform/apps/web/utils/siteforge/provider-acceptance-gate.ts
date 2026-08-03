const MAX_DISPOSABLE_TTL_MINUTES = 180

export type DisposableProviderAcceptanceInput = {
  optIn: boolean
  runId: string
  owner: string
  expiresAt: string
  cleanupEvidence?: {
    resourceIds: string[]
    cleanupCommand?: string
    cleanupVerifiedAt?: string
  }
}

export function assertDisposableProviderAcceptanceGate(
  input: DisposableProviderAcceptanceInput,
  now = new Date()
) {
  if (
    !input.optIn ||
    process.env.SITEFORGE_DISPOSABLE_PROVIDER_ACCEPTANCE !== '1'
  ) {
    throw new Error('Disposable provider acceptance requires explicit environment opt-in')
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(input.runId)) {
    throw new Error('Disposable provider acceptance requires a unique owned run identifier')
  }
  if (!input.owner.trim()) {
    throw new Error('Disposable provider acceptance requires a run owner')
  }
  const expiresAt = new Date(input.expiresAt)
  const ttlMs = expiresAt.getTime() - now.getTime()
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    ttlMs <= 0 ||
    ttlMs > MAX_DISPOSABLE_TTL_MINUTES * 60_000
  ) {
    throw new Error(
      `Disposable provider resources require a TTL of at most ${MAX_DISPOSABLE_TTL_MINUTES} minutes`
    )
  }
  if (
    !input.cleanupEvidence ||
    input.cleanupEvidence.resourceIds.length === 0 ||
    (!input.cleanupEvidence.cleanupCommand &&
      !input.cleanupEvidence.cleanupVerifiedAt)
  ) {
    throw new Error(
      'Disposable provider acceptance requires resource inventory and cleanup evidence'
    )
  }
  return {
    runId: input.runId,
    owner: input.owner.trim(),
    expiresAt: expiresAt.toISOString(),
    cleanupRequired: true as const,
    resourceIds: input.cleanupEvidence.resourceIds,
  }
}
