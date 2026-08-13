import { describe, expect, it } from 'vitest'
import {
  assertObservedRollbackIdentity,
  classifyRolloutAuditCandidate,
  isLaunchChatbotContextReady,
  isRenderedLaunchCertification,
  resolveLaunchRollbackMode,
} from './repository'

describe('SiteForge launch chatbot readiness', () => {
  it('does not require chatbot context when LumaLeasing is disabled', () => {
    expect(
      isLaunchChatbotContextReady({ lumaEnabled: false, context: null })
    ).toBe(true)
  })

  it('requires reviewed current context when LumaLeasing is enabled', () => {
    expect(
      isLaunchChatbotContextReady({ lumaEnabled: true, context: null })
    ).toBe(false)
    expect(
      isLaunchChatbotContextReady({
        lumaEnabled: true,
        context: {
          status: 'needs_review',
          requires_review: true,
          context_markdown: 'Pending facts',
        },
      })
    ).toBe(false)
    expect(
      isLaunchChatbotContextReady({
        lumaEnabled: true,
        context: {
          status: 'current',
          requires_review: false,
          context_markdown: 'Verified property facts',
        },
      })
    ).toBe(true)
  })
})

describe('SiteForge rollout audit classification', () => {
  const contentHash = 'a'.repeat(64)
  const complete = {
    contentHash,
    canonicalHash: contentHash,
    assetManifestHash: 'b'.repeat(64),
    baseThemePackageSha256: 'c'.repeat(64),
  }

  it('classifies an intact artifact with a full release identity as deployable', () => {
    expect(classifyRolloutAuditCandidate(complete)).toEqual({
      classification: 'deployable',
      reasonCodes: [],
    })
  })

  it('quarantines an artifact whose stored hash does not match the canonical blueprint hash', () => {
    expect(
      classifyRolloutAuditCandidate({
        ...complete,
        canonicalHash: 'd'.repeat(64),
      })
    ).toEqual({
      classification: 'quarantined',
      reasonCodes: ['content_hash_mismatch'],
    })
  })

  it('quarantines an artifact with an incomplete release identity', () => {
    expect(
      classifyRolloutAuditCandidate({
        ...complete,
        assetManifestHash: null,
      })
    ).toEqual({
      classification: 'quarantined',
      reasonCodes: ['incomplete_release_identity'],
    })
  })
})

describe('SiteForge rollback identity', () => {
  const artifactId = '11111111-1111-4111-8111-111111111111'
  const contentHash = 'a'.repeat(64)
  const valid = {
    requestedArtifactId: artifactId,
    requestedContentHash: contentHash,
    productionArtifactId: artifactId,
    productionContentHash: contentHash,
    productionCertifiedAt: '2026-08-04T18:00:00.000Z',
    productionTargetId: '22222222-2222-4222-8222-222222222222',
    certifiedDeployment: {
      artifact_id: artifactId,
      artifact_content_hash: contentHash,
      remote_manifest_hash: contentHash,
      certified_at: '2026-08-04T18:00:00.000Z',
    },
  }

  it('accepts only the observed certified production manifest', () => {
    expect(() => assertObservedRollbackIdentity(valid)).not.toThrow()
  })

  it('rejects an operator-supplied rollback sibling', () => {
    expect(() =>
      assertObservedRollbackIdentity({
        ...valid,
        requestedArtifactId: '33333333-3333-4333-8333-333333333333',
      })
    ).toThrow('observed certified pre-promotion production artifact')
  })

  it('rejects missing or mismatched remote manifest evidence', () => {
    expect(() =>
      assertObservedRollbackIdentity({
        ...valid,
        certifiedDeployment: {
          ...valid.certifiedDeployment,
          remote_manifest_hash: 'b'.repeat(64),
        },
      })
    ).toThrow('observed certified production manifest')
  })
})

describe('SiteForge launch rollback mode', () => {
  const artifactId = '11111111-1111-4111-8111-111111111111'
  const contentHash = 'a'.repeat(64)
  const neverLaunched = {
    productionArtifactId: null,
    productionContentHash: null,
    productionCertifiedAt: null,
  }
  const live = {
    productionArtifactId: artifactId,
    productionContentHash: contentHash,
    productionCertifiedAt: '2026-08-04T18:00:00.000Z',
  }

  it('allows a bootstrap first launch with no rollback identity', () => {
    expect(
      resolveLaunchRollbackMode({
        rollbackArtifactId: null,
        rollbackContentHash: null,
        ...neverLaunched,
      })
    ).toEqual({ bootstrapLaunch: true })
  })

  it('requires a full rollback identity for a live website', () => {
    expect(() =>
      resolveLaunchRollbackMode({
        rollbackArtifactId: null,
        rollbackContentHash: null,
        ...live,
      })
    ).toThrow('required to update a live website')
  })

  it('rejects a partial rollback identity', () => {
    expect(() =>
      resolveLaunchRollbackMode({
        rollbackArtifactId: artifactId,
        rollbackContentHash: null,
        ...neverLaunched,
      })
    ).toThrow('Exact rollback artifact identity is required')
  })

  it('returns the strict mode when a full rollback identity is supplied', () => {
    expect(
      resolveLaunchRollbackMode({
        rollbackArtifactId: artifactId,
        rollbackContentHash: contentHash,
        ...live,
      })
    ).toEqual({ bootstrapLaunch: false })
  })
})

describe('SiteForge rendered launch certification', () => {
  const artifactId = '11111111-1111-4111-8111-111111111111'
  const contentHash = 'a'.repeat(64)
  const report = {
    passed: true,
    artifactId,
    contentHash,
    browser: { evidenceAccepted: true, passed: true },
  }

  it('requires complete accepted browser evidence, not manifest identity alone', () => {
    expect(
      isRenderedLaunchCertification({ report, artifactId, contentHash })
    ).toBe(true)
    expect(
      isRenderedLaunchCertification({
        report: { passed: true, artifactId, contentHash },
        artifactId,
        contentHash,
      })
    ).toBe(false)
    expect(
      isRenderedLaunchCertification({
        report: {
          ...report,
          browser: { evidenceAccepted: true, passed: false },
        },
        artifactId,
        contentHash,
      })
    ).toBe(false)
  })
})
