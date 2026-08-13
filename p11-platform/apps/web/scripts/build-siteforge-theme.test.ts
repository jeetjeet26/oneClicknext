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
  verifyRuntimeArtifact,
} from './build-siteforge-theme.mjs'
import { validateSiteForgeBuildInputs } from './validate-siteforge-build-inputs.mjs'

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

  it('keeps the responsive menu icon and label aligned', async () => {
    const layoutCss = await readFile(
      path.resolve(
        process.cwd(),
        '../../../wordpress-theme/oneclick-siteforge/assets/css/layout.css'
      ),
      'utf8'
    )

    expect(layoutCss).toContain('display: inline-flex;')
    expect(layoutCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.menu-label \{\s*display: none;/
    )
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
