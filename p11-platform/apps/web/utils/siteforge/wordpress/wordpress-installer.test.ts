import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalizeSiteForgeContent } from '@/utils/siteforge/content-hash'
import type { VerifiedRuntimeV3PackageIdentity } from '@/utils/siteforge/artifacts/release'
import { prepareWordPressInstallerArchives } from './wordpress-installer'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('WordPress exact package installation', () => {
  it('prepares the exact verified v3 bytes instead of local runtime assets', async () => {
    const fixture = await installerFixture()

    const prepared = await prepareWordPressInstallerArchives({
      runtimeContractVersion: 3,
      themeArchive: Buffer.from(fixture.themeArchive),
      runtimePluginArchive: Buffer.from(fixture.runtimeArchive),
      runtimePluginIdentity: fixture.identity,
      acfProArchivePath: fixture.acfPath,
    })

    expect(prepared.themeArchive).toEqual(Buffer.from(fixture.themeArchive))
    expect(prepared.runtimePluginArchive).toEqual(
      Buffer.from(fixture.runtimeArchive)
    )
    expect(prepared.runtimePluginArchiveSha256).toBe(
      fixture.identity.archiveSha256
    )
  })

  it('fails closed instead of falling back to local bytes for v3', async () => {
    await expect(
      prepareWordPressInstallerArchives({
        runtimeContractVersion: 3,
      })
    ).rejects.toThrow('requires exact verified package bytes and identity')
  })

  it('rejects v3 installer bytes that drift from the verified release', async () => {
    const fixture = await installerFixture()
    const tampered = Buffer.from(fixture.runtimeArchive)
    tampered[tampered.length - 1] ^= 0xff

    await expect(
      prepareWordPressInstallerArchives({
        runtimeContractVersion: 3,
        themeArchive: Buffer.from(fixture.themeArchive),
        runtimePluginArchive: tampered,
        runtimePluginIdentity: fixture.identity,
        acfProArchivePath: fixture.acfPath,
      })
    ).rejects.toThrow('runtime_plugin package digest mismatch')
  })
})

async function installerFixture() {
  const file = strToU8('<?php echo "runtime-v3";')
  const manifest = {
    schemaVersion: 1 as const,
    packageType: 'runtime_plugin' as const,
    packageName: 'oneclick-siteforge-runtime' as const,
    version: '3.0.0',
    runtimeContractVersion: 3 as const,
    gitSha: '1'.repeat(40),
    files: [
      {
        path: 'oneclick-siteforge-runtime.php',
        bytes: file.byteLength,
        sha256: sha256(file),
      },
    ],
  }
  const runtimeArchive = zipSync(
    {
      'oneclick-siteforge-runtime/oneclick-siteforge-runtime.php': file,
      'oneclick-siteforge-runtime/siteforge-runtime-build-manifest.json': strToU8(
        canonicalizeSiteForgeContent(manifest)
      ),
    },
    { level: 9 }
  )
  const identity: VerifiedRuntimeV3PackageIdentity = {
    packageId: 'runtime:oneclick',
    packageType: 'runtime_plugin',
    packageVersion: '3.0.0',
    archiveSha256: sha256(runtimeArchive),
    archiveBytes: runtimeArchive.byteLength,
    manifestSha256: sha256(
      Buffer.from(canonicalizeSiteForgeContent(manifest))
    ),
    manifest,
    signingKeyId: 'runtime-v3-test',
  }
  const themeArchive = zipSync(
    {
      'oneclick-siteforge/style.css': strToU8(
        '/* SiteForge theme fixture */'.repeat(20)
      ),
    },
    { level: 0 }
  )
  const acfArchive = zipSync(
    {
      'advanced-custom-fields-pro/acf.php': strToU8(
        '<?php // ACF fixture '.repeat(20)
      ),
    },
    { level: 0 }
  )
  const directory = await mkdtemp(path.join(os.tmpdir(), 'siteforge-installer-'))
  temporaryDirectories.push(directory)
  const acfPath = path.join(directory, 'acf.zip')
  await writeFile(acfPath, acfArchive)
  return { runtimeArchive, identity, themeArchive, acfPath }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
