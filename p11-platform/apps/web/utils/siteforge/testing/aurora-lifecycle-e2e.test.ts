import { describe, expect, it } from 'vitest'
import {
  AURORA_LIFECYCLE_REQUIRED_ENV,
  auroraMutationHeaders,
  formatAuroraPreflightFailure,
  inspectAuroraLifecycleEnv,
  type Environment,
} from './aurora-lifecycle-e2e'

const NOW = new Date('2026-08-04T20:00:00.000Z')

function completeEnvironment(): Environment {
  const env = Object.fromEntries(
    AURORA_LIFECYCLE_REQUIRED_ENV.map(key => [key, `configured-${key}`])
  )
  Object.assign(env, {
    AURORA_LIFECYCLE_E2E: '1',
    PLAYWRIGHT_BASE_URL: 'https://aurora-test.p11.test',
    AURORA_LIFECYCLE_PROPERTY_ID: '11111111-1111-4111-8111-111111111111',
    AURORA_LIFECYCLE_WEBSITE_ID: '22222222-2222-4222-8222-222222222222',
    AURORA_LIFECYCLE_TARGET_ID: '33333333-3333-4333-8333-333333333333',
    AURORA_LIFECYCLE_ROLLOUT_ASSIGNMENT_ID:
      '99999999-9999-4999-8999-999999999999',
    AURORA_LIFECYCLE_START_ARTIFACT_ID:
      '44444444-4444-4444-8444-444444444444',
    AURORA_LIFECYCLE_ROLLBACK_ARTIFACT_ID:
      '55555555-5555-4555-8555-555555555555',
    AURORA_LIFECYCLE_OWNER_ID: '66666666-6666-4666-8666-666666666666',
    AURORA_LIFECYCLE_OPERATOR_PROFILE_ID:
      '77777777-7777-4777-8777-777777777777',
    AURORA_LIFECYCLE_REVIEWER_PROFILE_ID:
      '88888888-8888-4888-8888-888888888888',
    AURORA_LIFECYCLE_OPERATOR_EMAIL: 'operator@aurora-test.p11.test',
    AURORA_LIFECYCLE_REVIEWER_EMAIL: 'reviewer@aurora-test.p11.test',
    AURORA_LIFECYCLE_START_CONTENT_HASH: 'a'.repeat(64),
    AURORA_LIFECYCLE_ROLLBACK_CONTENT_HASH: 'b'.repeat(64),
    AURORA_LIFECYCLE_RUNTIME_PACKAGE_SHA256: 'c'.repeat(64),
    AURORA_LIFECYCLE_RUNTIME_MANIFEST_SHA256: 'd'.repeat(64),
    AURORA_LIFECYCLE_BASE_THEME_PACKAGE_SHA256: 'e'.repeat(64),
    AURORA_LIFECYCLE_EXPIRES_AT: '2026-08-05T08:00:00.000Z',
    AURORA_LIFECYCLE_CLEANUP_CONFIRM: 'DELETE_OWNED_AURORA_RESOURCES',
    AURORA_LIFECYCLE_TARGET_URL: 'https://aurora-wp.p11.test',
    AURORA_LIFECYCLE_EXPECTED_URLS: JSON.stringify([
      'https://aurora-wp.p11.test/',
      'https://aurora-wp.p11.test/floor-plans',
    ]),
    SITEFORGE_RUNTIME_V3_ENABLED: 'true',
    SITEFORGE_SEMANTIC_EDITOR_ENABLED: 'true',
    SITEFORGE_RUNTIME_EXTENSIONS_ENABLED: 'true',
    SITEFORGE_REQUIRE_TRUSTED_CERTIFICATION: 'true',
    SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED: 'true',
    SITEFORGE_AURORA_LIFECYCLE_CONTROL_SECRET: 's'.repeat(32),
    AURORA_LIFECYCLE_PROMOTION_OPERATION_ID: 'promotion-operation-1',
  })
  return env
}

describe('Aurora lifecycle E2E preflight', () => {
  it('reports every absent variable without reading secret values', () => {
    const preflight = inspectAuroraLifecycleEnv({}, NOW)
    expect(preflight.ready).toBe(false)
    if (preflight.ready) throw new Error('Expected a failed preflight')
    expect(preflight.missing).toEqual([...AURORA_LIFECYCLE_REQUIRED_ENV])
    expect(formatAuroraPreflightFailure(preflight)).toContain(
      'AURORA_LIFECYCLE_PROPERTY_ID'
    )
  })

  it('accepts only explicit independent, expiring, test-only identities', () => {
    const preflight = inspectAuroraLifecycleEnv(completeEnvironment(), NOW)
    expect(preflight.ready).toBe(true)
    if (!preflight.ready) throw new Error(formatAuroraPreflightFailure(preflight))
    expect(preflight.config.expectedUrls).toHaveLength(2)
    expect(auroraMutationHeaders(preflight.config)).toEqual({
      Authorization: `Bearer ${'s'.repeat(32)}`,
      'x-p11-test-owner-id': preflight.config.ownerId,
      'x-p11-test-expires-at': preflight.config.expiresAt,
      'x-p11-test-property-id': preflight.config.propertyId,
      'x-p11-test-website-id': preflight.config.websiteId,
      'x-p11-test-target-id': preflight.config.targetId,
      'x-p11-test-rollout-assignment-id':
        preflight.config.rolloutAssignmentId,
    })
  })

  it('does not require artifacts or provider operation IDs before bootstrap', () => {
    const env = completeEnvironment()
    delete env.AURORA_LIFECYCLE_START_ARTIFACT_ID
    delete env.AURORA_LIFECYCLE_START_CONTENT_HASH
    delete env.AURORA_LIFECYCLE_ROLLBACK_ARTIFACT_ID
    delete env.AURORA_LIFECYCLE_ROLLBACK_CONTENT_HASH
    delete env.AURORA_LIFECYCLE_BACKUP_OPERATION_ID
    delete env.AURORA_LIFECYCLE_BACKUP_ID
    delete env.AURORA_LIFECYCLE_PROMOTION_OPERATION_ID
    delete env.AURORA_LIFECYCLE_RESTORE_OPERATION_ID
    const preflight = inspectAuroraLifecycleEnv(env, NOW)
    expect(preflight.ready).toBe(true)
    if (!preflight.ready) throw new Error(formatAuroraPreflightFailure(preflight))
    expect(preflight.config.startArtifactId).toBe('')
    expect(preflight.config.backupOperationId).toBe('')
  })

  it('rejects shared reviewers, broad endpoints, disabled v3, and stale leases', () => {
    const env = completeEnvironment()
    env.AURORA_LIFECYCLE_REVIEWER_PROFILE_ID =
      env.AURORA_LIFECYCLE_OPERATOR_PROFILE_ID
    env.AURORA_LIFECYCLE_REVIEWER_EMAIL =
      env.AURORA_LIFECYCLE_OPERATOR_EMAIL
    env.AURORA_LIFECYCLE_TARGET_URL = 'https://www.dividendhomes.com/acacia/'
    env.SITEFORGE_RUNTIME_V3_ENABLED = 'false'
    env.AURORA_LIFECYCLE_EXPIRES_AT = '2026-08-04T19:00:00.000Z'

    const preflight = inspectAuroraLifecycleEnv(env, NOW)
    expect(preflight.ready).toBe(false)
    if (preflight.ready) throw new Error('Expected a failed preflight')
    expect(preflight.invalid.join('\n')).toMatch(/independent/)
    expect(preflight.invalid.join('\n')).toMatch(/must not identify Acacia/)
    expect(preflight.invalid.join('\n')).toMatch(/must equal true/)
    expect(preflight.invalid.join('\n')).toMatch(/next 24 hours/)
  })
})
