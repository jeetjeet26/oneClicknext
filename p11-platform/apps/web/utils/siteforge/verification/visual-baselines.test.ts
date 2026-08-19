import { describe, expect, it, vi } from 'vitest'
import {
  loadExactApprovedVisualBaselines,
  persistVisualBaselineCandidates,
} from './visual-baselines'

vi.mock('@/utils/services/system-policy-decisions', () => ({
  recordSystemPolicyDecision: vi.fn().mockResolvedValue({
    id: '22222222-2222-4222-8222-222222222222',
  }),
}))

const artifact = {
  artifactId: '11111111-1111-4111-8111-111111111111',
  contentHash: 'a'.repeat(64),
  runtimePackageSha256: 'b'.repeat(64),
  runtimeManifestSha256: 'c'.repeat(64),
  overlayPackageSha256: null,
  assetManifestHash: 'd'.repeat(64),
  operationSetHash: 'e'.repeat(64),
}

describe('policy-v16 visual baseline repository', () => {
  it('loads only an exact, immutable approved identity', async () => {
    const filters: Array<[string, unknown]> = []
    const row = {
      id: '44444444-4444-4444-8444-444444444444',
      artifact_id: artifact.artifactId,
      artifact_content_hash: artifact.contentHash,
      page_url: 'https://example.com/',
      viewport: 'mobile',
      environment: 'production',
      access_mode: 'public',
      require_indexable: true,
      policy_version: 'siteforge-browser-certification-v17',
      binding_hash: 'f'.repeat(64),
      evidence_digest: '1'.repeat(64),
      screenshot_storage_path: 'browser-certification/approved/mobile.png',
      screenshot_sha256: '2'.repeat(64),
      approval_id: '55555555-5555-4555-8555-555555555555',
      approved_at: '2026-08-04 18:00:00+00',
      approved_by: '66666666-6666-4666-8666-666666666666',
    }
    const query = {
      select: vi.fn(),
      eq: vi.fn((field: string, value: unknown) => {
        filters.push([field, value])
        return query
      }),
      in: vi.fn().mockResolvedValue({ data: [row], error: null }),
    }
    query.select.mockReturnValue(query)
    const client = { from: vi.fn(() => query) }

    const baselines = await loadExactApprovedVisualBaselines(
      {
        orgId: '77777777-7777-4777-8777-777777777777',
        propertyId: '88888888-8888-4888-8888-888888888888',
        websiteId: '99999999-9999-4999-8999-999999999999',
        artifact,
        expectedUrls: ['https://example.com/'],
        environment: 'production',
        access: 'public',
        requireIndexable: true,
        bindingHash: 'f'.repeat(64),
      },
      client as never
    )

    expect(filters).toEqual(
      expect.arrayContaining([
        ['artifact_id', artifact.artifactId],
        ['artifact_content_hash', artifact.contentHash],
        ['environment', 'production'],
        ['access_mode', 'public'],
        ['require_indexable', true],
        ['binding_hash', 'f'.repeat(64)],
        ['status', 'approved'],
      ])
    )
    expect(baselines).toEqual([
      expect.objectContaining({
        baselineId: row.id,
        approvalId: row.approval_id,
        approvedAt: '2026-08-04T18:00:00.000Z',
        evidenceDigest: row.evidence_digest,
      }),
    ])
  })

  it('persists first captures as immutable candidates without approval work', async () => {
    let inserted: Record<string, unknown> | null = null
    let call = 0
    const client = {
      from: vi.fn(() => {
        call += 1
        if (call === 1) {
          const query = {
            select: vi.fn(),
            eq: vi.fn(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
          query.select.mockReturnValue(query)
          query.eq.mockReturnValue(query)
          return query
        }
        return {
          insert: vi.fn(async (value: Record<string, unknown>) => {
            inserted = value
            return { error: null }
          }),
        }
      }),
    }
    const candidateIds = await persistVisualBaselineCandidates(
      {
        orgId: '77777777-7777-4777-8777-777777777777',
        propertyId: '88888888-8888-4888-8888-888888888888',
        websiteId: '99999999-9999-4999-8999-999999999999',
        artifact,
        environment: 'production',
        access: 'public',
        requireIndexable: true,
        bindingHash: 'f'.repeat(64),
        evidence: {
          evidenceVersion: 'siteforge-browser-evidence-v2',
          capturedAt: '2026-08-04T18:00:00.000Z',
          identity: {
            sessionId: 'session-1',
            targetUrl: 'https://example.com/',
            environment: 'production',
            access: 'public',
            requireIndexable: true,
            artifact: {
              artifactId: artifact.artifactId,
              contentHash: artifact.contentHash,
            },
            artifactBinding: artifact,
            bindingHash: 'f'.repeat(64),
          },
          screenshots: [
            {
              url: 'https://example.com/',
              viewport: 'mobile',
              width: 390,
              height: 844,
              storagePath: 'browser-certification/candidate/mobile.png',
              sha256: '2'.repeat(64),
              bytes: 1024,
              contentType: 'image/png',
              identityDigest: '1'.repeat(64),
            },
          ],
          baselineDiffs: [],
          layout: [],
          interactions: { pages: [] },
          accessibility: { scans: [] },
          lighthouse: { runs: [] },
          seo: {
            pages: [],
            sitemap: {
              url: 'https://example.com/wp-sitemap.xml',
              status: 200,
              listedUrls: [],
            },
            robots: {
              url: 'https://example.com/robots.txt',
              status: 200,
              sitemapUrls: [],
              blockedCriticalUrls: [],
            },
          },
          redirects: { entries: [], criticalRoutes: [] },
          consent: {
            defaultState: 'denied',
            bannerVisible: true,
            preferenceControlsUsable: true,
            declineTested: true,
            grantTested: true,
            scripts: [],
          },
        },
      },
      client as never
    )

    expect(candidateIds).toHaveLength(1)
    expect(inserted).toEqual(
      expect.objectContaining({
        status: 'candidate',
        approval_action_attempt_id: null,
        system_policy_decision_id:
          '22222222-2222-4222-8222-222222222222',
      })
    )
  })
})
