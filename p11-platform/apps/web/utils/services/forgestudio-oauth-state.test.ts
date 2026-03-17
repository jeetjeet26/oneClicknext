import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSignedForgeStudioOAuthState,
  verifySignedForgeStudioOAuthState,
} from './forgestudio-oauth-state'

describe('forgestudio oauth state helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates and verifies a signed state payload', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

    const state = createSignedForgeStudioOAuthState({
      propertyId: 'property-1',
      timestamp: 1_700_000_000_000,
    })

    expect(
      verifySignedForgeStudioOAuthState(state, 1_700_000_100_000)
    ).toEqual({
      propertyId: 'property-1',
      timestamp: 1_700_000_000_000,
    })
  })

  it('rejects tampered payloads', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

    const state = createSignedForgeStudioOAuthState({
      propertyId: 'property-1',
      timestamp: 1_700_000_000_000,
    })

    const [, signature] = state.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        propertyId: 'property-2',
        timestamp: 1_700_000_000_000,
      }),
      'utf-8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

    expect(() =>
      verifySignedForgeStudioOAuthState(
        `${tamperedPayload}.${signature}`,
        1_700_000_100_000
      )
    ).toThrow('Invalid OAuth state signature')
  })

  it('rejects expired states', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

    const state = createSignedForgeStudioOAuthState({
      propertyId: 'property-1',
      timestamp: 1_700_000_000_000,
    })

    expect(() =>
      verifySignedForgeStudioOAuthState(state, 1_700_001_000_001)
    ).toThrow('OAuth state has expired')
  })
})
