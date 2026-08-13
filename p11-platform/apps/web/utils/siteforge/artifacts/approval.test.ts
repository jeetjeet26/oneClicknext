import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CANONICAL_PREVIEW_ITERATION_POLICY,
  decideSiteForgeArtifactDeployment,
  loadDeployableArtifact,
  SiteForgeArtifactApprovalError,
} from './approval'

const { proposeSharedActionMock, recordSharedApprovalDecisionMock } = vi.hoisted(
  () => ({
    proposeSharedActionMock: vi.fn(),
    recordSharedApprovalDecisionMock: vi.fn(),
  })
)

vi.mock('@/utils/services/shared-executor', () => ({
  proposeSharedAction: proposeSharedActionMock,
}))

vi.mock('@/utils/services/shared-approvals', () => ({
  recordSharedApprovalDecision: recordSharedApprovalDecisionMock,
}))

function query(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

function updateQuery(
  apply: () => {
    data: { id: string } | null
    error: { message: string } | null
  }
) {
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.is = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => apply())
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
    confirmed_approval_id: null,
    deployment_decision: 'pending',
    decision_reason: null,
    deployment_approved_by: null,
    deployment_approved_at: null,
  }
  const website = {
    id: artifact.website_id,
    current_artifact_version_id: artifact.id,
    canonical_preview_artifact_id: artifact.id,
    canonical_preview_content_hash: artifact.content_hash,
    canonical_preview_url: 'https://preview.example.com',
    editor_lifecycle_status: 'preview_ready',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows protected preview iteration without treating it as public certification', async () => {
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
    expect(CANONICAL_PREVIEW_ITERATION_POLICY).toMatchObject({
      environment: 'protected_preview',
      browserEvidenceRequiredForIteration: false,
      publicStagingCertificationRequired: true,
      productionCertificationRequired: true,
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

  function decisionFixture(options?: {
    artifactUpdateFailures?: number
    websiteUpdateFailures?: number
    actionContentHash?: string
  }) {
    const persistedArtifact = {
      ...artifact,
      approval_action_attempt_id: '55555555-5555-4555-8555-555555555555',
    }
    const persistedWebsite = { ...website }
    const action = {
      id: persistedArtifact.approval_action_attempt_id,
      org_id: artifact.org_id,
      property_id: artifact.property_id,
      action_type: 'siteforge.artifact:deploy_staging',
      proposal_decision_status: 'approved',
      request_payload: {
        artifactId: artifact.id,
        contentHash: options?.actionContentHash ?? artifact.content_hash,
      },
      execution_payload: {
        artifactId: artifact.id,
        websiteId: artifact.website_id,
        contentHash: options?.actionContentHash ?? artifact.content_hash,
      },
    }
    let artifactFailures = options?.artifactUpdateFailures ?? 0
    let websiteFailures = options?.websiteUpdateFailures ?? 0
    const artifactUpdates: Array<Record<string, unknown>> = []
    const websiteUpdates: Array<Record<string, unknown>> = []

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_blueprint_versions') {
          return {
            ...query({ data: persistedArtifact, error: null }),
            update: vi.fn((values: Record<string, unknown>) =>
              updateQuery(() => {
                artifactUpdates.push(values)
                if (artifactFailures > 0) {
                  artifactFailures -= 1
                  return {
                    data: null,
                    error: { message: 'artifact update failed' },
                  }
                }
                Object.assign(persistedArtifact, values)
                return { data: { id: artifact.id }, error: null }
              })
            ),
          }
        }
        if (table === 'property_websites') {
          return {
            ...query({ data: persistedWebsite, error: null }),
            update: vi.fn((values: Record<string, unknown>) =>
              updateQuery(() => {
                websiteUpdates.push(values)
                if (websiteFailures > 0) {
                  websiteFailures -= 1
                  return {
                    data: null,
                    error: { message: 'website update failed' },
                  }
                }
                Object.assign(persistedWebsite, values)
                return { data: { id: website.id }, error: null }
              })
            ),
          }
        }
        if (table === 'siteforge_certification_evidence') {
          return query({ data: null, error: null })
        }
        if (table === 'shared_action_attempts') {
          return query({ data: action, error: null })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    recordSharedApprovalDecisionMock.mockResolvedValue({
      approval: { id: '66666666-6666-4666-8666-666666666666' },
      policyDecision: { id: '77777777-7777-4777-8777-777777777777' },
      actionAttempt: {
        id: action.id,
        proposalDecisionStatus: 'approved',
      },
    })

    return {
      action,
      artifact: persistedArtifact,
      artifactUpdates,
      client,
      website: persistedWebsite,
      websiteUpdates,
    }
  }

  const approvalInput = {
    artifactId: artifact.id,
    propertyId: artifact.property_id,
    reviewerProfileId: '88888888-8888-4888-8888-888888888888',
    contentHash: artifact.content_hash,
    decisionStatus: 'approved' as const,
    decisionReason: 'Looks good',
  }

  it('retries after the shared decision persisted but the artifact write failed', async () => {
    const fixture = decisionFixture({ artifactUpdateFailures: 1 })

    await expect(
      decideSiteForgeArtifactDeployment(
        approvalInput,
        fixture.client as never
      )
    ).rejects.toMatchObject({
      message: 'Failed to persist artifact deployment decision',
      statusCode: 500,
    } satisfies Partial<SiteForgeArtifactApprovalError>)

    await expect(
      decideSiteForgeArtifactDeployment(
        approvalInput,
        fixture.client as never
      )
    ).resolves.toMatchObject({
      artifactId: artifact.id,
      approvalId: '66666666-6666-4666-8666-666666666666',
    })
    expect(fixture.artifactUpdates).toHaveLength(2)
    expect(fixture.websiteUpdates).toHaveLength(1)
    expect(recordSharedApprovalDecisionMock).toHaveBeenCalledTimes(2)
    expect(proposeSharedActionMock).not.toHaveBeenCalled()
  })

  it('repairs only the missing website projection after its write failed', async () => {
    const fixture = decisionFixture({ websiteUpdateFailures: 1 })

    await expect(
      decideSiteForgeArtifactDeployment(
        approvalInput,
        fixture.client as never
      )
    ).rejects.toMatchObject({
      message: 'Failed to persist website approval lifecycle',
      statusCode: 500,
    } satisfies Partial<SiteForgeArtifactApprovalError>)

    await expect(
      decideSiteForgeArtifactDeployment(
        approvalInput,
        fixture.client as never
      )
    ).resolves.toMatchObject({
      decisionStatus: 'approved',
    })
    await expect(
      decideSiteForgeArtifactDeployment(
        approvalInput,
        fixture.client as never
      )
    ).resolves.toMatchObject({
      decisionStatus: 'approved',
    })

    expect(fixture.artifactUpdates).toHaveLength(1)
    expect(fixture.websiteUpdates).toHaveLength(2)
    expect(fixture.website.editor_lifecycle_status).toBe(
      'approved_for_staging'
    )
  })

  it('rejects a retry with a different artifact hash before recording a decision', async () => {
    const fixture = decisionFixture()

    await expect(
      decideSiteForgeArtifactDeployment(
        { ...approvalInput, contentHash: 'b'.repeat(64) },
        fixture.client as never
      )
    ).rejects.toMatchObject({
      message: 'Artifact content changed; review the latest canonical preview',
      statusCode: 409,
    } satisfies Partial<SiteForgeArtifactApprovalError>)
    expect(recordSharedApprovalDecisionMock).not.toHaveBeenCalled()
  })

  it('rejects an existing action attempt bound to a different hash', async () => {
    const fixture = decisionFixture({ actionContentHash: 'b'.repeat(64) })

    await expect(
      decideSiteForgeArtifactDeployment(
        approvalInput,
        fixture.client as never
      )
    ).rejects.toMatchObject({
      message:
        'Artifact deployment proposal is bound to different artifact details',
      statusCode: 409,
    } satisfies Partial<SiteForgeArtifactApprovalError>)
    expect(recordSharedApprovalDecisionMock).not.toHaveBeenCalled()
  })
})
