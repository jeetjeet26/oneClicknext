import { describe, expect, it } from 'vitest'
import { operatorToolSecretMatches } from './route'

describe('Aurora operator Cloudways tool gating', () => {
  const secret = 'a'.repeat(48)

  it('rejects when the server secret is missing or too short', () => {
    expect(operatorToolSecretMatches(secret, undefined)).toBe(false)
    expect(operatorToolSecretMatches('short', 'short')).toBe(false)
  })

  it('rejects a missing or mismatched header secret', () => {
    expect(operatorToolSecretMatches(null, secret)).toBe(false)
    expect(operatorToolSecretMatches('b'.repeat(48), secret)).toBe(false)
  })

  it('accepts only the exact configured secret', () => {
    expect(operatorToolSecretMatches(secret, secret)).toBe(true)
  })
})
