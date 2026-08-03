import { afterEach, describe, expect, it } from 'vitest'
import { assertDisposableProviderAcceptanceGate } from './provider-acceptance-gate'

const originalOptIn = process.env.SITEFORGE_DISPOSABLE_PROVIDER_ACCEPTANCE

afterEach(() => {
  process.env.SITEFORGE_DISPOSABLE_PROVIDER_ACCEPTANCE = originalOptIn
})

describe('disposable provider acceptance gate', () => {
  it('requires explicit environment opt-in', () => {
    delete process.env.SITEFORGE_DISPOSABLE_PROVIDER_ACCEPTANCE
    expect(() =>
      assertDisposableProviderAcceptanceGate({
        optIn: true,
        runId: 'provider-run-123',
        owner: 'local-operator',
        expiresAt: '2026-07-31T22:00:00.000Z',
        cleanupEvidence: {
          resourceIds: ['application-1'],
          cleanupCommand: 'delete application-1',
        },
      }, new Date('2026-07-31T21:00:00.000Z'))
    ).toThrow('environment opt-in')
  })

  it('requires owned, expiring resources and cleanup evidence', () => {
    process.env.SITEFORGE_DISPOSABLE_PROVIDER_ACCEPTANCE = '1'
    expect(
      assertDisposableProviderAcceptanceGate(
        {
          optIn: true,
          runId: 'provider-run-123',
          owner: 'local-operator',
          expiresAt: '2026-07-31T22:00:00.000Z',
          cleanupEvidence: {
            resourceIds: ['application-1'],
            cleanupCommand: 'delete application-1',
          },
        },
        new Date('2026-07-31T21:00:00.000Z')
      )
    ).toMatchObject({
      runId: 'provider-run-123',
      owner: 'local-operator',
      cleanupRequired: true,
    })
  })
})
