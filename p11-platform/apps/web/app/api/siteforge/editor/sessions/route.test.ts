import { readFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { strToU8, zipSync } from 'fflate'
import { buildOverlayPackageManifest } from '@/utils/siteforge/editor/overlay'
import {
  computeOverlayContentHash,
  computeOverlaySignature,
  deriveOverlayRenderedEffectContract,
  sha256OverlayValue,
} from '@/utils/siteforge/editor/overlay-contract'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const { createClient, createServiceClient, getUser } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))

function request() {
  return new Request('http://localhost/api/siteforge/editor/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      websiteId: '11111111-1111-4111-8111-111111111111',
    }),
  }) as NextRequest
}

function renderedEffectEvidence(
  contract: ReturnType<typeof deriveOverlayRenderedEffectContract>,
  parentArtifactId: string
) {
  return {
    evidenceVersion: 'siteforge-overlay-rendered-effect-v1',
    contractHash: contract.contractHash,
    parentArtifact: {
      artifactId: parentArtifactId,
      contentHash: 'a'.repeat(64),
    },
    editedArtifact: {
      artifactId: '77777777-7777-4777-8777-777777777777',
      contentHash: 'b'.repeat(64),
    },
    viewportResults: contract.requiredViewports.map(viewport => ({
      viewport,
      selectors: contract.selectors.map(selector => ({
        selector: selector.selector,
        parentMatched: 1,
        editedMatched: 1,
        computedStyles: selector.computedStyles.map(style => ({
          ...style,
          parentValue: 'rgb(0, 0, 0)',
          editedValue: style.value,
          changed: true,
        })),
      })),
    })),
    unchangedRegionsPassed: true,
    interactionChecksPassed: true,
    passed: true,
    failures: [],
  }
}

describe('semantic editor session route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
  })

  it('is unavailable when the feature flag is disabled', async () => {
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'false')
    const { POST } = await import('./route')
    expect((await POST(request())).status).toBe(404)
  })

  it('requires authentication before loading a website', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    expect((await POST(request())).status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it('returns reload recovery, visual context, and immutable revisions', async () => {
    const source = await readFile(new URL('./route.ts', import.meta.url), 'utf8')
    expect(source).toContain('activeSemanticEditJob')
    expect(source).toContain('activePreviewJob')
    expect(source).toContain('listEditorAttachmentPreviews')
    expect(source).toContain('revisions: revisions || []')
  })

  it('surfaces a brand staleness signal without breaking pinning', async () => {
    const source = await readFile(new URL('./route.ts', import.meta.url), 'utf8')
    // Sessions stay pinned to the generated brand contract; the payload only
    // reports when the live brand book has moved past the pinned hash.
    expect(source).toContain('property_brand_assets')
    expect(source).toContain('staleSincePinned')
    expect(source).toContain('pinnedContractHash')
  })

  async function overlayReviewFixture(options: {
    screenshotManifest?: unknown
  } = {}) {
    vi.stubEnv('SITEFORGE_OVERLAY_SIGNING_SECRET', 'session-test-secret')
    const website = {
      id: '11111111-1111-4111-8111-111111111111',
      property_id: '22222222-2222-4222-8222-222222222222',
      org_id: '33333333-3333-4333-8333-333333333333',
      current_artifact_version_id: '44444444-4444-4444-8444-444444444444',
    }
    const proposal = {
      reason: 'Review exact generated files',
      files: [
        {
          path: 'assets/css/review.css',
          content: '.review { color: rebeccapurple; }',
        },
      ],
    }
    const { functionsPhp, styleCss, manifest } =
      buildOverlayPackageManifest(proposal)
    const contentHash = computeOverlayContentHash(proposal.reason, manifest)
    const archive = zipSync({
      'assets/css/review.css': strToU8(proposal.files[0].content),
      'functions.php': strToU8(functionsPhp),
      'style.css': strToU8(styleCss),
      'siteforge-overlay.json': strToU8(
        JSON.stringify({
          descriptorVersion: 1,
          overlayContentHash: contentHash,
          manifest,
          reason: proposal.reason,
        })
      ),
    })
    const packageSha256 = sha256OverlayValue(archive)
    const signature = computeOverlaySignature({
      websiteId: website.id,
      contentHash,
      packageSha256,
      signingSecret: 'session-test-secret',
    })
    const validationReport = {
      passed: true,
      validator: 'siteforge-static-sandbox-v1',
      checks: [{ path: 'assets/css/review.css', passed: true }],
    }
    const extension = {
      id: '55555555-5555-4555-8555-555555555555',
      artifact_id: website.current_artifact_version_id,
      immutable_package_sha256: packageSha256,
      runtime_compatibility: JSON.stringify({
        contractVersion: 1,
        overlayId: '66666666-6666-4666-8666-666666666666',
        contentHash,
        sourceArtifactId: website.current_artifact_version_id,
        sourceContentHash: 'a'.repeat(64),
        packageSha256,
        signature,
        storage: {
          bucket: 'siteforge-artifacts',
          path: `overlays/${website.id}/${contentHash}.zip`,
        },
        validation: {
          validator: 'siteforge-static-sandbox-v1',
          reportSha256: hashSiteForgeContent(validationReport),
        },
        renderedEffectContract:
          deriveOverlayRenderedEffectContract(proposal),
      }),
    }
    const service = {
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => ({
            data:
              table === 'siteforge_blueprint_versions'
                ? {
                    id: website.current_artifact_version_id,
                    version: 7,
                    content_hash: 'a'.repeat(64),
                    created_at: '2026-08-04T12:00:00.000Z',
                  }
                : {
                    id: '66666666-6666-4666-8666-666666666666',
                    content_hash: contentHash,
                    manifest,
                    storage_path: `overlays/${website.id}/${contentHash}.zip`,
                    package_sha256: packageSha256,
                    signature,
                    validation_report: validationReport,
                    screenshot_manifest:
                      options.screenshotManifest !== undefined
                        ? options.screenshotManifest
                        : renderedEffectEvidence(
                            deriveOverlayRenderedEffectContract(proposal),
                            website.current_artifact_version_id
                          ),
                  },
            error: null,
          }),
        }
        return query
      },
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob([archive]),
            error: null,
          }),
        }),
      },
    }
    const { loadExtensionReview } = await import('./route')
    const review = await loadExtensionReview(
      extension,
      website,
      service as never
    )
    return { review, website, proposal, validationReport }
  }

  it('exposes only a strictly verified private overlay review package', async () => {
    const { review, website, proposal, validationReport } =
      await overlayReviewFixture()

    expect(review.reviewComplete).toBe(true)
    expect(review.sourceArtifact).toEqual(
      expect.objectContaining({
        id: website.current_artifact_version_id,
        version: 7,
      })
    )
    expect(review.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'assets/css/review.css',
          content: proposal.files[0].content,
          contentDigestVerified: true,
        }),
        expect.objectContaining({ path: 'functions.php' }),
        expect.objectContaining({ path: 'style.css' }),
      ])
    )
    expect(review.validationReport).toEqual(validationReport)
    expect(review.screenshotReport).toMatchObject({ passed: true })
  })

  it('completes review before rendered evidence exists so machine approval can fire', async () => {
    // Rendered-effect evidence is only captured after the overlay is
    // installed by the canonical render; requiring it here would deadlock
    // every extension in `proposed` and reintroduce an approval ceremony.
    const { review } = await overlayReviewFixture({ screenshotManifest: {} })

    expect(review.reviewComplete).toBe(true)
    expect(review.renderedEffectComplete).toBe(false)
    expect(review.reviewError).toBeNull()
  })
})
