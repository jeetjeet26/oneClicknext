import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import {
  canonicalizeSiteForgeContent,
  hashSiteForgeContent,
} from '@/utils/siteforge/content-hash'
import { loadVerifiedSiteForgeRelease } from './release'

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const ARTIFACT_ID = '44444444-4444-4444-8444-444444444444'
const LOGO_A_ID = '55555555-5555-4555-8555-555555555555'
const LOGO_B_ID = '66666666-6666-4666-8666-666666666666'

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('loadVerifiedSiteForgeRelease', () => {
  it('loads the exact replacement logo bytes and runtime packages', async () => {
    const logoBytes = new TextEncoder().encode('approved-logo-b')
    const themeBytes = new TextEncoder().encode('immutable-theme')
    const runtimeBytes = new TextEncoder().encode('immutable-runtime')
    const blueprint = {
      version: 1,
      pages: [],
      siteConfiguration: {
        media: {
          logoAssetId: LOGO_B_ID,
          logoUrl: 'https://assets.example.com/logo-b.png',
        },
      },
    }
    const manifest = [
      {
        id: LOGO_B_ID,
        type: 'logo',
        source: 'upload',
        fileUrl: 'https://assets.example.com/logo-b.png',
        originalUrl: null,
        storagePath: 'websites/logo-b.png',
        byteSha256: sha256(logoBytes),
        bytes: logoBytes.byteLength,
        mimeType: 'image/png',
        altText: 'Replacement logo',
        caption: null,
        width: 512,
        height: 256,
        focalPoint: { x: 0.5, y: 0.5 },
        approvalStatus: 'approved',
        rightsStatus: 'owned',
        createdAt: '2026-08-03T18:00:00.000Z',
      },
    ]
    const contentHash = hashSiteForgeContent(blueprint)
    const themeHash = sha256(themeBytes)
    const runtimeHash = sha256(runtimeBytes)
    const artifact = {
      id: ARTIFACT_ID,
      website_id: WEBSITE_ID,
      property_id: PROPERTY_ID,
      org_id: ORG_ID,
      blueprint,
      content_hash: contentHash,
      asset_manifest: manifest,
      asset_manifest_hash: hashSiteForgeContent(manifest),
      base_theme_package_sha256: themeHash,
      theme_overlay_id: null,
      overlay_package_sha256: null,
      runtime_contract_version: 2,
      runtime_package_sha256: runtimeHash,
      operation_set_hash: 'a'.repeat(64),
    }
    const packages = {
      [themeHash]: {
        storage_path: `runtime-packages/base_theme/${themeHash}/theme.zip`,
        package_sha256: themeHash,
        bytes: themeBytes,
      },
      [runtimeHash]: {
        storage_path: `runtime-packages/runtime_plugin/${runtimeHash}/runtime.zip`,
        package_sha256: runtimeHash,
        bytes: runtimeBytes,
      },
    }
    const packageQueries: Array<Record<string, unknown>> = []
    const client = {
      from(table: string) {
        const filters: Record<string, unknown> = {}
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            filters[key] = value
            return query
          },
          single: async () => {
            if (table === 'siteforge_blueprint_versions') {
              return { data: artifact, error: null }
            }
            return { data: null, error: new Error('Unexpected single query') }
          },
          maybeSingle: async () => {
            packageQueries.push({ ...filters })
            const packageRecord =
              packages[filters.package_sha256 as keyof typeof packages]
            return {
              data: packageRecord
                ? {
                    storage_path: packageRecord.storage_path,
                    package_sha256: packageRecord.package_sha256,
                  }
                : null,
              error: null,
            }
          },
        }
        return query
      },
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: 'https://signed.example.com/logo-b.png' },
            error: null,
          }),
          download: async (storagePath: string) => {
            const packageRecord = Object.values(packages).find(
              item => item.storage_path === storagePath
            )
            return {
              data: packageRecord ? new Blob([packageRecord.bytes]) : null,
              error: packageRecord ? null : new Error('Package not found'),
            }
          },
        }),
      },
    } as unknown as SupabaseClient<Database>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(logoBytes, { status: 200 }))
    )

    const release = await loadVerifiedSiteForgeRelease(
      {
        artifactId: ARTIFACT_ID,
        websiteId: WEBSITE_ID,
        propertyId: PROPERTY_ID,
        orgId: ORG_ID,
        contentHash,
      },
      client
    )

    expect(release.runtimeSelectedAssets.logoAssetId).toBe(LOGO_B_ID)
    expect(release.runtimeSelectedAssets.logoAssetId).not.toBe(LOGO_A_ID)
    expect(release.runtimeAssets).toEqual([
      expect.objectContaining({
        assetId: LOGO_B_ID,
        byteHash: sha256(logoBytes),
      }),
    ])
    expect(release.baseThemePackage).toEqual(Buffer.from(themeBytes))
    expect(release.runtimePackage).toEqual(Buffer.from(runtimeBytes))
    expect(release.runtimePackageIdentity).toBeNull()
    expect(packageQueries).toContainEqual(
      expect.objectContaining({
        package_type: 'runtime_plugin',
        package_sha256: runtimeHash,
        runtime_contract_version: 2,
      })
    )
  })

  it('fails closed for v3 when the global flag is absent or false', async () => {
    const fixture = createV3ReleaseFixture()
    const { client, packageQueries } = createReleaseClient(fixture)

    await expect(
      loadVerifiedSiteForgeRelease(fixture.input, client)
    ).rejects.toThrow('runtime v3 release loading is disabled')
    expect(packageQueries).toHaveLength(0)

    vi.stubEnv('SITEFORGE_RUNTIME_V3_ENABLED', 'false')
    await expect(
      loadVerifiedSiteForgeRelease(fixture.input, client)
    ).rejects.toThrow('runtime v3 release loading is disabled')
  })

  it('selects and verifies the exact published contract-3 package', async () => {
    const fixture = createV3ReleaseFixture()
    trustV3Fixture(fixture)
    const { client, packageQueries } = createReleaseClient(fixture)

    const release = await loadVerifiedSiteForgeRelease(fixture.input, client)

    expect(release.runtimePackage).toEqual(Buffer.from(fixture.runtimeArchive))
    expect(release.runtimePackageIdentity).toMatchObject({
      packageId: fixture.runtimeRecord.id,
      packageType: 'runtime_plugin',
      archiveSha256: fixture.runtimeRecord.package_sha256,
      manifestSha256: fixture.runtimeRecord.manifest_sha256,
      manifest: fixture.runtimeManifest,
    })
    expect(packageQueries).toContainEqual(
      expect.objectContaining({
        package_type: 'runtime_plugin',
        package_sha256: fixture.runtimeRecord.package_sha256,
        runtime_contract_version: 3,
        publication_status: 'published',
        revoked_at: null,
      })
    )
  })

  it('rejects an invalid v3 Ed25519 signature before downloading bytes', async () => {
    const fixture = createV3ReleaseFixture()
    trustV3Fixture(fixture)
    fixture.runtimeRecord.signature = Buffer.alloc(64, 7).toString('base64')
    const { client, downloads } = createReleaseClient(fixture)

    await expect(
      loadVerifiedSiteForgeRelease(fixture.input, client)
    ).rejects.toThrow('runtime v3 package signature is invalid')
    expect(downloads).not.toContain(fixture.runtimeRecord.storage_path)
  })

  it('rejects archive bytes that do not match the signed registry hash', async () => {
    const fixture = createV3ReleaseFixture()
    trustV3Fixture(fixture)
    fixture.runtimeArchive = new Uint8Array([
      ...fixture.runtimeArchive.slice(0, -1),
      fixture.runtimeArchive.at(-1)! ^ 0xff,
    ])
    const { client } = createReleaseClient(fixture)

    await expect(
      loadVerifiedSiteForgeRelease(fixture.input, client)
    ).rejects.toThrow('runtime_plugin package digest mismatch')
  })

  it('rejects a revoked v3 registry row even if a lookup returns it', async () => {
    const fixture = createV3ReleaseFixture()
    trustV3Fixture(fixture)
    fixture.runtimeRecord.publication_status = 'revoked'
    fixture.runtimeRecord.revoked_at = '2026-08-04T20:00:00.000Z'
    fixture.runtimeRecord.revocation_reason = 'compromised'
    const { client } = createReleaseClient(fixture)

    await expect(
      loadVerifiedSiteForgeRelease(fixture.input, client)
    ).rejects.toThrow('unpublished, revoked, or has the wrong identity')
  })

  it('keeps v1 registry loading independent of the v3 flag and trust metadata', async () => {
    const fixture = createV3ReleaseFixture()
    fixture.artifact.runtime_contract_version = 1
    fixture.artifact.runtime_package_sha256 = null
    const { client, packageQueries } = createReleaseClient(fixture)

    const release = await loadVerifiedSiteForgeRelease(fixture.input, client)

    expect(release.artifact.runtimeContractVersion).toBe(1)
    expect(release.baseThemePackage).toEqual(Buffer.from(fixture.themeBytes))
    expect(release.runtimePackage).toBeNull()
    expect(release.runtimePackageIdentity).toBeNull()
    expect(packageQueries).not.toContainEqual(
      expect.objectContaining({ package_type: 'runtime_plugin' })
    )
  })
})

function createV3ReleaseFixture() {
  const runtimeFile = strToU8('<?php echo "runtime-v3";')
  const runtimeManifest = {
    schemaVersion: 1 as const,
    packageType: 'runtime_plugin' as const,
    packageName: 'oneclick-siteforge-runtime',
    version: '3.0.0',
    runtimeContractVersion: 3 as const,
    gitSha: '1'.repeat(40),
    files: [
      {
        path: 'oneclick-siteforge-runtime.php',
        bytes: runtimeFile.byteLength,
        sha256: sha256(runtimeFile),
      },
    ],
  }
  const runtimeArchive = zipSync(
    {
      'oneclick-siteforge-runtime/oneclick-siteforge-runtime.php': runtimeFile,
      'oneclick-siteforge-runtime/siteforge-runtime-build-manifest.json': strToU8(
        canonicalizeSiteForgeContent(runtimeManifest)
      ),
    },
    { level: 9 }
  )
  const runtimeHash = sha256(runtimeArchive)
  const runtimeManifestHash = hashSiteForgeContent(runtimeManifest)
  const themeBytes = strToU8('immutable-theme-v3')
  const themeHash = sha256(themeBytes)
  const blueprint = { version: 1, pages: [], siteConfiguration: { media: {} } }
  const contentHash = hashSiteForgeContent(blueprint)
  const artifact = {
    id: ARTIFACT_ID,
    website_id: WEBSITE_ID,
    property_id: PROPERTY_ID,
    org_id: ORG_ID,
    blueprint,
    content_hash: contentHash,
    asset_manifest: [],
    asset_manifest_hash: hashSiteForgeContent([]),
    base_theme_package_sha256: themeHash,
    theme_overlay_id: null,
    overlay_package_sha256: null,
    runtime_contract_version: 3 as number,
    runtime_package_sha256: runtimeHash as string | null,
    operation_set_hash: 'a'.repeat(64),
  }
  const signing = generateKeyPairSync('ed25519')
  const storagePath =
    `runtime-packages/runtime_plugin/${runtimeHash}/` +
    'oneclick-siteforge-runtime.zip'
  const envelope = {
    schemaVersion: 1 as const,
    signatureAlgorithm: 'ed25519-sha256' as const,
    packageType: 'runtime_plugin' as const,
    version: '3.0.0',
    runtimeContractVersion: 3 as const,
    filename: 'oneclick-siteforge-runtime.zip',
    storagePath,
    packageSha256: runtimeHash,
    manifestSha256: runtimeManifestHash,
    gitSha: runtimeManifest.gitSha,
  }
  const runtimeRecord = {
    id: '77777777-7777-4777-8777-777777777777',
    storage_path: storagePath,
    package_sha256: runtimeHash,
    package_type: 'runtime_plugin',
    version: '3.0.0',
    manifest: runtimeManifest,
    manifest_sha256: runtimeManifestHash,
    runtime_contract_version: 3,
    signature: sign(
        null,
        Buffer.from(
          sha256(Buffer.from(canonicalizeSiteForgeContent(envelope))),
          'hex'
        ),
        signing.privateKey
      ).toString('base64'),
    signature_algorithm: 'ed25519-sha256',
    signing_key_id: 'runtime-v3-test',
    publication_status: 'published',
    revoked_at: null as string | null,
    revocation_reason: null as string | null,
  }
  const themeRecord = {
    id: '88888888-8888-4888-8888-888888888888',
    storage_path: `runtime-packages/base_theme/${themeHash}/theme.zip`,
    package_sha256: themeHash,
    package_type: 'base_theme',
    version: '2.2.7',
    manifest: {},
    manifest_sha256: null,
    runtime_contract_version: null,
    signature: null,
    signature_algorithm: null,
    signing_key_id: null,
    publication_status: 'published',
    revoked_at: null,
    revocation_reason: null,
  }
  return {
    input: {
      artifactId: ARTIFACT_ID,
      websiteId: WEBSITE_ID,
      propertyId: PROPERTY_ID,
      orgId: ORG_ID,
      contentHash,
    },
    artifact,
    runtimeManifest,
    runtimeArchive,
    runtimeRecord,
    themeBytes,
    themeRecord,
    publicKey: signing.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
  }
}

function trustV3Fixture(fixture: ReturnType<typeof createV3ReleaseFixture>) {
  vi.stubEnv('SITEFORGE_RUNTIME_V3_ENABLED', 'true')
  vi.stubEnv(
    'SITEFORGE_RUNTIME_V3_PUBLIC_KEYS',
    JSON.stringify({ 'runtime-v3-test': fixture.publicKey })
  )
}

function createReleaseClient(fixture: ReturnType<typeof createV3ReleaseFixture>) {
  const packageQueries: Array<Record<string, unknown>> = []
  const downloads: string[] = []
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value
          return query
        },
        is: (key: string, value: unknown) => {
          filters[key] = value
          return query
        },
        single: async () => {
          if (table === 'siteforge_blueprint_versions') {
            return { data: fixture.artifact, error: null }
          }
          return { data: null, error: new Error('Unexpected single query') }
        },
        maybeSingle: async () => {
          packageQueries.push({ ...filters })
          if (filters.package_sha256 === fixture.runtimeRecord.package_sha256) {
            return { data: fixture.runtimeRecord, error: null }
          }
          if (filters.package_sha256 === fixture.themeRecord.package_sha256) {
            return { data: fixture.themeRecord, error: null }
          }
          return { data: null, error: null }
        },
      }
      return query
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
          error: new Error('No assets expected'),
        }),
        download: async (storagePath: string) => {
          downloads.push(storagePath)
          if (storagePath === fixture.runtimeRecord.storage_path) {
            return { data: new Blob([fixture.runtimeArchive]), error: null }
          }
          if (storagePath === fixture.themeRecord.storage_path) {
            return { data: new Blob([fixture.themeBytes]), error: null }
          }
          return { data: null, error: new Error('Package not found') }
        },
      }),
    },
  } as unknown as SupabaseClient<Database>
  return { client, packageQueries, downloads }
}
