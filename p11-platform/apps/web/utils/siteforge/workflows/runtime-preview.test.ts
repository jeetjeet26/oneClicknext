import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_CONFIGURATION } from '@/utils/siteforge/blueprint'
import {
  hashRuntimeValue,
  type AssetPreparationRequest,
  type DeploymentStatus,
  type DeploymentSubmission,
  type RuntimeState,
} from '@/utils/siteforge/runtime-contract'
import type { VerifiedSiteForgeRelease } from '@/utils/siteforge/artifacts/release'
import { SiteForgeRuntimeClientError } from '@/utils/siteforge/wordpress/runtime-client'
import { deployVerifiedReleaseThroughRuntime } from './runtime-preview'

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111'
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222'
const LOGO_ID = '33333333-3333-4333-8333-333333333333'

describe('SiteForge runtime preview deployment', () => {
  it('prepares assets, applies one transaction, and verifies exact readback', async () => {
    const release = makeRelease()
    let submitted: DeploymentSubmission | null = null
    let stateReads = 0
    const runtimeClient = {
      getHealth: vi.fn(async () => ({
        contractVersion: 2 as const,
        runtimeVersion: '2.0.0',
        status: 'ok' as const,
        checkedAt: '2026-08-03T18:00:00.000Z',
        dependencies: [{ name: 'wordpress', status: 'ok' as const }],
      })),
      getCapabilities: vi.fn(async () => capabilities()),
      getState: vi.fn(async () => {
        stateReads += 1
        return stateReads === 1 || !submitted
          ? emptyState()
          : {
              ...emptyState(),
              artifactId: submitted.artifactId,
              artifactContentHash: submitted.artifactContentHash,
              assetManifestHash: submitted.assetManifestHash,
              operationHash: submitted.operationHash,
              transactionId: '44444444-4444-4444-8444-444444444444',
              pageIds: { 'page:home': 91 },
              updatedAt: '2026-08-03T18:00:02.000Z',
            }
      }),
      prepareAssets: vi.fn(async (request: AssetPreparationRequest) => ({
        contractVersion: 2 as const,
        preparationId: 'prep:fixture',
        siteId: request.siteId,
        artifactId: request.artifactId,
        artifactContentHash: request.artifactContentHash,
        assetManifestHash: request.assetManifestHash,
        idempotencyKey: request.idempotencyKey,
        preparedAt: '2026-08-03T18:00:01.000Z',
        assets: request.assets.map(asset => ({
          assetId: asset.assetId,
          byteHash: asset.byteHash,
          attachmentId: 42,
          url: 'https://wordpress.example.com/uploads/logo.png',
          mimeType: asset.mimeType,
          disposition: 'created' as const,
        })),
      })),
      submitDeployment: vi.fn(async request => {
        submitted = request
        return deploymentResult(request)
      }),
      getDeploymentStatus: vi.fn(),
    }

    const result = await deployVerifiedReleaseThroughRuntime({
      release,
      siteUrl: 'https://wordpress.example.com',
      username: 'operator',
      applicationPassword: 'application password',
      lastVerifiedContentHash: null,
      target: {
        mode: 'canonical_preview',
        siteUrl: 'https://wordpress.example.com',
      },
      publicRuntime: {
        enabled: true,
        apiKey: 'runtime-key',
        apiBaseUrl: 'https://app.example.com',
        websiteId: WEBSITE_ID,
        conversionEndpoint: 'https://app.example.com/api/conversions',
        conversionKey: 'conversion-key',
        telemetryEndpoint: 'https://app.example.com/api/telemetry',
      },
      protection: { mode: 'password_noindex' },
      runtimeClient,
    })

    expect(result.deployment.status).toBe('succeeded')
    expect(result.deployment.appliedContentHash).toBe(
      release.artifact.contentHash
    )
    expect(runtimeClient.prepareAssets).toHaveBeenCalledOnce()
    expect(runtimeClient.submitDeployment).toHaveBeenCalledOnce()
    expect(runtimeClient.getState).toHaveBeenCalledTimes(2)
    const submittedRequest = runtimeClient.submitDeployment.mock
      .calls[0]?.[0] as DeploymentSubmission
    expect(submittedRequest.plan.siteSettings.logoAssetId).toBe(LOGO_ID)
    expect(submittedRequest.plan.designTokens.colors).toEqual(
      (
        release.artifact.blueprint as {
          siteConfiguration: {
            design: { colors: Record<string, string> }
          }
        }
      ).siteConfiguration.design.colors
    )
    expect(submittedRequest.plan.siteConfiguration).toEqual(
      (
        release.artifact.blueprint as {
          siteConfiguration: typeof DEFAULT_SITE_CONFIGURATION
        }
      ).siteConfiguration
    )
    expect(submittedRequest.plan).toMatchObject({
      target: { mode: 'canonical_preview' },
      publicRuntime: { websiteId: WEBSITE_ID },
      protection: { mode: 'password_noindex' },
    })
  })

  it('stops before mutation when remote state drifted', async () => {
    const runtimeClient = {
      getHealth: vi.fn(async () => ({
        contractVersion: 2 as const,
        runtimeVersion: '2.0.0',
        status: 'ok' as const,
        checkedAt: '2026-08-03T18:00:00.000Z',
        dependencies: [{ name: 'wordpress', status: 'ok' as const }],
      })),
      getCapabilities: vi.fn(async () => capabilities()),
      getState: vi.fn(async () => ({
        ...emptyState(),
        artifactContentHash: '9'.repeat(64),
      })),
      prepareAssets: vi.fn(),
      submitDeployment: vi.fn(),
      getDeploymentStatus: vi.fn(),
    }
    await expect(
      deployVerifiedReleaseThroughRuntime({
        release: makeRelease(),
        siteUrl: 'https://wordpress.example.com',
        username: 'operator',
        applicationPassword: 'application password',
        lastVerifiedContentHash: '8'.repeat(64),
        runtimeClient,
      })
    ).rejects.toThrow('changed after the last verified')
    expect(runtimeClient.prepareAssets).not.toHaveBeenCalled()
    expect(runtimeClient.submitDeployment).not.toHaveBeenCalled()
  })

  it('surfaces a stale expected remote hash injected between state read and submit', async () => {
    const runtimeClient = makeSuccessfulRuntimeClient()
    runtimeClient.submitDeployment.mockRejectedValueOnce(
      new SiteForgeRuntimeClientError({
        status: 409,
        requestId: 'request-stale-race',
        failure: {
          code: 'stale_remote_state',
          message: 'Remote state changed after preflight',
          retryable: true,
          stage: 'preflight',
          expectedRemoteContentHash: null,
          actualRemoteContentHash: '9'.repeat(64),
        },
      })
    )

    await expect(
      deployVerifiedReleaseThroughRuntime({
        release: makeRelease(),
        siteUrl: 'https://wordpress.example.com',
        username: 'operator',
        applicationPassword: 'application password',
        lastVerifiedContentHash: null,
        runtimeClient,
      })
    ).rejects.toMatchObject({
      status: 409,
      requestId: 'request-stale-race',
      failure: {
        code: 'stale_remote_state',
        retryable: true,
        expectedRemoteContentHash: null,
        actualRemoteContentHash: '9'.repeat(64),
      },
    })
    expect(runtimeClient.prepareAssets).toHaveBeenCalledOnce()
    expect(runtimeClient.submitDeployment).toHaveBeenCalledOnce()
    expect(runtimeClient.getState).toHaveBeenCalledOnce()
  })

  it('stops before deployment when immutable asset bytes fail runtime verification', async () => {
    const release = makeRelease()
    const runtimeClient = makeSuccessfulRuntimeClient()
    runtimeClient.prepareAssets.mockRejectedValueOnce(
      new SiteForgeRuntimeClientError({
        status: 422,
        requestId: 'request-asset-mismatch',
        failure: {
          code: 'asset_hash_mismatch',
          message: 'Downloaded asset bytes do not match the immutable manifest',
          retryable: false,
          stage: 'asset_preparation',
          details: {
            assetId: LOGO_ID,
            expectedByteHash: release.runtimeAssets[0].byteHash,
            actualByteHash: '9'.repeat(64),
            expectedBytes: release.runtimeAssets[0].bytes,
            actualBytes: release.runtimeAssets[0].bytes + 1,
          },
        },
      })
    )

    await expect(
      deployVerifiedReleaseThroughRuntime({
        release,
        siteUrl: 'https://wordpress.example.com',
        username: 'operator',
        applicationPassword: 'application password',
        lastVerifiedContentHash: null,
        runtimeClient,
      })
    ).rejects.toMatchObject({
      failure: {
        code: 'asset_hash_mismatch',
        retryable: false,
        details: {
          assetId: LOGO_ID,
          expectedByteHash: release.runtimeAssets[0].byteHash,
          actualByteHash: '9'.repeat(64),
        },
      },
    })
    expect(runtimeClient.submitDeployment).not.toHaveBeenCalled()
    expect(runtimeClient.getState).toHaveBeenCalledOnce()
  })

  it('converges on retry after the first successful transaction response is lost', async () => {
    const release = makeRelease()
    const runtimeClient = makeSuccessfulRuntimeClient(
      {},
      { loseFirstSubmitResponse: true }
    )

    await expect(
      deployVerifiedReleaseThroughRuntime({
        release,
        siteUrl: 'https://wordpress.example.com',
        username: 'operator',
        applicationPassword: 'application password',
        lastVerifiedContentHash: null,
        runtimeClient,
      })
    ).rejects.toMatchObject({
      failure: {
        code: 'runtime_unavailable',
        retryable: true,
      },
    })

    const recovered = await deployVerifiedReleaseThroughRuntime({
      release,
      siteUrl: 'https://wordpress.example.com',
      username: 'operator',
      applicationPassword: 'application password',
      lastVerifiedContentHash: release.artifact.contentHash,
      runtimeClient,
    })

    expect(recovered.deployment.status).toBe('succeeded')
    expect(runtimeClient.submitDeployment).toHaveBeenCalledTimes(2)
    expect(runtimeClient.getState).toHaveBeenCalledTimes(3)
    const [lostSubmission, retrySubmission] =
      runtimeClient.submitDeployment.mock.calls.map(
        call => call[0] as DeploymentSubmission
      )
    expect(retrySubmission).toMatchObject({
      artifactId: lostSubmission.artifactId,
      artifactContentHash: lostSubmission.artifactContentHash,
      operationHash: lostSubmission.operationHash,
    })
    expect(retrySubmission.expectedRemoteContentHash).toBe(
      release.artifact.contentHash
    )
  })

  it.each([
    [
      'artifact id',
      { artifactId: '77777777-7777-4777-8777-777777777777' },
    ],
    ['artifact content hash', { artifactContentHash: '7'.repeat(64) }],
    ['asset manifest hash', { assetManifestHash: '7'.repeat(64) }],
    ['operation hash', { operationHash: '7'.repeat(64) }],
    [
      'transaction id',
      { transactionId: '77777777-7777-4777-8777-777777777777' },
    ],
  ] satisfies Array<[string, Partial<RuntimeState>]>)(
    'rejects an exact readback mismatch in %s',
    async (_field, readbackPatch) => {
      const runtimeClient = makeSuccessfulRuntimeClient(readbackPatch)

      await expect(
        deployVerifiedReleaseThroughRuntime({
          release: makeRelease(),
          siteUrl: 'https://wordpress.example.com',
          username: 'operator',
          applicationPassword: 'application password',
          lastVerifiedContentHash: null,
          runtimeClient,
        })
      ).rejects.toThrow(
        'WordPress runtime exact readback does not match the artifact'
      )
      expect(runtimeClient.submitDeployment).toHaveBeenCalledOnce()
      expect(runtimeClient.getState).toHaveBeenCalledTimes(2)
    }
  )

  it('uses only the injected runtime contract and requires no Cloudways configuration', async () => {
    const runtimeClient = makeSuccessfulRuntimeClient()

    const result = await deployVerifiedReleaseThroughRuntime({
      release: makeRelease(),
      siteUrl: 'not-a-provider-url',
      username: '',
      applicationPassword: '',
      lastVerifiedContentHash: null,
      runtimeClient,
    })

    expect(result.deployment.status).toBe('succeeded')
    expect(runtimeClient.getHealth).toHaveBeenCalledOnce()
    expect(runtimeClient.submitDeployment).toHaveBeenCalledOnce()
  })
})

function makeSuccessfulRuntimeClient(
  readbackPatch: Partial<RuntimeState> = {},
  options: { loseFirstSubmitResponse?: boolean } = {}
) {
  let submitted: DeploymentSubmission | null = null
  let submitCount = 0
  const getState = vi.fn(async (): Promise<RuntimeState> => {
    if (!submitted) return emptyState()
    return {
      ...emptyState(),
      artifactId: submitted.artifactId,
      artifactContentHash: submitted.artifactContentHash,
      assetManifestHash: submitted.assetManifestHash,
      operationHash: submitted.operationHash,
      transactionId: '44444444-4444-4444-8444-444444444444',
      pageIds: { 'page:home': 91 },
      updatedAt: '2026-08-03T18:00:02.000Z',
      ...readbackPatch,
    }
  })
  const submitDeployment = vi.fn(
    async (request: DeploymentSubmission): Promise<DeploymentStatus> => {
      submitted = request
      submitCount += 1
      if (options.loseFirstSubmitResponse && submitCount === 1) {
        throw new SiteForgeRuntimeClientError({
          failure: {
            code: 'runtime_unavailable',
            message:
              'Connection closed after the runtime committed the transaction',
            retryable: true,
          },
        })
      }
      return deploymentResult(request)
    }
  )

  return {
    getHealth: vi.fn(async () => ({
      contractVersion: 2 as const,
      runtimeVersion: '2.0.0',
      status: 'ok' as const,
      checkedAt: '2026-08-03T18:00:00.000Z',
      dependencies: [{ name: 'wordpress', status: 'ok' as const }],
    })),
    getCapabilities: vi.fn(async () => capabilities()),
    getState,
    prepareAssets: vi.fn(async (request: AssetPreparationRequest) => ({
      contractVersion: 2 as const,
      preparationId: 'prep:fixture',
      siteId: request.siteId,
      artifactId: request.artifactId,
      artifactContentHash: request.artifactContentHash,
      assetManifestHash: request.assetManifestHash,
      idempotencyKey: request.idempotencyKey,
      preparedAt: '2026-08-03T18:00:01.000Z',
      assets: request.assets.map(asset => ({
        assetId: asset.assetId,
        byteHash: asset.byteHash,
        attachmentId: 42,
        url: 'https://wordpress.example.com/uploads/logo.png',
        mimeType: asset.mimeType,
        disposition: 'created' as const,
      })),
    })),
    submitDeployment,
    getDeploymentStatus: vi.fn(),
  }
}

function makeRelease(): VerifiedSiteForgeRelease {
  const siteConfiguration = structuredClone(DEFAULT_SITE_CONFIGURATION)
  siteConfiguration.media.logoUrl = 'https://cdn.example.com/logo.png'
  const blueprint = {
    version: 1,
    updatedAt: '2026-08-03T18:00:00.000Z',
    propertySnapshot: { name: 'Sunset Apartments', tagline: 'Live well' },
    siteConfiguration,
    legal: {},
    analytics: {},
    pages: [
      {
        slug: 'home',
        title: 'Home',
        purpose: 'Convert visitors',
        sections: [
          {
            id: 'hero-1',
            type: 'hero',
            acfBlock: 'acf/top-slides' as const,
            content: { headline: 'Welcome home' },
            reasoning: 'Primary message',
            order: 1,
          },
        ],
      },
    ],
  }
  const runtimeAssets = [
    {
      assetId: LOGO_ID,
      sourceUrl: 'https://cdn.example.com/logo.png?signature=one',
      byteHash: 'a'.repeat(64),
      bytes: 2_048,
      mimeType: 'image/png',
      filename: 'logo.png',
      role: 'logo',
      altText: 'Sunset Apartments',
      caption: null,
    },
  ]
  return {
    artifact: {
      id: ARTIFACT_ID,
      websiteId: WEBSITE_ID,
      propertyId: '55555555-5555-4555-8555-555555555555',
      orgId: '66666666-6666-4666-8666-666666666666',
      blueprint,
      contentHash: hashRuntimeValue(blueprint),
      assetManifestHash: 'b'.repeat(64),
      baseThemePackageSha256: 'c'.repeat(64),
      overlayPackageSha256: null,
      themeOverlayId: null,
      runtimeContractVersion: 2,
      runtimePackageSha256: 'd'.repeat(64),
      operationSetHash: 'e'.repeat(64),
    },
    assets: [],
    provenanceUrls: [],
    runtimeAssets,
    runtimeSelectedAssets: {
      logoAssetId: LOGO_ID,
      faviconAssetId: null,
    },
    baseThemePackage: Buffer.from('theme'),
    runtimePackage: Buffer.from('runtime'),
    overlayPackage: null,
    overlayContentHash: null,
  }
}

function capabilities() {
  return {
    contractVersion: 2 as const,
    runtimeVersion: '2.0.0',
    provider: 'wordpress' as const,
    authentication: 'wordpress_application_password' as const,
    features: {
      immutableAssetPreparation: true as const,
      optimisticConcurrency: true as const,
      idempotentDeployments: true as const,
      transactionalRollback: true as const,
      pageRemovals: true as const,
      navigationMutation: true as const,
      designTokenMutation: true as const,
      siteSettingsMutation: true as const,
      legalMutation: true as const,
      analyticsMutation: true as const,
    },
    limits: {
      maxAssetsPerPreparation: 100,
      maxAssetBytes: 25_000_000,
      maxPagesPerDeployment: 200,
      acceptedAssetMimeTypes: ['image/png'],
    },
  }
}

function emptyState() {
  return {
    contractVersion: 2 as const,
    runtimeVersion: '2.0.0',
    siteId: WEBSITE_ID,
    artifactId: null,
    artifactContentHash: null,
    assetManifestHash: null,
    operationHash: null,
    transactionId: null,
    pageIds: {},
    mediaBindings: {},
    updatedAt: null,
  }
}

function deploymentResult(request: DeploymentSubmission) {
  return {
    contractVersion: 2 as const,
    transactionId: '44444444-4444-4444-8444-444444444444',
    status: 'succeeded' as const,
    phase: 'complete' as const,
    siteId: request.siteId,
    artifactId: request.artifactId,
    artifactContentHash: request.artifactContentHash,
    assetManifestHash: request.assetManifestHash,
    operationHash: request.operationHash,
    idempotencyKey: request.idempotencyKey,
    expectedRemoteContentHash: request.expectedRemoteContentHash,
    previousRemoteContentHash: request.expectedRemoteContentHash,
    appliedContentHash: request.artifactContentHash,
    runtimeVersion: '2.0.0',
    pageIds: { 'page:home': 91 },
    mediaBindings: {
      [LOGO_ID]: {
        attachmentId: 42,
        url: 'https://wordpress.example.com/uploads/logo.png',
        byteHash: 'a'.repeat(64),
        mimeType: 'image/png',
      },
    },
    rollback: {
      attempted: false,
      succeeded: null,
      restoredContentHash: request.expectedRemoteContentHash,
      failure: null,
    },
    verification: {
      verified: true,
      checks: [{ name: 'manifest', passed: true, message: 'Exact' }],
      verifiedAt: '2026-08-03T18:00:02.000Z',
    },
    submittedAt: '2026-08-03T18:00:01.000Z',
    startedAt: '2026-08-03T18:00:01.000Z',
    completedAt: '2026-08-03T18:00:02.000Z',
    idempotentReplay: false,
    failure: null,
  }
}
