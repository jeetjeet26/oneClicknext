import { describe, expect, it } from 'vitest'
import {
  createSiteForgeRoleArtifact,
  parseSiteForgeRoleArtifact,
  SITEFORGE_ROLE_ARTIFACT_SCHEMA_VERSION,
  type SiteForgeRoleArtifactBody,
} from './artifact-envelope'

function artifactBody(
  payload: SiteForgeRoleArtifactBody['payload'] = {
    sections: [{ id: 'hero', title: 'Welcome' }],
    theme: { accent: 'amber', background: 'slate' },
  }
): SiteForgeRoleArtifactBody {
  return {
    schemaVersion: SITEFORGE_ROLE_ARTIFACT_SCHEMA_VERSION,
    role: 'creative-director.v1',
    artifactType: 'siteforge.creative-direction.v1',
    parentHashes: ['1'.repeat(64)],
    evidenceIds: ['evidence-property-1'],
    execution: {
      modelPolicyVersion: 'siteforge.autonomy-model-policy.v1',
      modelId: 'anthropic/claude-fable-5',
      provider: 'anthropic',
      promptVersion: 'siteforge.creative-direction-prompt.v1',
      outputSchemaVersion: 'siteforge.creative-direction.v1',
      evaluatorVersion: 'siteforge.creative-direction-evaluator.v1',
      settings: {
        maxOutputTokens: 30_000,
        temperature: 0.7,
      },
      confidence: 0.91,
      conflicts: [],
    },
    usage: {
      inputTokens: 1_200,
      outputTokens: 800,
      totalTokens: 2_000,
      costUsd: 0.42,
      latencyMs: 2_500,
      attempt: 1,
    },
    validation: {
      valid: true,
      status: 'passed',
      issues: [],
    },
    payload,
  }
}

describe('SiteForge autonomous role artifact envelopes', () => {
  it('hashes equivalent metadata and payloads deterministically', () => {
    const first = createSiteForgeRoleArtifact(artifactBody())
    const second = createSiteForgeRoleArtifact(
      artifactBody({
        theme: { background: 'slate', accent: 'amber' },
        sections: [{ title: 'Welcome', id: 'hero' }],
      })
    )

    expect(first.artifactHash).toMatch(/^[a-f0-9]{64}$/)
    expect(second.artifactHash).toBe(first.artifactHash)
  })

  it('binds parent lineage and detects a tampered envelope', () => {
    const original = createSiteForgeRoleArtifact(artifactBody())
    const differentParent = createSiteForgeRoleArtifact({
      ...artifactBody(),
      parentHashes: ['2'.repeat(64)],
    })

    expect(differentParent.artifactHash).not.toBe(original.artifactHash)
    expect(() =>
      parseSiteForgeRoleArtifact({
        ...original,
        evidenceIds: ['substituted-evidence'],
      })
    ).toThrow(/Artifact hash does not match/)
  })

  it.each([
    [
      'provider mismatch',
      (body: SiteForgeRoleArtifactBody) => ({
        ...body,
        execution: { ...body.execution, provider: 'openai' },
      }),
    ],
    [
      'invalid token total',
      (body: SiteForgeRoleArtifactBody) => ({
        ...body,
        usage: { ...body.usage, totalTokens: 1_999 },
      }),
    ],
    [
      'inconsistent validation',
      (body: SiteForgeRoleArtifactBody) => ({
        ...body,
        validation: { ...body.validation, status: 'failed' as const },
      }),
    ],
  ])('rejects %s metadata', (_label, mutate) => {
    expect(() => createSiteForgeRoleArtifact(mutate(artifactBody()))).toThrow()
  })
})
