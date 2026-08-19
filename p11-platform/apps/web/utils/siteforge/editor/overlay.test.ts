import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import {
  buildOverlayFunctionsPhp,
  buildOverlayPackageManifest,
  validateAndStoreThemeOverlay,
  validateStoredOverlayPackage,
  validateOverlayProposalStatic,
} from '@/utils/siteforge/editor/overlay'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  computeOverlayContentHash,
  computeOverlaySignature,
  assertPassingOverlayRenderedEffectEvidence,
  deriveOverlayRenderedEffectContract,
  verifyOverlaySignature,
} from '@/utils/siteforge/editor/overlay-contract'

describe('validateOverlayProposalStatic', () => {
  it('accepts allowlisted CSS, JavaScript, and template partials', () => {
    const proposal = validateOverlayProposalStatic({
      reason: 'Add a supported visual treatment',
      files: [
        {
          path: 'assets/css/custom-hero.css',
          content: '.hero { opacity: 0.95; }',
        },
        {
          path: 'assets/js/custom-hero.js',
          content: 'document.querySelector(".hero")?.classList.add("ready")',
        },
        {
          path: 'partials/custom-hero.php',
          content: '<?php echo esc_html( $args["title"] ?? "" ); ?>',
        },
      ],
    })
    expect(proposal.files).toHaveLength(3)
  })

  it.each([
    '../functions.php',
    '/tmp/payload.js',
    'functions.php',
    'assets/images/payload.svg',
    'partials/../../wp-config.php',
  ])('rejects non-allowlisted path %s', path => {
    expect(() =>
      validateOverlayProposalStatic({
        reason: 'unsafe',
        files: [{ path, content: 'safe' }],
      })
    ).toThrow()
  })

  it('rejects dangerous JavaScript execution and network primitives', () => {
    expect(() =>
      validateOverlayProposalStatic({
        reason: 'unsafe',
        files: [
          {
            path: 'assets/js/payload.js',
            content: 'fetch("https://example.com/steal")',
          },
        ],
      })
    ).toThrow(/forbidden behavior/)
  })

  it('rejects dangerous PHP process primitives', () => {
    expect(() =>
      validateOverlayProposalStatic({
        reason: 'unsafe',
        files: [
          {
            path: 'partials/payload.php',
            content: '<?php shell_exec($_GET["command"]); ?>',
          },
        ],
      })
    ).toThrow(/forbidden behavior/)
  })

  it('rejects malformed or remotely importing CSS', () => {
    expect(() =>
      validateOverlayProposalStatic({
        reason: 'unsafe',
        files: [
          {
            path: 'assets/css/payload.css',
            content: '@import url("https://example.com/payload.css"); .x { color: red;',
          },
        ],
      })
    ).toThrow()
  })

  it('rejects guessed ACF editor selectors that cannot match the front end', () => {
    expect(() =>
      validateOverlayProposalStatic({
        reason: 'invalid selector',
        files: [
          {
            path: 'assets/css/hero.css',
            content:
              '.wp-block-acf-top-slides .slide-headline { line-height: 1.2; }',
          },
        ],
      })
    ).toThrow(/rendered SiteForge DOM/)
  })

  it('derives selector/style contracts and rejects unmatched rendered evidence', () => {
    const contract = deriveOverlayRenderedEffectContract({
      reason: 'Change the rendered hero treatment',
      files: [
        {
          path: 'assets/css/hero.css',
          content: '.block-top-slides .slide-headline { opacity: 0.9; }',
        },
      ],
    })
    expect(contract.selectors).toEqual([
      expect.objectContaining({
        selector: '.block-top-slides .slide-headline',
        computedStyles: [{ property: 'opacity', value: '0.9' }],
      }),
    ])
    expect(() =>
      assertPassingOverlayRenderedEffectEvidence({
        contract,
        parentArtifactId: '11111111-1111-4111-8111-111111111111',
        parentContentHash: 'a'.repeat(64),
        evidence: {
          evidenceVersion: 'siteforge-overlay-rendered-effect-v1',
          contractHash: contract.contractHash,
          parentArtifact: {
            artifactId: '11111111-1111-4111-8111-111111111111',
            contentHash: 'a'.repeat(64),
          },
          editedArtifact: {
            artifactId: '22222222-2222-4222-8222-222222222222',
            contentHash: 'b'.repeat(64),
          },
          viewportResults: contract.requiredViewports.map(viewport => ({
            viewport,
            selectors: contract.selectors.map(selector => ({
              selector: selector.selector,
              parentMatched: 0,
              editedMatched: 0,
              computedStyles: [],
            })),
          })),
          unchangedRegionsPassed: true,
          interactionChecksPassed: true,
          passed: false,
          failures: [
            {
              code: 'selector_unmatched',
              selector: '.block-top-slides .slide-headline',
              viewport: 'desktop',
              expected: 'at least one element',
              actual: '0',
              repairHint: 'Use a selector present in the rendered parent DOM.',
            },
          ],
        },
      })
    ).toThrow(/selector_unmatched/)
  })

  it('preserves parent theme token precedence in child overlays', () => {
    const functionsPhp = buildOverlayFunctionsPhp(
      ['assets/css/logo-blend.css'],
      []
    )

    expect(functionsPhp).toContain("array( 'oneclick-siteforge-style' )")
    expect(functionsPhp).not.toContain('oneclick-siteforge-parent')
    expect(functionsPhp).not.toContain(
      "get_template_directory_uri() . '/style.css'"
    )
  })

  it('includes generated runtime files in its verifiable manifest hash', () => {
    const { functionsPhp, manifest } = buildOverlayPackageManifest({
      reason: 'Blend the approved logo into the header background',
      files: [
        {
          path: 'assets/css/logo-blend.css',
          content: '.site-header .custom-logo { mix-blend-mode: multiply; }',
        },
      ],
    })

    expect(manifest.files.map(file => file.path)).toEqual([
      'assets/css/logo-blend.css',
      'functions.php',
      'style.css',
    ])
    expect(manifest.contentHash).toBe(hashSiteForgeContent(manifest.files))
    expect(functionsPhp).toContain("array( 'oneclick-siteforge-style' )")
    expect(functionsPhp).not.toContain('oneclick-siteforge-parent')
  })

  it('reuses only stored packages whose manifest and files are exact', () => {
    const css = '.site-header .custom-logo { mix-blend-mode: multiply; }'
    const proposal = {
      reason: 'Blend the approved logo into the header background',
      files: [{ path: 'assets/css/logo-blend.css', content: css }],
    }
    const { functionsPhp, styleCss, manifest } =
      buildOverlayPackageManifest(proposal)
    const contentHash = computeOverlayContentHash(proposal.reason, manifest)
    const archive = zipSync({
      'assets/css/logo-blend.css': strToU8(css),
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

    expect(
      validateStoredOverlayPackage(archive, { contentHash, manifest })
    ).toMatch(
      /^[a-f0-9]{64}$/
    )
    const tamperedArchive = zipSync({
      'assets/css/logo-blend.css': strToU8(`${css}\n.tampered { color: red; }`),
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
    expect(() =>
      validateStoredOverlayPackage(tamperedArchive, {
        contentHash,
        manifest,
      })
    ).toThrow(/file does not match/)

    const extraEntryArchive = zipSync({
      'assets/css/logo-blend.css': strToU8(css),
      'functions.php': strToU8(functionsPhp),
      'style.css': strToU8(styleCss),
      'unexpected.php': strToU8('<?php echo "unexpected";'),
      'siteforge-overlay.json': strToU8(
        JSON.stringify({
          descriptorVersion: 1,
          overlayContentHash: contentHash,
          manifest,
          reason: proposal.reason,
        })
      ),
    })
    expect(() =>
      validateStoredOverlayPackage(extraEntryArchive, {
        contentHash,
        manifest,
      })
    ).toThrow(/unsafe entry|unexpected entries/)
  })

  it('binds the review reason and signature into immutable package identity', () => {
    const proposal = {
      reason: 'Required behavior',
      files: [{ path: 'assets/css/custom.css', content: '.x { color: red; }' }],
    }
    const { manifest } = buildOverlayPackageManifest(proposal)
    expect(computeOverlayContentHash(proposal.reason, manifest)).not.toBe(
      computeOverlayContentHash('Different reason', manifest)
    )
    const signature = computeOverlaySignature({
      websiteId: '11111111-1111-4111-8111-111111111111',
      contentHash: computeOverlayContentHash(proposal.reason, manifest),
      packageSha256: 'a'.repeat(64),
      signingSecret: 'secret',
    })
    expect(
      verifyOverlaySignature({
        websiteId: '11111111-1111-4111-8111-111111111111',
        contentHash: computeOverlayContentHash(proposal.reason, manifest),
        packageSha256: 'a'.repeat(64),
        signature,
        signingSecret: 'secret',
      })
    ).toBe(true)
    expect(
      verifyOverlaySignature({
        websiteId: '11111111-1111-4111-8111-111111111111',
        contentHash: computeOverlayContentHash(proposal.reason, manifest),
        packageSha256: 'b'.repeat(64),
        signature,
        signingSecret: 'secret',
      })
    ).toBe(false)
  })

  it('fails closed instead of mutating an immutable overlay conflict', async () => {
    let uploaded: Uint8Array<ArrayBufferLike> = new Uint8Array()
    const insertQuery = {
      select: () => insertQuery,
      maybeSingle: async () => ({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      }),
    }
    const existingQuery = {
      select: () => existingQuery,
      eq: () => existingQuery,
      single: async () => ({
        data: {
          id: '66666666-6666-4666-8666-666666666666',
          org_id: '33333333-3333-4333-8333-333333333333',
          property_id: '22222222-2222-4222-8222-222222222222',
          website_id: '11111111-1111-4111-8111-111111111111',
          content_hash: 'a'.repeat(64),
          manifest: {},
          storage_path: 'conflicting/path.zip',
          package_sha256: 'b'.repeat(64),
          signature: 'c'.repeat(64),
          validation_report: {},
          created_by: '77777777-7777-4777-8777-777777777777',
        },
        error: null,
      }),
    }
    const client = {
      storage: {
        from: () => ({
          upload: async (_path: string, bytes: Uint8Array) => {
            uploaded = bytes
            return { error: { message: 'Already exists' } }
          },
          download: async () => ({
            data: new Blob([Buffer.from(uploaded)]),
            error: null,
          }),
        }),
      },
      from: () => ({
        insert: () => insertQuery,
        ...existingQuery,
      }),
    } as unknown as SupabaseClient<Database>
    const sandbox = {
      cwd: '/tmp',
      fs: {
        mkdir: async () => undefined,
        writeFile: async () => undefined,
      },
      runCommand: async () => ({
        exitCode: 0,
        stdout: async () => '',
        stderr: async () => '',
      }),
      stop: async () => undefined,
    }

    await expect(
      validateAndStoreThemeOverlay(
        {
          orgId: '33333333-3333-4333-8333-333333333333',
          propertyId: '22222222-2222-4222-8222-222222222222',
          websiteId: '11111111-1111-4111-8111-111111111111',
          userId: '77777777-7777-4777-8777-777777777777',
          proposal: {
            reason: 'Reviewed behavior',
            files: [
              {
                path: 'assets/js/reviewed.js',
                content: 'document.body.classList.add("reviewed")',
              },
            ],
          },
        },
        {
          client,
          sandboxFactory: async () => sandbox,
          signingSecret: 'secret',
        }
      )
    ).rejects.toThrow(/Immutable theme overlay identity conflict/)
  })
})
