import { describe, expect, it } from 'vitest'
import {
  deriveSiteForgeDirectorSnapshot,
  type SiteForgeDirectorSourceSnapshot,
} from './snapshot'

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const ARTIFACT_ID = '44444444-4444-4444-8444-444444444444'
const CONTENT_HASH = 'a'.repeat(64)

function source(
  overrides: Partial<SiteForgeDirectorSourceSnapshot> = {}
): SiteForgeDirectorSourceSnapshot {
  return {
    website: {
      id: WEBSITE_ID,
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      generation_status: 'ready_for_preview',
      generation_progress: 100,
      current_step: 'Ready',
      error_message: null,
      current_artifact_version_id: null,
      canonical_preview_url: null,
      canonical_preview_artifact_id: null,
      canonical_preview_content_hash: null,
      canonical_previewed_at: null,
      staging_target_id: null,
      staging_artifact_id: null,
      staging_content_hash: null,
      staging_url: null,
      staging_certified_at: null,
      production_target_id: null,
      production_artifact_id: null,
      production_content_hash: null,
      production_url: null,
      production_certified_at: null,
    },
    plan: {
      id: '55555555-5555-4555-8555-555555555555',
      status: 'ready_for_review',
      current_revision: 2,
      confirmed_version_id: null,
      confirmed_at: null,
    },
    planVersion: {
      id: '66666666-6666-4666-8666-666666666666',
      plan_id: '55555555-5555-4555-8555-555555555555',
      revision: 2,
      content_hash: 'b'.repeat(64),
      readiness_report: { ready: true, issues: [] },
    },
    artifact: null,
    jobs: [],
    actions: [],
    deployments: [],
    certifications: [],
    release: null,
    incidents: [],
    restore: null,
    health: null,
    autonomy: [],
    ...overrides,
  }
}

function artifactSource() {
  return {
    id: ARTIFACT_ID,
    website_id: WEBSITE_ID,
    property_id: PROPERTY_ID,
    org_id: ORG_ID,
    version: 3,
    content_hash: CONTENT_HASH,
    source_plan_version_id: '66666666-6666-4666-8666-666666666666',
    asset_manifest_hash: 'c'.repeat(64),
    base_theme_package_sha256: 'd'.repeat(64),
    runtime_contract_version: 2,
    runtime_package_sha256: 'e'.repeat(64),
    operation_set_hash: 'f'.repeat(64),
    deployment_decision: null,
  }
}

describe('SiteForge Director snapshot derivation', () => {
  it('derives planning stage and exposes the exact review command', () => {
    const snapshot = deriveSiteForgeDirectorSnapshot(
      source(),
      new Date('2026-08-10T12:00:00.000Z')
    )

    expect(snapshot.stage).toMatchObject({
      key: 'planning',
      status: 'idle',
    })
    expect(
      snapshot.commands.find(command => command.type === 'review_plan')
    ).toMatchObject({
      available: true,
      payload: {
        propertyId: PROPERTY_ID,
        expectedRevision: 2,
        contentHash: 'b'.repeat(64),
      },
    })
  })

  it('fails closed when canonical preview identity differs from the artifact', () => {
    const artifact = artifactSource()
    const input = source({
      artifact,
      website: {
        ...source().website,
        current_artifact_version_id: artifact.id,
        canonical_preview_url: 'https://preview.example.com',
        canonical_preview_artifact_id: artifact.id,
        canonical_preview_content_hash: '0'.repeat(64),
      },
    })

    const snapshot = deriveSiteForgeDirectorSnapshot(input)

    expect(snapshot.artifact.current).toMatchObject({
      artifactId: ARTIFACT_ID,
      version: 3,
      contentHash: CONTENT_HASH,
      runtimeContractVersion: 2,
    })
    expect(snapshot.artifact.preview.exact).toBe(false)
    expect(snapshot.blockers).toContainEqual(
      expect.objectContaining({
        code: 'preview_artifact_identity_mismatch',
        severity: 'blocker',
      })
    )
    expect(
      snapshot.commands.find(command => command.type === 'review_artifact')
    ).toMatchObject({
      available: false,
      unavailableReason:
        'The canonical preview does not match the current artifact identity.',
    })
  })

  it('rejects timestamp-only and stale staging projections', () => {
    const artifact = artifactSource()
    const projectedWebsite = {
      ...source().website,
      current_artifact_version_id: artifact.id,
      staging_target_id: '77777777-7777-4777-8777-777777777777',
      staging_artifact_id: artifact.id,
      staging_content_hash: artifact.content_hash,
      staging_url: 'https://staging.example.com',
      staging_certified_at: '2026-08-10T11:00:00.000Z',
    }
    const projectionOnly = deriveSiteForgeDirectorSnapshot(
      source({ artifact, website: projectedWebsite })
    )
    expect(projectionOnly.artifact.staging.exact).toBe(false)
    expect(
      projectionOnly.commands.find(command => command.type === 'prepare_launch')
    ).toMatchObject({ available: false })

    const staleEvidence = deriveSiteForgeDirectorSnapshot(
      source({
        artifact,
        website: projectedWebsite,
        deployments: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            target_id: projectedWebsite.staging_target_id,
            artifact_id: artifact.id,
            artifact_content_hash: '0'.repeat(64),
            status: 'certified',
            remote_manifest_hash: null,
            certified_at: '2026-08-10T11:00:00.000Z',
            failure_code: null,
            failure_phase: null,
            created_at: '2026-08-10T11:00:00.000Z',
          },
        ],
        certifications: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            artifact_id: artifact.id,
            environment: 'staging',
            status: 'simulated',
            policy_version: 'v1',
            report_hash: '1'.repeat(64),
            created_at: '2026-08-10T11:00:00.000Z',
          },
        ],
      })
    )
    expect(staleEvidence.artifact.staging.exact).toBe(false)
  })

  it('requires exact passed evidence and a certified staging deployment', () => {
    const artifact = artifactSource()
    const stagingTargetId = '77777777-7777-4777-8777-777777777777'
    const snapshot = deriveSiteForgeDirectorSnapshot(
      source({
        artifact,
        website: {
          ...source().website,
          current_artifact_version_id: artifact.id,
          staging_target_id: stagingTargetId,
          staging_artifact_id: artifact.id,
          staging_content_hash: artifact.content_hash,
          staging_url: 'https://staging.example.com',
          staging_certified_at: '2026-08-10T11:00:00.000Z',
        },
        deployments: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            target_id: stagingTargetId,
            artifact_id: artifact.id,
            artifact_content_hash: artifact.content_hash,
            status: 'certified',
            remote_manifest_hash: '2'.repeat(64),
            certified_at: '2026-08-10T11:00:00.000Z',
            failure_code: null,
            failure_phase: null,
            created_at: '2026-08-10T11:00:00.000Z',
          },
        ],
        certifications: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            artifact_id: artifact.id,
            environment: 'staging',
            status: 'passed',
            policy_version: 'v1',
            report_hash: '1'.repeat(64),
            created_at: '2026-08-10T11:00:00.000Z',
          },
        ],
      })
    )

    expect(snapshot.artifact.staging.exact).toBe(true)
    expect(snapshot.certification.staging).toMatchObject({
      status: 'passed',
      exact: true,
    })
  })

  it('prioritizes recovery and surfaces active incidents', () => {
    const snapshot = deriveSiteForgeDirectorSnapshot(
      source({
        incidents: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            severity: 'critical',
            status: 'open',
            category: 'restore_required',
            title: 'Production restore required',
            summary: 'Operator must restore the observed backup.',
            artifact_id: ARTIFACT_ID,
            created_at: '2026-08-10T11:00:00.000Z',
          },
        ],
        restore: {
          id: '88888888-8888-4888-8888-888888888888',
          release_id: null,
          status: 'queued',
          expected_artifact_id: ARTIFACT_ID,
          expected_content_hash: CONTENT_HASH,
          started_at: null,
          completed_at: null,
          created_at: '2026-08-10T11:01:00.000Z',
        },
      })
    )

    expect(snapshot.stage).toMatchObject({
      key: 'recovery',
      status: 'blocked',
    })
    expect(snapshot.production.openIncidentCount).toBe(1)
    expect(
      snapshot.commands.find(command => command.type === 'acknowledge_incident')
    ).toMatchObject({
      available: true,
      target: {
        path: '/api/siteforge/incidents/77777777-7777-4777-8777-777777777777/acknowledge',
      },
    })
  })

  it('offers retry only for eligible failed shared jobs', () => {
    const snapshot = deriveSiteForgeDirectorSnapshot(
      source({
        jobs: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            domain: 'siteforge.generation',
            subject_id: WEBSITE_ID,
            lifecycle_status: 'failed',
            status_reason: 'provider_failed',
            stage: 'failed',
            progress: 40,
            current_step: 'Generation failed',
            attempt_count: 1,
            max_attempts: 3,
            cancel_requested: false,
            retry_at: null,
            error_message: 'Provider unavailable',
            payload: { websiteId: WEBSITE_ID },
            created_at: '2026-08-10T10:00:00.000Z',
            updated_at: '2026-08-10T10:05:00.000Z',
          },
        ],
      })
    )

    expect(snapshot.blockers).toContainEqual(
      expect.objectContaining({
        code: 'job_failed:siteforge.generation',
        entityId: '99999999-9999-4999-8999-999999999999',
      })
    )
    expect(
      snapshot.commands.find(command => command.type === 'retry_job')
    ).toMatchObject({
      available: true,
      target: {
        path: '/api/siteforge/jobs/99999999-9999-4999-8999-999999999999/retry',
      },
    })
  })

  it('surfaces exact account, brief, contradiction, and selected-direction state', () => {
    const snapshot = deriveSiteForgeDirectorSnapshot(
      source({
        brief: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          version: 2,
          status: 'ready_for_review',
          content_hash: '1'.repeat(64),
          unresolved_contradictions: [
            {
              id: 'pricing',
              field: 'pricing',
              description: 'Sources disagree',
              sources: ['a', 'b'],
              resolutionNeeded: 'Confirm',
            },
          ],
          onboarding_snapshot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          onboarding_snapshot_hash: '2'.repeat(64),
          brand_asset_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          brand_contract_hash: '3'.repeat(64),
        },
        directionSet: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: 1,
          status: 'ready_for_review',
          content_hash: '4'.repeat(64),
          brief_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          selected_direction_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        },
        selectedDirection: {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Conversion Clarity',
          content_hash: '5'.repeat(64),
        },
      })
    )

    expect(snapshot.collaboration).toMatchObject({
      account: {
        orgId: ORG_ID,
        propertyId: PROPERTY_ID,
        websiteId: WEBSITE_ID,
      },
      brief: {
        version: 2,
        contradictionCount: 1,
      },
      direction: {
        selectedDirectionName: 'Conversion Clarity',
        selectedDirectionHash: '5'.repeat(64),
      },
    })
    expect(snapshot.blockers).toContainEqual(
      expect.objectContaining({
        code: 'brief_contradictions_unresolved',
        source: 'brief',
      })
    )
  })
})
