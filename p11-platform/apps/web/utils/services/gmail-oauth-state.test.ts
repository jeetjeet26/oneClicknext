import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSignedGmailOAuthState,
  verifySignedGmailOAuthState,
} from './gmail-oauth-state'

describe('gmail oauth state helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates and verifies a signed state payload', () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')

    const state = createSignedGmailOAuthState({
      propertyId: 'property-1',
      profileId: 'profile-1',
      timestamp: 1_700_000_000_000,
    })

    expect(
      verifySignedGmailOAuthState(state, 1_700_000_100_000)
    ).toEqual({
      propertyId: 'property-1',
      profileId: 'profile-1',
      timestamp: 1_700_000_000_000,
    })
  })

  it('rejects tampered payloads', () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')

    const state = createSignedGmailOAuthState({
      propertyId: 'property-1',
      profileId: 'profile-1',
      timestamp: 1_700_000_000_000,
    })

    const [, signature] = state.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        propertyId: 'property-2',
        profileId: 'profile-1',
        timestamp: 1_700_000_000_000,
      }),
      'utf-8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

    expect(() =>
      verifySignedGmailOAuthState(
        `${tamperedPayload}.${signature}`,
        1_700_000_100_000
      )
    ).toThrow('Invalid OAuth state signature')
  })

  it('rejects expired states', () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')

    const state = createSignedGmailOAuthState({
      propertyId: 'property-1',
      profileId: 'profile-1',
      timestamp: 1_700_000_000_000,
    })

    expect(() =>
      verifySignedGmailOAuthState(state, 1_700_001_000_001)
    ).toThrow('OAuth state has expired')
  })
})
