import { describe, expect, it } from 'vitest'
import {
  assertFirstLaunchAcknowledgment,
  assertPromotedManifestIdentity,
  signManualPromotionToken,
  verifyManualPromotionToken,
} from './service'

const secret = 'a-test-secret-that-is-definitely-longer-than-32-characters'
const identity = {
  releaseId: '11111111-1111-4111-8111-111111111111',
  artifactId: '22222222-2222-4222-8222-222222222222',
  contentHash: 'a'.repeat(64),
}

describe('SiteForge manual promotion tokens', () => {
  it('signs the exact release identity with an expiry and nonce', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const token = signManualPromotionToken({ ...identity, expiresAt }, secret)

    expect(verifyManualPromotionToken(token, identity, secret)).toMatchObject({
      ...identity,
      expiresAt,
      nonce: expect.any(String),
    })
  })

  it('rejects tampering and artifact substitution', () => {
    const token = signManualPromotionToken(
      { ...identity, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      secret
    )
    expect(() =>
      verifyManualPromotionToken(`${token}x`, identity, secret)
    ).toThrow('Invalid promotion token')
    expect(() =>
      verifyManualPromotionToken(
        token,
        { ...identity, contentHash: 'b'.repeat(64) },
        secret
      )
    ).toThrow('wrong release identity')
  })

  it('rejects expired tokens', () => {
    const token = signManualPromotionToken(
      { ...identity, expiresAt: new Date(Date.now() - 1_000).toISOString() },
      secret
    )
    expect(() => verifyManualPromotionToken(token, identity, secret)).toThrow(
      'expired'
    )
  })
})

describe('SiteForge promoted manifest verification', () => {
  it('accepts only the exact approved artifact hash', () => {
    expect(() =>
      assertPromotedManifestIdentity(identity.contentHash, identity.contentHash)
    ).not.toThrow()
    expect(() =>
      assertPromotedManifestIdentity(identity.contentHash, 'b'.repeat(64))
    ).toThrow('Promoted WordPress manifest does not match')
  })
})

describe('SiteForge first-launch acknowledgment', () => {
  it('requires explicit acknowledgment when no rollback artifact exists', () => {
    expect(() =>
      assertFirstLaunchAcknowledgment({
        releaseRollbackArtifactId: null,
        firstLaunchAcknowledged: undefined,
      })
    ).toThrow('First launch requires explicit acknowledgment')
    expect(() =>
      assertFirstLaunchAcknowledgment({
        releaseRollbackArtifactId: null,
        firstLaunchAcknowledged: false,
      })
    ).toThrow('First launch requires explicit acknowledgment')
  })

  it('accepts an acknowledged first launch', () => {
    expect(() =>
      assertFirstLaunchAcknowledgment({
        releaseRollbackArtifactId: null,
        firstLaunchAcknowledged: true,
      })
    ).not.toThrow()
  })

  it('does not require acknowledgment when a rollback artifact exists', () => {
    expect(() =>
      assertFirstLaunchAcknowledgment({
        releaseRollbackArtifactId: identity.artifactId,
        firstLaunchAcknowledged: undefined,
      })
    ).not.toThrow()
  })
})
