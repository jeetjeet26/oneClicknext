import { describe, expect, it, vi } from 'vitest'
import {
  assertDistinctLaunchActors,
  assertFirstLaunchAcknowledgment,
  assertPromotedManifestIdentity,
  assertRestoredManifestExpectation,
  buildRestoreDrillSuccessUpdate,
  requestLaunchRestore,
  resolveLaunchRestoreExpectation,
  signManualPromotionToken,
  verifyManualPromotionToken,
} from './service'

const secret = 'a-test-secret-that-is-definitely-longer-than-32-characters'
const identity = {
  releaseId: '11111111-1111-4111-8111-111111111111',
  artifactId: '22222222-2222-4222-8222-222222222222',
  contentHash: 'a'.repeat(64),
  bindingHash: 'b'.repeat(64),
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
    expect(() =>
      verifyManualPromotionToken(
        token,
        { ...identity, bindingHash: 'c'.repeat(64) },
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

describe('SiteForge launch actor separation', () => {
  it('requires a distinct operator and reviewer', () => {
    expect(() =>
      assertDistinctLaunchActors({
        operatorId: identity.releaseId,
        reviewerId: identity.releaseId,
      })
    ).toThrow('reviewer must be different')
  })

  it('allows only the recorded operator to execute cutover', () => {
    expect(() =>
      assertDistinctLaunchActors({
        operatorId: identity.releaseId,
        reviewerId: identity.artifactId,
        actingOperatorId: '33333333-3333-4333-8333-333333333333',
      })
    ).toThrow('Only the recorded launch operator')
    expect(() =>
      assertDistinctLaunchActors({
        operatorId: identity.releaseId,
        reviewerId: identity.artifactId,
        actingOperatorId: identity.releaseId,
      })
    ).not.toThrow()
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

describe('SiteForge restore drill closure', () => {
  it('marks the drill succeeded with the verified manifest and operation identity', () => {
    const update = buildRestoreDrillSuccessUpdate({
      existingReport: { requestType: 'operator_supervised_restore_request' },
      remoteManifestHash: identity.contentHash,
      manifestVerification: 'exact_siteforge_manifest',
      operationId: 'flex-1234',
      actorId: identity.releaseId,
    })

    expect(update.status).toBe('succeeded')
    expect(new Date(update.completed_at).getTime()).not.toBeNaN()
    expect(update.verification_report).toMatchObject({
      requestType: 'operator_supervised_restore_request',
      remoteManifestHash: identity.contentHash,
      manifestVerification: 'exact_siteforge_manifest',
      verifiedOperationId: 'flex-1234',
      verifiedBy: identity.releaseId,
    })
  })

  it('tolerates a missing or malformed existing report', () => {
    const update = buildRestoreDrillSuccessUpdate({
      existingReport: null,
      remoteManifestHash: identity.contentHash,
      manifestVerification: 'exact_siteforge_manifest',
      operationId: 'flex-1234',
      actorId: identity.releaseId,
    })

    expect(update.verification_report).toEqual({
      remoteManifestHash: identity.contentHash,
      manifestVerification: 'exact_siteforge_manifest',
      verifiedOperationId: 'flex-1234',
      verifiedBy: identity.releaseId,
    })
  })
})

describe('SiteForge first-launch restore verification', () => {
  it('uses the backup as the recovery identity with nullable artifact expectations', () => {
    expect(
      resolveLaunchRestoreExpectation({
        rollbackArtifactId: null,
        rollbackContentHash: null,
        promotedContentHash: identity.contentHash,
      })
    ).toEqual({
      mode: 'pre_siteforge_backup',
      expectedArtifactId: null,
      expectedContentHash: null,
      forbiddenContentHash: identity.contentHash,
    })
  })

  it('accepts only explicitly verified absence of a SiteForge manifest after first-launch restore', () => {
    const expectation = resolveLaunchRestoreExpectation({
      rollbackArtifactId: null,
      rollbackContentHash: null,
      promotedContentHash: identity.contentHash,
    })
    expect(() =>
      assertRestoredManifestExpectation(expectation, {
        verification: 'siteforge_manifest_absent',
        manifestAvailable: false,
        contentHash: null,
      })
    ).not.toThrow()
    expect(() =>
      assertRestoredManifestExpectation(expectation, {
        verification: 'exact_siteforge_manifest',
        manifestAvailable: true,
        contentHash: identity.contentHash,
      })
    ).toThrow('promoted SiteForge manifest is still active')
    expect(() =>
      assertRestoredManifestExpectation(expectation, {
        verification: 'exact_siteforge_manifest',
        manifestAvailable: true,
        contentHash: 'c'.repeat(64),
      })
    ).toThrow('SiteForge manifest is still present')
  })

  it('keeps certified rollback verification exact and rejects partial identities', () => {
    const expectation = resolveLaunchRestoreExpectation({
      rollbackArtifactId: identity.artifactId,
      rollbackContentHash: identity.contentHash,
      promotedContentHash: 'c'.repeat(64),
    })
    expect(() =>
      assertRestoredManifestExpectation(expectation, {
        verification: 'exact_siteforge_manifest',
        manifestAvailable: true,
        contentHash: identity.contentHash,
      })
    ).not.toThrow()
    expect(() =>
      resolveLaunchRestoreExpectation({
        rollbackArtifactId: identity.artifactId,
        rollbackContentHash: null,
        promotedContentHash: identity.contentHash,
      })
    ).toThrow('partial rollback identity')
  })

  it('records a null restored manifest without inventing an artifact hash', () => {
    expect(
      buildRestoreDrillSuccessUpdate({
        existingReport: {
          restoreMode: 'pre_siteforge_backup',
          expectedArtifactId: null,
          expectedContentHash: null,
        },
        remoteManifestHash: null,
        manifestVerification: 'siteforge_manifest_absent',
        operationId: 'restore-operation',
        actorId: identity.releaseId,
      }).verification_report
    ).toMatchObject({
      restoreMode: 'pre_siteforge_backup',
      expectedArtifactId: null,
      expectedContentHash: null,
      remoteManifestHash: null,
      manifestVerification: 'siteforge_manifest_absent',
    })
  })

  it('creates an executable operator restore request for a first launch', async () => {
    const release = {
      id: identity.releaseId,
      org_id: 'org-1',
      property_id: 'property-1',
      website_id: 'website-1',
      artifact_id: identity.artifactId,
      artifact_content_hash: identity.contentHash,
      state: 'promoted',
      created_by: 'launch-operator',
      approved_by: 'independent-reviewer',
      backup_id: 'cloudways-restore-point',
      rollback_artifact_id: null,
      rollback_content_hash: null,
    }
    const insertedDrills: Array<Record<string, unknown>> = []
    const insertedActions: Array<Record<string, unknown>> = []
    const chain = (result: unknown) => {
      const value: Record<string, unknown> = {}
      for (const method of [
        'select',
        'eq',
        'neq',
        'in',
        'is',
        'order',
        'limit',
      ]) {
        value[method] = vi.fn(() => value)
      }
      value.single = vi.fn().mockResolvedValue(result)
      value.maybeSingle = vi.fn().mockResolvedValue(result)
      value.then = (
        resolve: (resolved: unknown) => unknown,
        reject: (error: unknown) => unknown
      ) => Promise.resolve(result).then(resolve, reject)
      return value
    }
    const releaseReads = [
      { data: release, error: null },
      { data: { website_id: release.website_id }, error: null },
    ]
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'siteforge_launch_releases') {
          return {
            select: vi.fn(() => chain(releaseReads.shift())),
          }
        }
        if (table === 'property_websites') {
          return {
            select: vi.fn(() =>
              chain({
                data: { wordpress_credential_ref: null },
                error: null,
              })
            ),
          }
        }
        if (table === 'siteforge_incidents') {
          return {
            select: vi.fn(() => chain({ data: null, error: null })),
            insert: vi.fn(() => chain({ data: null, error: null })),
          }
        }
        if (table === 'shared_jobs') {
          return {
            select: vi.fn(() => chain({ data: null, error: null })),
            insert: vi.fn(() =>
              chain({
                data: { id: 'restore-job', lifecycle_status: 'queued' },
                error: null,
              })
            ),
            update: vi.fn(() =>
              chain({ data: { id: 'restore-job' }, error: null })
            ),
          }
        }
        if (table === 'shared_action_attempts') {
          return {
            select: vi.fn(() => chain({ data: null, error: null })),
            insert: vi.fn((values: Record<string, unknown>) => {
              insertedActions.push(values)
              return chain({ data: { id: 'restore-action' }, error: null })
            }),
          }
        }
        if (table === 'siteforge_restore_drills') {
          return {
            select: vi.fn(() => chain({ data: null, error: null })),
            insert: vi.fn((values: Record<string, unknown>) => {
              insertedDrills.push(values)
              return chain({ data: null, error: null })
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    await expect(
      requestLaunchRestore(
        {
          releaseId: release.id,
          propertyId: release.property_id,
          rationale: 'Public certification failed',
          actorId: release.created_by,
          source: 'production_failure',
        },
        client as never
      )
    ).resolves.toMatchObject({
      manualRequired: true,
      requiredConfirmation: 'restore',
    })
    expect(insertedDrills).toHaveLength(1)
    expect(insertedDrills[0]).toMatchObject({
      backup_id: release.backup_id,
      expected_artifact_id: null,
      // Required legacy storage is explicitly identified as the forbidden
      // promoted hash in the nullable semantic report.
      expected_content_hash: release.artifact_content_hash,
      verification_report: {
        restoreMode: 'pre_siteforge_backup',
        expectedArtifactId: null,
        expectedContentHash: null,
        forbiddenContentHash: release.artifact_content_hash,
      },
    })
    expect(insertedActions[0]).toMatchObject({
      requested_by: release.created_by,
      reviewed_by: release.approved_by,
      request_payload: {
        restoreMode: 'pre_siteforge_backup',
        rollbackArtifactId: null,
        rollbackContentHash: null,
      },
    })
  })
})
