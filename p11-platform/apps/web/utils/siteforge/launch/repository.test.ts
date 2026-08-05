import { describe, expect, it } from 'vitest'
import {
  assertObservedRollbackIdentity,
  isLaunchChatbotContextReady,
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
