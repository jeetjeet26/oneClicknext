import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VerifiedSiteForgeRelease } from '@/utils/siteforge/artifacts/release'
import type { Json } from '@/types/supabase'
import type {
  ImmutableSiteForgeRuntimeV3Release,
  RuntimeV3AssetPreparationRequest,
} from '@/utils/siteforge/runtime-contract-v3'
import {
  assertRuntimeV3RolloutAssignment,
  buildArtifactBoundRuntimeV3Release,
  deployArtifactBoundRuntimeV3,
} from './runtime-deployment-v3'

const ids = {
  artifact: '11111111-1111-4111-8111-111111111111',
  website: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  property: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  org: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  target: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  deployment: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  transaction: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('artifact-bound runtime v3 deployment', () => {
  it('keeps artifact/package identities identical in every environment', async () => {
    const release = await verifiedRelease()
    const identities = (
      ['canonical_preview', 'staging', 'production'] as const
    ).map(environment =>
      buildArtifactBoundRuntimeV3Release({
        release,
        target: target(environment),
        environment,
        siteUrl: `https://${environment}.example.com`,
        publicRuntime: publicRuntime(),
        protection: {
          mode: environment === 'production' ? 'public' : 'noindex',
        },
      })
    )

    expect(identities.map(item => item.identity)).toEqual([
      identities[0].identity,
      identities[0].identity,
      identities[0].identity,
    ])
    expect(identities.map(item => item.target.environment)).toEqual([
      'canonical_preview',
      'staging',
      'production',
    ])
  })

  it.each([
    ['disabled', false, null],
    ['missing assignment', true, null],
    [
      'rollout mismatch',
      true,
      {
        ...rollout(),
        runtime_package_sha256: '9'.repeat(64),
      },
    ],
  ])('fails closed when v3 is %s', async (_name, enabled, assignment) => {
    vi.stubEnv('SITEFORGE_RUNTIME_V3_ENABLED', String(enabled))
    const release = await verifiedRelease()
    expect(() =>
      assertRuntimeV3RolloutAssignment({
        release,
        target: target('staging'),
        rollout: assignment,
      })
    ).toThrow(
      enabled
        ? /no matching active rollout assignment/
        : /disabled by SITEFORGE_RUNTIME_V3_ENABLED/
    )
  })

  it('terminalizes deployment and target after exact readback mismatch', async () => {
    vi.stubEnv('SITEFORGE_RUNTIME_V3_ENABLED', 'true')
    const release = await verifiedRelease()
    const updates: Array<{ table: string; values: Record<string, unknown> }> = []
    const client = databaseClient(updates)
    const runtimeClient = {
      verifyInstalledPackageIdentity: vi.fn().mockResolvedValue({
        health: {
          status: 'ok',
          runtimeVersion: '3.0.0',
        },
        state: {
          identity: null,
        },
      }),
      getCapabilities: vi.fn().mockResolvedValue({
        limits: {
          maxResourcesPerDeployment: 50_000,
          maxOperationsPerDeployment: 50_000,
          maxAssetsPerPreparation: 5_000,
          maxAssetBytes: 50_000_000,
          acceptedAssetMimeTypes: ['image/png'],
        },
      }),
      getState: vi.fn().mockResolvedValue({
        contractVersion: 3,
        runtimeVersion: '3.0.0',
        siteId: ids.website,
        identity: null,
        transactionId: null,
        target: null,
        resourceHashes: {},
        mediaBindings: {},
        v2Projection: null,
        updatedAt: null,
      }),
      prepareAssets: vi
        .fn()
        .mockImplementation((request: RuntimeV3AssetPreparationRequest) => ({
          contractVersion: 3,
          preparationId: 'preparation:test',
          identity: request.identity,
          idempotencyKey: request.idempotencyKey,
          assets: request.assets.map((item, index) => ({
            assetId: item.asset.assetId,
            byteSha256: item.asset.byteSha256,
            attachmentId: index + 1,
            url: `https://media.example.com/${item.asset.filename}`,
            mimeType: item.asset.mimeType,
            disposition: 'created' as const,
          })),
          preparedAt: '2026-08-04T20:00:00.000Z',
        })),
      submitDeployment: vi.fn().mockResolvedValue({
        status: 'succeeded',
        transactionId: ids.transaction,
        runtimeVersion: '3.0.0',
        verification: {
          verified: true,
          verifiedAt: '2026-08-04T20:00:00.000Z',
        },
      }),
      getDeploymentStatus: vi.fn(),
      getHealth: vi.fn().mockResolvedValue({
        status: 'ok',
        runtimeVersion: '3.0.0',
        installedRuntime: {
          packageType: 'runtime_plugin',
          manifest: { packageVersion: '3.0.0' },
        },
      }),
    }
    const restoreActiveTheme = vi.fn().mockResolvedValue(undefined)

    await expect(
      deployArtifactBoundRuntimeV3({
        release,
        target: target('staging'),
        deploymentId: ids.deployment,
        environment: 'staging',
        siteUrl: 'https://staging.example.com',
        adminUrl: 'https://staging.example.com/wp-admin',
        username: 'operator',
        applicationPassword: 'application-password',
        ssh: { host: '192.0.2.1', username: 'app', password: 'secret' },
        acfProLicenseKey: 'license',
        publicRuntime: publicRuntime(),
        protection: { mode: 'noindex' },
        client: client as never,
        runtimeClient: runtimeClient as never,
        installer: {
          getActiveTheme: vi.fn().mockResolvedValue({
            stylesheet: 'prior-child',
            template: 'prior-parent',
          }),
          ensureInstalled: vi.fn().mockResolvedValue(undefined),
          installThemeOverlay: vi
            .fn()
            .mockResolvedValue('oneclick-siteforge-overlay-141414141414'),
          restoreActiveTheme,
        },
        sleep: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow(/exact readback does not match/)
    expect(restoreActiveTheme).toHaveBeenCalledWith({
      ssh: { host: '192.0.2.1', username: 'app', password: 'secret' },
      theme: { stylesheet: 'prior-child', template: 'prior-parent' },
    })

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'siteforge_artifact_deployments',
          values: expect.objectContaining({
            status: 'failed',
            failure_code: 'runtime_v3_deployment_failed',
          }),
        }),
        expect.objectContaining({
          table: 'siteforge_wordpress_targets',
          values: expect.objectContaining({ status: 'failed' }),
        }),
      ])
    )
  })

  it('contains no legacy deployment, settings, namespace, or activation helper', async () => {
    const source = await readFile(
      path.resolve(
        process.cwd(),
        'utils/siteforge/workflows/runtime-deployment-v3.ts'
      ),
      'utf8'
    )
    expect(source).not.toMatch(/deployToExistingWordPress/)
    expect(source).not.toMatch(/applySiteForgeSettings/)
    expect(source).not.toMatch(/siteforge\/v1/)
    expect(source).not.toMatch(/activateProduction/)
  })
})

function publicRuntime() {
  return {
    enabled: true,
    apiKey: 'api-key',
    apiBaseUrl: 'https://app.example.com',
    websiteId: ids.website,
    conversionEndpoint: `https://app.example.com/api/conversions/${ids.website}`,
    conversionKey: 'conversion-key',
    telemetryEndpoint: `https://app.example.com/api/telemetry/${ids.website}`,
  }
}

function target(
  environment: 'canonical_preview' | 'staging' | 'production'
) {
  return {
    id: ids.target,
    org_id: ids.org,
    property_id: ids.property,
    website_id: ids.website,
    target_type: environment,
    site_url: `https://${environment}.example.com`,
    protection_mode: environment === 'production' ? 'public' : 'noindex',
    runtime_contract_version: 2,
    runtime_package_sha256: null,
    runtime_manifest_sha256: null,
    last_verified_content_hash: null,
    metadata: {},
  }
}

function rollout() {
  return {
    target_id: ids.target,
    org_id: ids.org,
    property_id: ids.property,
    website_id: ids.website,
    requested_contract_version: 3,
    runtime_package_sha256: 'c'.repeat(64),
    status: 'enabled',
    rolled_back_at: null,
  }
}

async function verifiedRelease(): Promise<VerifiedSiteForgeRelease> {
  const fixture = JSON.parse(
    await readFile(
      path.resolve(
        process.cwd(),
        '../../../wordpress-plugin/oneclick-siteforge-runtime/fixtures/v3/release.json'
      ),
      'utf8'
    )
  ) as ImmutableSiteForgeRuntimeV3Release
  return {
    artifact: {
      id: ids.artifact,
      websiteId: ids.website,
      propertyId: ids.property,
      orgId: ids.org,
      blueprint: { runtimeV3Release: fixture } as unknown as Json,
      contentHash: 'a'.repeat(64),
      assetManifestHash: fixture.identity.assetManifestHash,
      baseThemePackageSha256: 'b'.repeat(64),
      overlayPackageSha256: '15'.repeat(32),
      themeOverlayId: 'overlay:aurora',
      runtimeContractVersion: 3,
      runtimePackageSha256: 'c'.repeat(64),
      operationSetHash: fixture.identity.operationSetHash,
    },
    assets: [],
    provenanceUrls: [],
    runtimeAssets: [
      {
        assetId: fixture.resourceGraph.assets[0].assetId,
        sourceUrl: 'https://cdn.example.com/hero.png?signature=test',
        byteHash: fixture.resourceGraph.assets[0].byteSha256,
        bytes: fixture.resourceGraph.assets[0].bytes,
        mimeType: fixture.resourceGraph.assets[0].mimeType,
        filename: fixture.resourceGraph.assets[0].filename,
        role: fixture.resourceGraph.assets[0].role,
        altText: fixture.resourceGraph.assets[0].altText,
        caption: fixture.resourceGraph.assets[0].caption,
      },
    ],
    runtimeSelectedAssets: { logoAssetId: null, faviconAssetId: null },
    baseThemePackage: Buffer.alloc(4096),
    runtimePackage: Buffer.alloc(8192),
    runtimePackageIdentity: {
      packageId: 'runtime:oneclick',
      packageType: 'runtime_plugin',
      packageVersion: '3.0.0',
      archiveSha256: 'c'.repeat(64),
      archiveBytes: 8192,
      manifestSha256: fixture.identity.runtimePackage.manifestSha256,
      manifest: {
        schemaVersion: 1,
        packageType: 'runtime_plugin',
        packageName: 'oneclick-siteforge-runtime',
        version: '3.0.0',
        runtimeContractVersion: 3,
        gitSha: 'a'.repeat(40),
        files: [],
      },
      signingKeyId: 'test-key',
    },
    overlayPackage: Buffer.alloc(2048),
    overlayContentHash: '14'.repeat(32),
  }
}

function databaseClient(
  updates: Array<{ table: string; values: Record<string, unknown> }>
) {
  return {
    from(table: string) {
      const state: { operation?: string; values?: Record<string, unknown> } = {}
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        update: vi.fn((values: Record<string, unknown>) => {
          state.operation = 'update'
          state.values = values
          updates.push({ table, values })
          return builder
        }),
        maybeSingle: vi.fn(async () => {
          if (table === 'siteforge_runtime_target_rollouts') {
            return { data: rollout(), error: null }
          }
          return {
            data: {
              id:
                table === 'siteforge_artifact_deployments'
                  ? ids.deployment
                  : ids.target,
            },
            error: null,
          }
        }),
      }
      return builder
    },
  }
}
