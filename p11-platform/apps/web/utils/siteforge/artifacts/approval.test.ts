import { describe, expect, it, vi } from 'vitest'
import { loadDeployableArtifact } from './approval'

function query(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

describe('SiteForge artifact approval gate', () => {
  const artifact = {
    id: '11111111-1111-4111-8111-111111111111',
    website_id: '22222222-2222-4222-8222-222222222222',
    org_id: '33333333-3333-4333-8333-333333333333',
    property_id: '44444444-4444-4444-8444-444444444444',
    version: 1,
    content_hash: 'a'.repeat(64),
    quality_report: { deterministic: { passed: true } },
    approval_action_attempt_id: null,
    deployment_decision: 'pending',
  }
  const website = {
    id: artifact.website_id,
    current_artifact_version_id: artifact.id,
    canonical_preview_artifact_id: artifact.id,
    canonical_preview_content_hash: artifact.content_hash,
    canonical_preview_url: 'https://preview.example.com',
  }

  it('allows human approval when optional browser QA has not run', async () => {
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_blueprint_versions') {
          return query({ data: artifact, error: null })
        }
        if (table === 'property_websites') {
          return query({ data: website, error: null })
        }
        if (table === 'siteforge_certification_evidence') {
          return query({ data: null, error: null })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    await expect(
      loadDeployableArtifact(artifact.id, artifact.property_id, client as never)
    ).resolves.toMatchObject({
      artifact,
      website,
      certification: null,
    })
  })

  it('accepts only a report bound to the exact artifact hash', async () => {
    const certification = {
      id: '55555555-5555-4555-8555-555555555555',
      policy_version: 'siteforge-browser-certification-v1',
      status: 'passed',
      report_hash: 'b'.repeat(64),
      report: {
        passed: true,
        artifactId: artifact.id,
        contentHash: artifact.content_hash,
      },
      created_at: '2026-07-31T20:00:00.000Z',
    }
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_blueprint_versions') {
          return query({ data: artifact, error: null })
        }
        if (table === 'property_websites') {
          return query({ data: website, error: null })
        }
        if (table === 'siteforge_certification_evidence') {
          return query({ data: certification, error: null })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    await expect(
      loadDeployableArtifact(artifact.id, artifact.property_id, client as never)
    ).resolves.toMatchObject({ artifact, website, certification })
  })
})
