import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildExternalIntegrationLink,
  createInviteToken,
  hashInviteToken,
  safeTokenHashEquals,
} from './integration-auth-invites'

describe('integration auth invite helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates opaque tokens and stable hashes', () => {
    const token = createInviteToken()
    const hash = hashInviteToken(token)

    expect(token.length).toBeGreaterThan(20)
    expect(hash).toHaveLength(64)
    expect(safeTokenHashEquals(hash, hashInviteToken(token))).toBe(true)
    expect(safeTokenHashEquals(hash, hashInviteToken(`${token}x`))).toBe(false)
  })

  it('builds the external connect link', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')

    expect(buildExternalIntegrationLink('token-1')).toBe(
      'https://app.example.com/lumaleasing/integrations/connect?token=token-1'
    )
  })
})
