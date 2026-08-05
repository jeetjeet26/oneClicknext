import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceClient, from } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))

import {
  assertExactStagingManifest,
  assertStagingDeploymentActive,
  readCloudwaysProvisioningCheckpoint,
  type SiteForgeStagingWorkflowInput,
} from '@/utils/siteforge/workflows/staging-steps'

const input: SiteForgeStagingWorkflowInput = {
  sharedJobId: '11111111-1111-4111-8111-111111111111',
  deploymentId: '22222222-2222-4222-8222-222222222222',
  targetId: '33333333-3333-4333-8333-333333333333',
  websiteId: '44444444-4444-4444-8444-444444444444',
  propertyId: '55555555-5555-4555-8555-555555555555',
  orgId: '66666666-6666-4666-8666-666666666666',
  artifactId: '77777777-7777-4777-8777-777777777777',
  contentHash: 'a'.repeat(64),
  approvalId: '88888888-8888-4888-8888-888888888888',
  localSimulation: true,
  startedAt: '2026-07-30T20:00:00.000Z',
}

function query(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue(result)
  return builder
}

function arrange(currentArtifactId = input.artifactId) {
  from.mockImplementation((table: string) => {
    if (table === 'shared_jobs') {
      return query({
        data: {
          lifecycle_status: 'running',
          cancel_requested: false,
          lease_owner: `siteforge-staging:${input.sharedJobId}`,
        },
      })
    }
    if (table === 'property_websites') {
      return query({
        data: {
          current_artifact_version_id: currentArtifactId,
          canonical_preview_artifact_id: input.artifactId,
          canonical_preview_content_hash: input.contentHash,
          editor_lifecycle_status: 'approved_for_staging',
        },
      })
    }
    if (table === 'siteforge_blueprint_versions') {
      return query({
        data: {
          content_hash: input.contentHash,
          deployment_decision: 'approved',
          confirmed_approval_id: input.approvalId,
        },
      })
    }
    throw new Error(`Unexpected table ${table}`)
  })
}

describe('Cloudways staging workflow guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServiceClient.mockReturnValue({ from })
  })

  it('allows only the exact approved and previewed artifact', async () => {
    arrange()
    await expect(assertStagingDeploymentActive(input)).resolves.toBeUndefined()
  })

  it('rejects deployment after the current artifact changes', async () => {
    arrange('99999999-9999-4999-8999-999999999999')
    await expect(assertStagingDeploymentActive(input)).rejects.toThrow(
      'artifact changed after preview approval'
    )
  })

  it('restores the Cloudways operation identity from a persisted retry checkpoint', () => {
    expect(
      readCloudwaysProvisioningCheckpoint({
        provisioningCheckpoint: {
          operationId: 'operation-123',
          applicationId: 'application-456',
        },
      })
    ).toEqual({
      operationId: 'operation-123',
      applicationId: 'application-456',
    })
  })

  it('rejects a staging readback that differs from the approved artifact', () => {
    expect(() =>
      assertExactStagingManifest(input.contentHash, 'b'.repeat(64))
    ).toThrow('Cloudways staging manifest does not match')
    expect(() =>
      assertExactStagingManifest(input.contentHash, input.contentHash)
    ).not.toThrow()
  })
})
