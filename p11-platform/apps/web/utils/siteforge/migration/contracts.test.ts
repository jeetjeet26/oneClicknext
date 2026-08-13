import { describe, expect, it } from 'vitest'
import {
  ACACIA_AURORA_MIGRATION_PROOF,
  assertAcaciaCannotBeMutationTarget,
  postLaunchVerificationInputSchema,
  redirectMapSchema,
  siteForgeMigrationManifestInputSchema,
} from './contracts'

const propertyId = '11111111-1111-4111-8111-111111111111'

function acaciaManifest() {
  return {
    propertyId,
    crawlerProvenance: {
      producer: 'p11-data-engine/siteaudit',
      schemaVersion: 'siteforge-migration-manifest-v2',
      crawlId: 'crawl-acacia',
      generatedAt: '2026-08-10T12:00:00.000Z',
      checkedUrlCount: 1,
      manifestHash: 'd'.repeat(64),
      signature: 'e'.repeat(64),
    },
    sourceUrl: ACACIA_AURORA_MIGRATION_PROOF.sourceUrl,
    sourceReadOnly: true,
    sourceInventory: {
      origin: ACACIA_AURORA_MIGRATION_PROOF.sourceUrl,
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
      sitemapUrls: ['https://www.dividendhomes.com/'],
      proposedIA: [
        {
          sourceUrl: 'https://www.dividendhomes.com/',
          targetUrl: 'https://aurora.siteforge.example/',
          pageType: 'home',
          title: 'Acacia',
          parentPath: '/',
        },
      ],
      readOnlyProof: {
        sourceOrigin: 'https://www.dividendhomes.com',
        targetOrigin: 'https://aurora.siteforge.example',
        sourceRole: 'read_only',
        targetRole: 'write_target',
        allowedSourceMethods: ['GET', 'HEAD', 'OPTIONS'],
        sourceMutationAllowed: false,
      },
    },
    contentManifest: {
      pages: [
        {
          url: 'https://www.dividendhomes.com/',
          canonicalUrl: 'https://www.dividendhomes.com/',
          targetUrl: 'https://aurora.siteforge.example/',
          metadata: { title: 'Acacia' },
          schema: { types: ['ApartmentComplex'] },
          content: { visible_text: 'Acacia apartment homes' },
          provenance: {
            sourceUrl: 'https://www.dividendhomes.com/',
            captureMode: 'read_only',
            contentHash: 'a'.repeat(64),
          },
        },
      ],
    },
    assetManifest: [
      {
        sourceUrl: 'https://www.dividendhomes.com/acacia.jpg',
        discoveredOn: ['https://www.dividendhomes.com/'],
        provenance: {
          sourcePage: 'https://www.dividendhomes.com/',
          captureMode: 'read_only',
        },
      },
    ],
    formManifest: [
      {
        sourcePage: 'https://www.dividendhomes.com/',
        action: 'https://www.dividendhomes.com/contact',
        method: 'post',
        fields: [{ name: 'email', type: 'email' }],
        provenance: { captureMode: 'read_only', valuesCaptured: false },
      },
    ],
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
      status: 'captured',
      records: [{ type: 'CNAME', name: 'www', value: 'old-host.example' }],
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
            assetCount: 1,
            formCount: 1,
          },
          target: {
            url: 'https://aurora.siteforge.example/',
            contentHash: 'a'.repeat(64),
            metadataHash: 'b'.repeat(64),
            assetCount: 1,
            formCount: 1,
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
}

describe('SiteForge migration contracts', () => {
  it('accepts an explicit Acacia-read-only and Aurora-target manifest', () => {
    expect(siteForgeMigrationManifestInputSchema.safeParse(acaciaManifest()).success).toBe(
      true
    )
    expect(
      assertAcaciaCannotBeMutationTarget({
        sourceUrl: ACACIA_AURORA_MIGRATION_PROOF.sourceUrl,
        targetUrl: ACACIA_AURORA_MIGRATION_PROOF.targetUrl,
        method: 'GET',
      })
    ).toEqual({
      sourceOrigin: 'https://www.dividendhomes.com',
      targetOrigin: 'https://aurora.siteforge.example',
      sourceReadOnly: true,
    })
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'prohibits %s against the Acacia source',
    method => {
      expect(() =>
        assertAcaciaCannotBeMutationTarget({
          sourceUrl: ACACIA_AURORA_MIGRATION_PROOF.sourceUrl,
          targetUrl: ACACIA_AURORA_MIGRATION_PROOF.targetUrl,
          method,
        })
      ).toThrow(/prohibited/)
    }
  )

  it('rejects redirect loops and chains', () => {
    expect(
      redirectMapSchema.safeParse([
        { from: 'https://old.example/a', to: 'https://old.example/b', status: '301' },
        { from: 'https://old.example/b', to: 'https://new.example/c', status: '301' },
      ]).success
    ).toBe(false)
    expect(
      redirectMapSchema.safeParse([
        { from: 'https://old.example/a', to: 'https://old.example/a', status: '301' },
      ]).success
    ).toBe(false)
  })

  it('rejects zero checked URLs and incomplete redirect decisions', () => {
    const manifest = acaciaManifest()
    manifest.crawlerProvenance.checkedUrlCount = 0
    manifest.redirectDecisions = []
    expect(siteForgeMigrationManifestInputSchema.safeParse(manifest).success).toBe(
      false
    )
  })

  it('rejects zero-URL post-launch verification evidence', () => {
    expect(
      postLaunchVerificationInputSchema.safeParse({
        status: 'passed',
        requiredChecks: ['all_old_urls_resolve_once'],
        verifiedAt: '2026-08-10T13:00:00.000Z',
        checkedUrls: 0,
        failures: [],
        evidence: [],
        evidenceHash: 'a'.repeat(64),
        manifestHash: 'b'.repeat(64),
        provenance: {
          producer: 'p11-data-engine/siteaudit',
          schemaVersion: 'siteforge-post-launch-crawl-v1',
          crawlId: 'crawl-empty',
          signature: 'c'.repeat(64),
        },
      }).success
    ).toBe(false)
  })
})

export { acaciaManifest }
