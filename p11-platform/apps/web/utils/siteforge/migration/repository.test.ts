import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalizeSiteForgeContent,
  hashSiteForgeContent,
} from '@/utils/siteforge/content-hash'

const { proposeSharedActionMock, recordSharedApprovalDecisionMock } = vi.hoisted(() => ({
  proposeSharedActionMock: vi.fn(),
  recordSharedApprovalDecisionMock: vi.fn(),
}))
vi.mock('@/utils/services/shared-executor', () => ({
  proposeSharedAction: proposeSharedActionMock,
}))
vi.mock('@/utils/services/shared-approvals', () => ({
  recordSharedApprovalDecision: recordSharedApprovalDecisionMock,
}))

import {
  createMigrationManifest,
  decideMigrationManifest,
  recordMigrationImported,
  recordPostLaunchCrawlVerification,
} from './repository'

function minimalManifest() {
  const manifest = {
    propertyId: '11111111-1111-4111-8111-111111111111',
    sourceUrl: 'https://www.dividendhomes.com',
    sourceReadOnly: true,
    sourceInventory: {
      origin: 'https://www.dividendhomes.com',
      pages: [
        {
          url: 'https://www.dividendhomes.com/',
          finalUrl: null,
          statusCode: 200,
          canonicalUrl: 'https://www.dividendhomes.com/',
          pageType: 'home',
          inSitemap: true,
        },
      ],
      sitemapUrls: [],
      proposedIA: [],
      readOnlyProof: {
        sourceOrigin: 'https://www.dividendhomes.com',
        targetOrigin: 'https://aurora.siteforge.example',
        sourceRole: 'read_only',
        targetRole: 'write_target',
        allowedSourceMethods: ['GET', 'HEAD'],
        sourceMutationAllowed: false,
      },
    },
    contentManifest: {
      pages: [
        {
          url: 'https://www.dividendhomes.com/',
          canonicalUrl: 'https://www.dividendhomes.com/',
          targetUrl: 'https://aurora.siteforge.example/',
          metadata: {},
          schema: {},
          content: {},
          provenance: {
            captureMode: 'read_only',
            sourceUrl: 'https://www.dividendhomes.com/',
            contentHash: 'a'.repeat(64),
          },
        },
      ],
    },
    assetManifest: [],
    formManifest: [],
    redirectMap: [
      {
        from: 'https://www.dividendhomes.com/',
        to: 'https://aurora.siteforge.example/',
        status: '301',
      },
    ],
    redirectDecisions: [
      {
        sourceUrl: 'https://www.dividendhomes.com/',
        decision: 'redirect',
        targetUrl: 'https://aurora.siteforge.example/',
        reason: 'Generated target route.',
      },
    ],
    unmigratedItems: [],
    dnsSnapshot: {
      captureMode: 'read_only',
      status: 'not_captured',
      records: [],
    },
    parityReport: {
      status: 'complete',
      algorithm: 'siteforge-parity-v1',
      checkedUrls: 1,
      sideBySide: [
        {
          source: {
            url: 'https://www.dividendhomes.com/',
            contentHash: 'a'.repeat(64),
            metadataHash: 'b'.repeat(64),
            assetCount: 0,
            formCount: 0,
          },
          target: {
            url: 'https://aurora.siteforge.example/',
            contentHash: 'a'.repeat(64),
            metadataHash: 'b'.repeat(64),
            assetCount: 0,
            formCount: 0,
          },
          checks: { content: true, metadata: true, assets: true, forms: true },
          status: 'matched',
        },
      ],
    },
    postLaunchCrawl: {
      status: 'pending',
      requiredChecks: ['all_old_urls_resolve_once'],
    },
  }
  const content = {
    sourceUrl: manifest.sourceUrl,
    sourceReadOnly: manifest.sourceReadOnly,
    sourceInventory: manifest.sourceInventory,
    contentManifest: manifest.contentManifest,
    assetManifest: manifest.assetManifest,
    formManifest: manifest.formManifest,
    redirectMap: manifest.redirectMap,
    redirectDecisions: manifest.redirectDecisions,
    unmigratedItems: manifest.unmigratedItems,
    dnsSnapshot: manifest.dnsSnapshot,
    parityReport: manifest.parityReport,
  }
  const manifestHash = hashSiteForgeContent(content)
  const provenance = {
    producer: 'p11-data-engine/siteaudit' as const,
    schemaVersion: 'siteforge-migration-manifest-v2' as const,
    crawlId: 'crawl-test',
    generatedAt: '2026-08-10T12:00:00.000Z',
    checkedUrlCount: 1,
    manifestHash,
  }
  return {
    ...manifest,
    crawlerProvenance: {
      ...provenance,
      signature: createHmac(
        'sha256',
        process.env.SITEFORGE_MIGRATION_MANIFEST_SECRET!
      )
        .update(
          canonicalizeSiteForgeContent({
            ...provenance,
            sourceUrl: manifest.sourceUrl,
          })
        )
        .digest('hex'),
    },
  }
}

function repositoryClient() {
  const website = {
    id: '22222222-2222-4222-8222-222222222222',
    org_id: '33333333-3333-4333-8333-333333333333',
    property_id: '11111111-1111-4111-8111-111111111111',
  }
  let inserted: Record<string, unknown> | null = null
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'property_websites') {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          single: vi.fn().mockResolvedValue({ data: website, error: null }),
        }
        return chain
      }
      if (table === 'siteforge_migration_manifests') {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn((value: Record<string, unknown>) => {
            inserted = value
            return chain
          }),
          update: vi.fn((value: Record<string, unknown>) => {
            inserted = { ...inserted, ...value }
            return chain
          }),
          single: vi.fn(async () => ({
            data: {
              ...inserted,
              id: '44444444-4444-4444-8444-444444444444',
              org_id: website.org_id,
              property_id: website.property_id,
              website_id: website.id,
            },
            error: null,
          })),
        }
        return chain
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
  return { client, inserted: () => inserted }
}

function postLaunchVerification(manifestHash: string) {
  const requiredChecks = ['all_old_urls_resolve_once']
  const evidence = [
    {
      url: 'https://aurora.siteforge.example/',
      statusCode: 200,
      passed: true,
      checks: { all_old_urls_resolve_once: true },
    },
  ]
  const failures: typeof evidence = []
  const evidenceHash = hashSiteForgeContent(evidence)
  const payload = {
    schemaVersion: 'siteforge-post-launch-crawl-v1',
    crawlId: 'post-launch-test',
    verifiedAt: '2026-08-10T13:00:00.000Z',
    checkedUrls: 1,
    status: 'passed',
    requiredChecks,
    evidenceHash,
    failuresHash: hashSiteForgeContent(failures),
    manifestHash,
  }
  return {
    status: 'passed' as const,
    requiredChecks,
    verifiedAt: payload.verifiedAt,
    checkedUrls: 1,
    failures,
    evidence,
    evidenceHash,
    manifestHash,
    provenance: {
      producer: 'p11-data-engine/siteaudit' as const,
      schemaVersion: 'siteforge-post-launch-crawl-v1' as const,
      crawlId: payload.crawlId,
      signature: createHmac(
        'sha256',
        process.env.SITEFORGE_MIGRATION_MANIFEST_SECRET!
      )
        .update(canonicalizeSiteForgeContent(payload))
        .digest('hex'),
    },
  }
}

function postLaunchClient(
  contentHash: string,
  status = 'imported',
  confirmedApprovalId: string | null =
    '77777777-7777-4777-8777-777777777777'
) {
  let update: Record<string, unknown> | null = null
  const row = {
    id: '44444444-4444-4444-8444-444444444444',
    org_id: '33333333-3333-4333-8333-333333333333',
    property_id: '11111111-1111-4111-8111-111111111111',
    website_id: '22222222-2222-4222-8222-222222222222',
    status,
    content_hash: contentHash,
    confirmed_approval_id: confirmedApprovalId,
  }
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    update = payload
    return chain
  })
  chain.single = vi.fn(async () => ({
    data: update ? { ...row, ...update } : row,
    error: null,
  }))
  return {
    client: { from: vi.fn(() => chain) },
    update: () => update,
  }
}

function lifecycleClient(
  manifest: ReturnType<typeof minimalManifest>,
  status: string,
  confirmedApprovalId: string | null
) {
  let update: Record<string, unknown> | null = null
  const row = {
    id: '44444444-4444-4444-8444-444444444444',
    org_id: '33333333-3333-4333-8333-333333333333',
    property_id: manifest.propertyId,
    website_id: '22222222-2222-4222-8222-222222222222',
    version: 1,
    status,
    source_url: manifest.sourceUrl,
    source_read_only: true,
    source_inventory: {
      ...manifest.sourceInventory,
      crawlerProvenance: manifest.crawlerProvenance,
      redirectDecisions: manifest.redirectDecisions,
    },
    content_manifest: manifest.contentManifest,
    asset_manifest: manifest.assetManifest,
    form_manifest: manifest.formManifest,
    redirect_map: manifest.redirectMap,
    unmigrated_items: manifest.unmigratedItems,
    dns_snapshot: manifest.dnsSnapshot,
    parity_report: manifest.parityReport,
    post_launch_crawl: manifest.postLaunchCrawl,
    content_hash: manifest.crawlerProvenance.manifestHash,
    shared_job_id: '55555555-5555-4555-8555-555555555555',
    approval_action_attempt_id: '66666666-6666-4666-8666-666666666666',
    confirmed_approval_id: confirmedApprovalId,
    created_by: null,
    created_at: '2026-08-10T12:00:00.000Z',
    updated_at: '2026-08-10T12:00:00.000Z',
  }
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    update = payload
    return chain
  })
  chain.single = vi.fn(async () => ({
    data: update ? { ...row, ...update } : row,
    error: null,
  }))
  return {
    client: { from: vi.fn(() => chain) },
    update: () => update,
  }
}

describe('SiteForge migration repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      'SITEFORGE_MIGRATION_MANIFEST_SECRET',
      'test-only-migration-manifest-secret-32-bytes'
    )
    proposeSharedActionMock.mockResolvedValue({
      sharedJobId: '55555555-5555-4555-8555-555555555555',
      sharedActionAttemptId: '66666666-6666-4666-8666-666666666666',
    })
    recordSharedApprovalDecisionMock.mockResolvedValue({
      approval: { id: '77777777-7777-4777-8777-777777777777' },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('proposes exact-manifest approval through the shared substrate', async () => {
    const fake = repositoryClient()
    const created = await createMigrationManifest(
      {
        websiteId: '22222222-2222-4222-8222-222222222222',
        userId: '77777777-7777-4777-8777-777777777777',
        manifest: minimalManifest(),
      },
      fake.client as never
    )

    expect(proposeSharedActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'siteforge',
        subjectType: 'migration_manifest',
        action: expect.objectContaining({
          actionType: 'siteforge.migration:approve_manifest',
        }),
      })
    )
    expect(fake.inserted()).toEqual(
      expect.objectContaining({
        source_read_only: true,
        status: 'ready_for_review',
        shared_job_id: '55555555-5555-4555-8555-555555555555',
        approval_action_attempt_id: '66666666-6666-4666-8666-666666666666',
      })
    )
    expect(created.content_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a stale caller-substituted crawler manifest hash', async () => {
    const fake = repositoryClient()
    const manifest = minimalManifest()
    manifest.sourceInventory.pages[0]!.pageType = 'fabricated'

    await expect(
      createMigrationManifest(
        {
          websiteId: '22222222-2222-4222-8222-222222222222',
          userId: '77777777-7777-4777-8777-777777777777',
          manifest,
        },
        fake.client as never
      )
    ).rejects.toThrow(/hash is stale or invalid/)
  })

  it('approves signed source, parity, and redirect evidence before import', async () => {
    const manifest = minimalManifest()
    const fake = lifecycleClient(manifest, 'ready_for_review', null)

    const result = await decideMigrationManifest(
      {
        manifestId: '44444444-4444-4444-8444-444444444444',
        websiteId: '22222222-2222-4222-8222-222222222222',
        propertyId: manifest.propertyId,
        reviewerProfileId: '88888888-8888-4888-8888-888888888888',
        contentHash: manifest.crawlerProvenance.manifestHash,
        decisionStatus: 'approved',
        decisionReason: 'Signed pre-import evidence reviewed.',
      },
      fake.client as never
    )

    expect(manifest.postLaunchCrawl.status).toBe('pending')
    expect(result.status).toBe('approved')
    expect(fake.update()).toEqual(
      expect.objectContaining({
        status: 'approved',
        confirmed_approval_id: '77777777-7777-4777-8777-777777777777',
      })
    )
  })

  it('records import without treating it as verification', async () => {
    const manifest = minimalManifest()
    const fake = lifecycleClient(
      manifest,
      'approved',
      '77777777-7777-4777-8777-777777777777'
    )

    const result = await recordMigrationImported(
      {
        manifestId: '44444444-4444-4444-8444-444444444444',
        websiteId: '22222222-2222-4222-8222-222222222222',
        propertyId: manifest.propertyId,
        contentHash: manifest.crawlerProvenance.manifestHash,
      },
      fake.client as never
    )

    expect(result.status).toBe('imported')
    expect(result.post_launch_crawl).toEqual(
      expect.objectContaining({ status: 'pending' })
    )
  })

  it('rejects verification without completed post-launch evidence', async () => {
    const contentHash = 'a'.repeat(64)
    const fake = postLaunchClient(contentHash)

    await expect(
      recordPostLaunchCrawlVerification(
        {
          manifestId: '44444444-4444-4444-8444-444444444444',
          websiteId: '22222222-2222-4222-8222-222222222222',
          propertyId: '11111111-1111-4111-8111-111111111111',
          contentHash,
          verification: {
            status: 'pending',
            requiredChecks: ['all_old_urls_resolve_once'],
          },
        },
        fake.client as never
      )
    ).rejects.toThrow()
    expect(fake.update()).toBeNull()
  })

  it('rejects post-launch inversion and verified-state replay', async () => {
    const contentHash = 'a'.repeat(64)
    const verification = postLaunchVerification(contentHash)
    await expect(
      recordPostLaunchCrawlVerification(
        {
          manifestId: '44444444-4444-4444-8444-444444444444',
          websiteId: '22222222-2222-4222-8222-222222222222',
          propertyId: '11111111-1111-4111-8111-111111111111',
          contentHash,
          verification,
        },
        postLaunchClient(
          contentHash,
          'approved',
          '77777777-7777-4777-8777-777777777777'
        ).client as never
      )
    ).rejects.toThrow(/approved -> verified/)
    await expect(
      recordPostLaunchCrawlVerification(
        {
          manifestId: '44444444-4444-4444-8444-444444444444',
          websiteId: '22222222-2222-4222-8222-222222222222',
          propertyId: '11111111-1111-4111-8111-111111111111',
          contentHash,
          verification,
        },
        postLaunchClient(
          contentHash,
          'verified',
          '77777777-7777-4777-8777-777777777777'
        ).client as never
      )
    ).rejects.toThrow(/verified -> verified/)
  })

  it('rejects fabricated post-launch evidence and accepts signed crawler evidence', async () => {
    const contentHash = 'a'.repeat(64)
    const fabricated = postLaunchVerification(contentHash)
    fabricated.provenance.signature = 'f'.repeat(64)
    await expect(
      recordPostLaunchCrawlVerification(
        {
          manifestId: '44444444-4444-4444-8444-444444444444',
          websiteId: '22222222-2222-4222-8222-222222222222',
          propertyId: '11111111-1111-4111-8111-111111111111',
          contentHash,
          verification: fabricated,
        },
        postLaunchClient(contentHash).client as never
      )
    ).rejects.toThrow(/signature is invalid/)

    const fake = postLaunchClient(contentHash)
    await recordPostLaunchCrawlVerification(
      {
        manifestId: '44444444-4444-4444-8444-444444444444',
        websiteId: '22222222-2222-4222-8222-222222222222',
        propertyId: '11111111-1111-4111-8111-111111111111',
        contentHash,
        verification: postLaunchVerification(contentHash),
      },
      fake.client as never
    )
    expect(fake.update()).toEqual(
      expect.objectContaining({
        status: 'verified',
        post_launch_crawl: expect.objectContaining({
          status: 'passed',
          checkedUrls: 1,
        }),
      })
    )
  })
})
