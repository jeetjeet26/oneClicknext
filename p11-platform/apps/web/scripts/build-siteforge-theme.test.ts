import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
// The production build tool is intentionally plain ESM so it can run in CI
// without a TypeScript loader.
import {
  buildSiteForgeTheme,
  checkSiteForgeThemeArtifact,
  validateSiteForgeDeploymentAssets,
  validateSiteForgeTheme,
  variantCatalog,
  verifyRuntimeArtifact,
} from './build-siteforge-theme.mjs'
import { validateSiteForgeBuildInputs } from './validate-siteforge-build-inputs.mjs'
import { SITEFORGE_BLOCK_CAPABILITIES } from '@/types/siteforge'

describe('SiteForge theme package', () => {
  it('skips monorepo-only source validation only inside a Vercel deploy root', async () => {
    const missingRoot = path.join(
      tmpdir(),
      `missing-siteforge-source-${Date.now()}`
    )

    await expect(
      validateSiteForgeBuildInputs({
        deploymentEnvironment: '1',
        sourceThemeDir: missingRoot,
        acfOutputDir: path.join(missingRoot, 'acf-json'),
      })
    ).resolves.toEqual({ skipped: true })

    await expect(
      validateSiteForgeBuildInputs({
        deploymentEnvironment: undefined,
        sourceThemeDir: missingRoot,
        acfOutputDir: path.join(missingRoot, 'acf-json'),
      })
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('pins the TypeScript variant catalog to the theme build catalog', () => {
    // A variant allowed in TypeScript but absent from the theme build catalog
    // would validate blueprints the WordPress theme cannot render. The two
    // catalogs must stay byte-identical.
    const typescriptCatalog = Object.fromEntries(
      Object.entries(SITEFORGE_BLOCK_CAPABILITIES).map(
        ([blockType, capabilities]) => [
          blockType.replace(/^acf\//, ''),
          [...capabilities.variants],
        ]
      )
    )
    expect(typescriptCatalog).toEqual(variantCatalog)
  })

  it('contains every ACF schema, render template, variant contract, and metadata file', async () => {
    const result = await validateSiteForgeTheme()
    const functionsPhp = await readFile(
      path.resolve(
        process.cwd(),
        '../../../wordpress-theme/oneclick-siteforge/functions.php'
      ),
      'utf8'
    )

    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(functionsPhp).toContain(
      `define( 'ONECLICK_SITEFORGE_VERSION', '${result.version}' );`
    )
    expect(functionsPhp).toContain(
      "'html:root{--color-primary:%1$s;"
    )
    expect(result.files.length).toBeGreaterThan(40)
  })

  it('keeps responsive navigation and minimal hero presentation semantic', async () => {
    const themeRoot = path.resolve(
      process.cwd(),
      '../../../wordpress-theme/oneclick-siteforge'
    )
    const [layoutCss, blocksCss, heroTemplate] = await Promise.all([
      readFile(path.join(themeRoot, 'assets/css/layout.css'), 'utf8'),
      readFile(path.join(themeRoot, 'assets/css/blocks.css'), 'utf8'),
      readFile(path.join(themeRoot, 'blocks/top-slides.php'), 'utf8'),
    ])

    expect(layoutCss).toContain('display: inline-flex;')
    expect(layoutCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.menu-label \{\s*display: none;/
    )
    expect(layoutCss).toContain('.primary-menu-container a[aria-current="page"]')
    expect(layoutCss).toContain('background: var(--color-primary);')
    expect(layoutCss).toContain('color: var(--color-text);')
    expect(layoutCss).toContain('.primary-menu-container a:focus-visible')

    expect(blocksCss).toContain(
      '.variant-minimal.block-top-slides { height: clamp(380px, 52vh, 540px); min-height: 0; }'
    )
    expect(blocksCss).toContain('height: clamp(350px, 56svh, 460px);')
    expect(blocksCss).toContain(
      '.variant-minimal.block-top-slides .slide-headline'
    )

    expect(heroTemplate).toContain('aria-label="<?php esc_attr_e( \'Previous slide\'')
    expect(heroTemplate).toContain('aria-label="<?php esc_attr_e( \'Next slide\'')
    expect(heroTemplate).toContain('class="swiper-autoplay-toggle" aria-pressed="false"')
  })

  it('emits stable nested editor targets and no positional fallback', async () => {
    const themeRoot = path.resolve(
      process.cwd(),
      '../../../wordpress-theme/oneclick-siteforge'
    )
    const [behavior, utilities, header, footer, page, accordion, governed] =
      await Promise.all([
        readFile(path.join(themeRoot, 'assets/js/site-behavior.js'), 'utf8'),
        readFile(path.join(themeRoot, 'inc/block-utilities.php'), 'utf8'),
        readFile(path.join(themeRoot, 'header.php'), 'utf8'),
        readFile(path.join(themeRoot, 'footer.php'), 'utf8'),
        readFile(path.join(themeRoot, 'page.php'), 'utf8'),
        readFile(path.join(themeRoot, 'blocks/accordion-section.php'), 'utf8'),
        readFile(path.join(themeRoot, 'blocks/governed-component.php'), 'utf8'),
      ])

    expect(behavior).toContain("type: 'siteforge-editor:target-selected'")
    expect(behavior).toContain('resourcePath: resourcePath')
    expect(behavior).toContain('boundingBox: boundingBox(target)')
    expect(behavior).toContain("['before', 'after']")
    expect(behavior).not.toContain('sectionIndex:')
    expect(utilities).toContain('data-siteforge-target-id')
    expect(utilities).toContain('oneclick_siteforge_repeater_item_id')
    expect(utilities).toContain('data-siteforge-presentation')
    expect(behavior).toContain('presentation-effective-')
    expect(header).toContain('data-siteforge-target-kind="header"')
    expect(header).toContain('data-siteforge-target-kind="menu"')
    expect(footer).toContain('data-siteforge-target-kind="footer"')
    expect(page).toContain('data-siteforge-target-kind="page"')
    expect(accordion).not.toContain('uniqid(')
    expect(accordion).not.toContain("'-item-' . $index")
    expect(governed).toContain('oneclick_render_governed_component_node')
    expect(governed).not.toMatch(/\beval\s*\(|\binclude\s*\(/)
  })

  it('builds byte-identical archives for identical explicit inputs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'siteforge-theme-'))
    const firstDirectory = path.join(root, 'first')
    const secondDirectory = path.join(root, 'second')

    try {
      const options = {
        signingKey: 'deterministic-test-key',
        gitSha: '0123456789abcdef',
      }
      const first = await buildSiteForgeTheme({
        ...options,
        outputDirectory: firstDirectory,
      })
      const second = await buildSiteForgeTheme({
        ...options,
        outputDirectory: secondDirectory,
      })

      expect(first.archiveHash).toBe(second.archiveHash)
      expect(await readFile(first.archivePath)).toEqual(
        await readFile(second.archivePath)
      )
      await expect(
        verifyRuntimeArtifact('oneclick-siteforge.zip', {
          runtimeAssetsDir: firstDirectory,
        })
      ).resolves.toMatchObject({ archiveHash: first.archiveHash })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an archive whose bytes do not match its checked digest', async () => {
    const runtimeAssetsDir = await mkdtemp(
      path.join(tmpdir(), 'siteforge-runtime-')
    )
    const filename = 'oneclick-siteforge.zip'
    try {
      await writeFile(path.join(runtimeAssetsDir, filename), Buffer.from('PKbad'))
      await writeFile(
        path.join(runtimeAssetsDir, `${filename}.sha256`),
        `${'0'.repeat(64)}  ${filename}\n`
      )

      await expect(
        verifyRuntimeArtifact(filename, { runtimeAssetsDir })
      ).rejects.toThrow(/not a valid ZIP archive|digest mismatch/)
    } finally {
      await rm(runtimeAssetsDir, { recursive: true, force: true })
    }
  })

  it('checks a built theme against a deterministic rebuild', async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), 'siteforge-theme-check-')
    )
    try {
      const options = {
        signingKey: 'deterministic-check-key',
        gitSha: '0123456789abcdef',
        outputDirectory,
      }
      const built = await buildSiteForgeTheme(options)
      await expect(checkSiteForgeThemeArtifact(options)).resolves.toMatchObject({
        archiveHash: built.archiveHash,
      })

      await writeFile(built.archivePath, Buffer.from('PKdrift'))
      await expect(checkSiteForgeThemeArtifact(options)).rejects.toThrow(
        /valid ZIP archive|digest mismatch/
      )
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })

  it('verifies an explicit deployment bundle when source is unavailable', async () => {
    const runtimeAssetsDir = await mkdtemp(
      path.join(tmpdir(), 'siteforge-deployment-assets-')
    )
    try {
      for (const filename of [
        'oneclick-siteforge.zip',
        'advanced-custom-fields-pro.zip',
        'oneclick-siteforge-runtime.zip',
      ]) {
        const archive = Buffer.alloc(128)
        archive[0] = 0x50
        archive[1] = 0x4b
        const digest = createHash('sha256').update(archive).digest('hex')
        await writeFile(path.join(runtimeAssetsDir, filename), archive)
        await writeFile(
          path.join(runtimeAssetsDir, `${filename}.sha256`),
          `${digest}  ${filename}\n`
        )
      }

      await expect(
        validateSiteForgeDeploymentAssets({
          sourceThemeDir: path.join(tmpdir(), 'missing-siteforge-theme'),
          runtimeAssetsDir,
        })
      ).resolves.toMatchObject({
        sourceValidation: null,
        artifacts: [
          { archiveHash: expect.any(String) },
          { archiveHash: expect.any(String) },
          { archiveHash: expect.any(String) },
        ],
      })
    } finally {
      await rm(runtimeAssetsDir, { recursive: true, force: true })
    }
  })
})
