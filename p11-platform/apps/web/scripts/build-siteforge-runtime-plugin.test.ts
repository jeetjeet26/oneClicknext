import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSiteForgeRuntimePlugin,
  isSiteForgeRuntimeV3Enabled,
} from './build-siteforge-runtime-plugin.mjs'
import { verifyBuiltRuntimeV3Package } from './publish-siteforge-runtime-packages'

describe('SiteForge runtime plugin package', () => {
  it('keeps runtime v3 disabled unless explicitly enabled', () => {
    const original = process.env.SITEFORGE_RUNTIME_V3_ENABLED
    delete process.env.SITEFORGE_RUNTIME_V3_ENABLED
    try {
      expect(isSiteForgeRuntimeV3Enabled()).toBe(false)
      expect(isSiteForgeRuntimeV3Enabled('true')).toBe(true)
      expect(() => isSiteForgeRuntimeV3Enabled('enabled')).toThrow(
        /must be exactly true or false/
      )
    } finally {
      if (original === undefined) {
        delete process.env.SITEFORGE_RUNTIME_V3_ENABLED
      } else {
        process.env.SITEFORGE_RUNTIME_V3_ENABLED = original
      }
    }
  })

  it('builds byte-identical v3 archives and manifests for identical inputs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'siteforge-runtime-v3-'))
    const firstDirectory = path.join(root, 'first')
    const secondDirectory = path.join(root, 'second')
    const sourceDirectory = path.resolve(
      process.cwd(),
      '../../../wordpress-plugin/oneclick-siteforge-runtime'
    )
    const options = {
      sourceDirectory,
      v3Enabled: true,
      gitSha: '0123456789abcdef0123456789abcdef01234567',
    }

    try {
      const first = await buildSiteForgeRuntimePlugin({
        ...options,
        outputDirectory: firstDirectory,
      })
      const second = await buildSiteForgeRuntimePlugin({
        ...options,
        outputDirectory: secondDirectory,
      })

      expect(first.archiveHash).toBe(second.archiveHash)
      expect(first.manifestSha256).toBe(second.manifestSha256)
      expect(first.manifest).toEqual(second.manifest)
      expect(await readFile(first.archivePath)).toEqual(
        await readFile(second.archivePath)
      )
      expect(await readFile(`${first.archivePath}.manifest.json`)).toEqual(
        await readFile(`${second.archivePath}.manifest.json`)
      )

      await expect(
        verifyBuiltRuntimeV3Package({
          runtimeAssetsDir: firstDirectory,
        })
      ).resolves.toMatchObject({
        packageSha256: first.archiveHash,
        manifestSha256: first.manifestSha256,
        manifest: {
          runtimeContractVersion: 3,
          gitSha: options.gitSha,
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
