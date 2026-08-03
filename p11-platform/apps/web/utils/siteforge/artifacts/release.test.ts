import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
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
  })
})
