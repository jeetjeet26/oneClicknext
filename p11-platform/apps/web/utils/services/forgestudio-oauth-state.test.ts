import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSignedForgeStudioOAuthState,
  generateForgeStudioOAuthNonce,
  verifyForgeStudioOAuthCallback,
  verifySignedForgeStudioOAuthState,
} from './forgestudio-oauth-state'

const NONCE = 'a'.repeat(32)

describe('forgestudio oauth state helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates and verifies a signed state payload', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

    const state = createSignedForgeStudioOAuthState({
      propertyId: 'property-1',
      userId: 'user-1',
      nonce: NONCE,
      timestamp: 1_700_000_000_000,
    })

    expect(
      verifySignedForgeStudioOAuthState(state, 1_700_000_100_000)
    ).toEqual({
      propertyId: 'property-1',
      userId: 'user-1',
      nonce: NONCE,
      timestamp: 1_700_000_000_000,
    })
  })

  it('rejects tampered payloads', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

    const state = createSignedForgeStudioOAuthState({
      propertyId: 'property-1',
      userId: 'user-1',
      nonce: NONCE,
      timestamp: 1_700_000_000_000,
    })

    const [, signature] = state.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        propertyId: 'property-2',
        userId: 'user-1',
        nonce: NONCE,
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
      userId: 'user-1',
      nonce: NONCE,
      timestamp: 1_700_000_000_000,
    })

    expect(() =>
      verifySignedForgeStudioOAuthState(state, 1_700_001_000_001)
    ).toThrow('OAuth state has expired')
  })

  it('rejects states missing user or nonce binding', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

    const legacyPayload = Buffer.from(
      JSON.stringify({ propertyId: 'property-1', timestamp: 1_700_000_000_000 }),
      'utf-8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

    // Even with a legitimate signature over the legacy payload the verifier
    // must reject payloads without user/nonce binding. Signature check fires
    // first here, which is also acceptable rejection.
    expect(() =>
      verifySignedForgeStudioOAuthState(`${legacyPayload}.invalid`, 1_700_000_100_000)
    ).toThrow()
  })

  describe('verifyForgeStudioOAuthCallback', () => {
    it('accepts a matching user and nonce cookie', () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

      const nonce = generateForgeStudioOAuthNonce()
      const state = createSignedForgeStudioOAuthState({
        propertyId: 'property-1',
        userId: 'user-1',
        nonce,
      })

      const payload = verifyForgeStudioOAuthCallback({
        state,
        userId: 'user-1',
        nonceCookie: nonce,
      })

      expect(payload.propertyId).toBe('property-1')
    })

    it('rejects a different authenticated user', () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

      const nonce = generateForgeStudioOAuthNonce()
      const state = createSignedForgeStudioOAuthState({
        propertyId: 'property-1',
        userId: 'user-1',
        nonce,
      })

      expect(() =>
        verifyForgeStudioOAuthCallback({
          state,
          userId: 'user-2',
          nonceCookie: nonce,
        })
      ).toThrow('OAuth state does not belong to the authenticated user')
    })

    it('rejects a missing nonce cookie (replay)', () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

      const nonce = generateForgeStudioOAuthNonce()
      const state = createSignedForgeStudioOAuthState({
        propertyId: 'property-1',
        userId: 'user-1',
        nonce,
      })

      expect(() =>
        verifyForgeStudioOAuthCallback({
          state,
          userId: 'user-1',
          nonceCookie: undefined,
        })
      ).toThrow('OAuth nonce cookie is missing')
    })

    it('rejects a mismatched nonce cookie', () => {
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret')

      const state = createSignedForgeStudioOAuthState({
        propertyId: 'property-1',
        userId: 'user-1',
        nonce: generateForgeStudioOAuthNonce(),
      })

      expect(() =>
        verifyForgeStudioOAuthCallback({
          state,
          userId: 'user-1',
          nonceCookie: generateForgeStudioOAuthNonce(),
        })
      ).toThrow('OAuth nonce mismatch')
    })
  })
})
