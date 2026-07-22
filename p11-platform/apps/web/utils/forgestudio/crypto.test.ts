import { afterEach, describe, expect, it, vi } from 'vitest'

import { decryptSecret, encryptSecret, isEncryptedSecret } from './crypto'

describe('forgestudio crypto', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round-trips a secret through encv1 AES-GCM', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'unit-test-key')

    const encrypted = encryptSecret('super-secret-token')
    expect(encrypted.startsWith('encv1:')).toBe(true)
    expect(isEncryptedSecret(encrypted)).toBe(true)
    expect(decryptSecret(encrypted)).toBe('super-secret-token')
  })

  it('refuses to run without ENCRYPTION_KEY', () => {
    vi.stubEnv('ENCRYPTION_KEY', '')

    expect(() => encryptSecret('x')).toThrow('ENCRYPTION_KEY is required')
    expect(() => decryptSecret('encv1:a:b:c')).toThrow('ENCRYPTION_KEY is required')
  })

  it('refuses the retired default key', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'p11-platform-default-key-change-me')

    expect(() => encryptSecret('x')).toThrow('retired default value')
  })

  it('decodes legacy enc_ base64 values', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'unit-test-key')

    const legacy = `enc_${Buffer.from('legacy-secret', 'utf-8').toString('base64')}`
    expect(decryptSecret(legacy)).toBe('legacy-secret')
  })

  it('passes through plaintext values for migration on write', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'unit-test-key')

    expect(decryptSecret('plaintext-token')).toBe('plaintext-token')
    expect(isEncryptedSecret('plaintext-token')).toBe(false)
  })

  it('fails on tampered ciphertext', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'unit-test-key')

    const encrypted = encryptSecret('super-secret-token')
    const parts = encrypted.split(':')
    parts[3] = Buffer.from('tampered-data').toString('base64')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })
})
