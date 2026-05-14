import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSignedIntegrationOAuthState,
  verifySignedIntegrationOAuthState,
} from './integration-oauth-state'

describe('integration OAuth state', () => {
  beforeEach(() => {
    vi.stubEnv('INTEGRATION_OAUTH_STATE_SECRET', 'test-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round trips a dashboard state payload', () => {
    const state = createSignedIntegrationOAuthState({
      propertyId: 'property-1',
      provider: 'microsoft',
      capabilities: ['calendar', 'email'],
      authSource: 'dashboard',
      profileId: 'profile-1',
      timestamp: 1000,
    })

    expect(verifySignedIntegrationOAuthState(state, 1000)).toEqual({
      propertyId: 'property-1',
      provider: 'microsoft',
      capabilities: ['calendar', 'email'],
      authSource: 'dashboard',
      profileId: 'profile-1',
      timestamp: 1000,
      inviteId: undefined,
      tokenHash: undefined,
      returnPath: undefined,
    })
  })

  it('rejects tampered state', () => {
    const state = createSignedIntegrationOAuthState({
      propertyId: 'property-1',
      provider: 'google',
      capabilities: ['email'],
      authSource: 'external_invite',
      inviteId: 'invite-1',
      tokenHash: 'hash-1',
      timestamp: 1000,
    })

    expect(() => verifySignedIntegrationOAuthState(`${state}x`, 1000)).toThrow(
      'Invalid OAuth state signature'
    )
  })
})
