import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveRuntimeV3RollbackIdempotencyKey,
  type ImmutableSiteForgeRuntimeV3Release,
  type RuntimeV3AssetPreparationResult,
  type RuntimeV3DeploymentSubmission,
} from '@/utils/siteforge/runtime-contract-v3'
import {
  compileSiteForgeRuntimeV3Release,
  createSiteForgeRuntimeV3DeploymentSubmission,
} from './runtime-compiler-v3'
import {
  SiteForgeRuntimeV3Client,
  SiteForgeRuntimeV3ClientError,
} from './runtime-client-v3'

describe('SiteForgeRuntimeV3Client', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let client: SiteForgeRuntimeV3Client

  beforeEach(() => {
    fetchMock.mockReset()
    client = new SiteForgeRuntimeV3Client({
      baseUrl: 'https://wordpress.example.com/',
      username: 'siteforge-runtime',
      applicationPassword: 'abcd efgh ijkl mnop',
      fetch: fetchMock,
    })
  })

  it('uses only the v3 namespace, header, and strict capabilities', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(await fixture('capabilities.json'))
    )

    await expect(client.getCapabilities()).resolves.toMatchObject({
      contractVersion: 3,
      features: {
        completeResourceGraph: true,
        exactPackageIdentity: true,
      },
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://wordpress.example.com/wp-json/siteforge/v3/capabilities'
    )
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('x-siteforge-contract-version')).toBe('3')
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from(
        'siteforge-runtime:abcd efgh ijkl mnop'
      ).toString('base64')}`
    )
  })

  it('sends exact package, graph, asset, and operation identities', async () => {
    const compiled = compileSiteForgeRuntimeV3Release({
      release: await releaseFixture(),
      expectedRemoteContentHash: 'f'.repeat(64),
    })
    const prepared = preparedAssets(compiled)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(prepared))
      .mockResolvedValueOnce(
        jsonResponse(
          deploymentStatus(
            createSiteForgeRuntimeV3DeploymentSubmission({
              compiled,
              assetPreparation: prepared,
              expectedRemoteContentHash: 'f'.repeat(64),
            })
          )
        )
      )

    await client.prepareAssets(compiled.assetPreparation)
    const submission = createSiteForgeRuntimeV3DeploymentSubmission({
      compiled,
      assetPreparation: prepared,
      expectedRemoteContentHash: 'f'.repeat(64),
    })
    await expect(client.submitDeployment(submission)).resolves.toMatchObject({
      contractVersion: 3,
      status: 'succeeded',
      identity: compiled.release.identity,
    })

    const prepareHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(prepareHeaders.get('x-siteforge-asset-manifest-hash')).toBe(
      compiled.release.identity.assetManifestHash
    )
    const deploymentHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers)
    expect(deploymentHeaders.get('x-siteforge-resource-graph-hash')).toBe(
      compiled.release.identity.resourceGraphHash
    )
    expect(deploymentHeaders.get('x-siteforge-operation-set-hash')).toBe(
      compiled.release.identity.operationSetHash
    )
    expect(deploymentHeaders.get('x-siteforge-runtime-archive-sha256')).toBe(
      compiled.release.identity.runtimePackage.archiveSha256
    )
    expect(deploymentHeaders.get('x-siteforge-runtime-manifest-sha256')).toBe(
      compiled.release.identity.runtimePackage.manifestSha256
    )
    expect(deploymentHeaders.get('if-match')).toBe(`"${'f'.repeat(64)}"`)
  })

  it('rejects v2 and extended responses instead of reinterpreting them', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          contractVersion: 2,
          runtimeVersion: '2.0.0',
          provider: 'wordpress',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...(await fixture('capabilities.json') as Record<string, unknown>),
          unknownCapability: true,
        })
      )

    await expect(client.getCapabilities()).rejects.toMatchObject({
      failure: { code: 'invalid_response' },
    })
    await expect(client.getCapabilities()).rejects.toMatchObject({
      failure: { code: 'invalid_response' },
    })
  })

  it('parses precise v3 failures and fail-closed unknown error shapes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            contractVersion: 3,
            requestId: 'request-v3-stale',
            error: {
              code: 'stale_remote_state',
              message: 'Remote state changed after preflight',
              retryable: true,
              stage: 'preflight',
              expectedRemoteContentHash: 'f'.repeat(64),
              actualRemoteContentHash: '9'.repeat(64),
            },
          },
          409
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            contractVersion: 4,
            error: {
              code: 'future_error',
              message: 'Unknown contract',
              retryable: false,
            },
          },
          400
        )
      )

    const precise = await client.getState('site-1').catch(error => error)
    expect(precise).toBeInstanceOf(SiteForgeRuntimeV3ClientError)
    expect(precise).toMatchObject({
      status: 409,
      requestId: 'request-v3-stale',
      failure: {
        code: 'stale_remote_state',
        expectedRemoteContentHash: 'f'.repeat(64),
      },
    })
    await expect(client.getState('site-1')).rejects.toMatchObject({
      status: 400,
      failure: { code: 'invalid_response', retryable: false },
    })
  })

  it('submits rollback with exact restore and concurrency identities', async () => {
    const compiled = compileSiteForgeRuntimeV3Release({
      release: await releaseFixture(),
      expectedRemoteContentHash: null,
    })
    const submission = createSiteForgeRuntimeV3DeploymentSubmission({
      compiled,
      assetPreparation: preparedAssets(compiled),
      expectedRemoteContentHash: null,
    })
    const rollbackInput = {
      transactionId: '55555555-5555-4555-8555-555555555555',
      siteId: compiled.release.identity.siteId,
      expectedCurrentContentHash: compiled.release.identity.artifactContentHash,
      restoreArtifactContentHash: '8'.repeat(64),
      restoreResourceGraphHash: '7'.repeat(64),
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(deploymentStatus(submission)))

    await client.rollbackDeployment({
      contractVersion: 3,
      ...rollbackInput,
      idempotencyKey: deriveRuntimeV3RollbackIdempotencyKey(rollbackInput),
    })

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://wordpress.example.com/wp-json/siteforge/v3/deployments/55555555-5555-4555-8555-555555555555/rollback'
    )
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('if-match')).toBe(
      `"${compiled.release.identity.artifactContentHash}"`
    )
    expect(headers.get('x-siteforge-resource-graph-hash')).toBe('7'.repeat(64))
  })

  it('parses the strict v2 downgrade projection endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(await fixture('projection-v2.json'))
    )

    await expect(client.getV2Projection()).resolves.toMatchObject({
      contractVersion: 3,
      projection: { contractVersion: 2, siteId: 'site-1' },
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://wordpress.example.com/wp-json/siteforge/v3/projection/v2'
    )
  })

  it('rejects malformed resource and transaction identities before I/O', async () => {
    await expect(client.getState('site id with spaces')).rejects.toMatchObject({
      failure: { code: 'invalid_artifact' },
    })
    await expect(client.getDeploymentStatus('not-a-uuid')).rejects.toMatchObject({
      failure: { code: 'invalid_artifact' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects remote archive or manifest identity drift from health and state', async () => {
    const release = await releaseFixture()
    const expected = release.identity.runtimePackage
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        contractVersion: 3,
        runtimeVersion: '3.0.0',
        namespace: 'siteforge/v3',
        status: 'ok',
        checkedAt: '2026-08-04T20:03:00.000Z',
        installedRuntime: {
          ...expected,
          archiveSha256: '9'.repeat(64),
        },
        dependencies: [],
      })
    )

    await expect(
      client.verifyInstalledPackageIdentity(expected, 'site-1')
    ).rejects.toMatchObject({
      failure: {
        code: 'invalid_response',
        stage: 'verification',
        details: { actualArchiveSha256: '9'.repeat(64) },
      },
    })

    const stateIdentity = structuredClone(release.identity)
    stateIdentity.runtimePackage.archiveSha256 = '8'.repeat(64)
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          contractVersion: 3,
          runtimeVersion: '3.0.0',
          namespace: 'siteforge/v3',
          status: 'ok',
          checkedAt: '2026-08-04T20:04:00.000Z',
          installedRuntime: expected,
          dependencies: [],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          contractVersion: 3,
          runtimeVersion: '3.0.0',
          siteId: 'site-1',
          identity: stateIdentity,
          transactionId: null,
          target: null,
          resourceHashes: {},
          mediaBindings: {},
          v2Projection: null,
          updatedAt: null,
        })
      )

    await expect(
      client.verifyInstalledPackageIdentity(expected, 'site-1')
    ).rejects.toMatchObject({
      failure: {
        code: 'invalid_response',
        message: expect.stringContaining('state package identity'),
        details: { actualArchiveSha256: '8'.repeat(64) },
      },
    })
  })
})

function preparedAssets(
  compiled: ReturnType<typeof compileSiteForgeRuntimeV3Release>
): RuntimeV3AssetPreparationResult {
  return {
    contractVersion: 3,
    preparationId: 'preparation:fixture',
    identity: structuredClone(compiled.release.identity),
    idempotencyKey: compiled.assetPreparation.idempotencyKey,
    preparedAt: '2026-08-04T20:01:00.000Z',
    assets: compiled.release.resourceGraph.assets.map((asset, index) => ({
      assetId: asset.assetId,
      byteSha256: asset.byteSha256,
      attachmentId: index + 100,
      url: `https://wordpress.example.com/uploads/${asset.filename}`,
      mimeType: asset.mimeType,
      disposition: 'created',
    })),
  }
}

function deploymentStatus(submission: RuntimeV3DeploymentSubmission) {
  const identity = submission.release.identity
  const firstAsset = submission.release.resourceGraph.assets[0]
  return {
    contractVersion: 3,
    transactionId: '55555555-5555-4555-8555-555555555555',
    status: 'succeeded',
    phase: 'complete',
    identity,
    idempotencyKey: submission.idempotencyKey,
    expectedRemoteContentHash: submission.expectedRemoteContentHash,
    previousRemoteContentHash: submission.expectedRemoteContentHash,
    appliedContentHash: identity.artifactContentHash,
    runtimeVersion: '3.0.0',
    resourceIds: { 'page:home': 101 },
    mediaBindings: {
      [firstAsset.assetId]: {
        assetId: firstAsset.assetId,
        byteSha256: firstAsset.byteSha256,
        attachmentId: 100,
        url: `https://wordpress.example.com/uploads/${firstAsset.filename}`,
        mimeType: firstAsset.mimeType,
        disposition: 'created',
      },
    },
    v2Projection: {
      contractVersion: 2,
      siteId: identity.siteId,
      artifactId: identity.artifactId,
      artifactContentHash: identity.artifactContentHash,
      assetManifestHash: identity.assetManifestHash,
      operationHash: identity.operationSetHash,
      stateHash: '6'.repeat(64),
    },
    rollback: {
      attempted: false,
      succeeded: null,
      restoredArtifactContentHash: null,
      restoredResourceGraphHash: null,
      failure: null,
    },
    verification: {
      verified: true,
      resourceGraphHash: identity.resourceGraphHash,
      packageManifestSha256: identity.runtimePackage.manifestSha256,
      checks: [{ name: 'readback', passed: true, message: 'Exact' }],
      verifiedAt: '2026-08-04T20:02:00.000Z',
    },
    submittedAt: '2026-08-04T20:01:00.000Z',
    startedAt: '2026-08-04T20:01:00.000Z',
    completedAt: '2026-08-04T20:02:00.000Z',
    idempotentReplay: false,
    failure: null,
  }
}

async function releaseFixture(): Promise<ImmutableSiteForgeRuntimeV3Release> {
  return (await fixture('release.json')) as ImmutableSiteForgeRuntimeV3Release
}

async function fixture(name: string): Promise<unknown> {
  const file = path.resolve(
    process.cwd(),
    '../../../wordpress-plugin/oneclick-siteforge-runtime/fixtures/v3',
    name
  )
  return JSON.parse(await readFile(file, 'utf8')) as unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': 'request-header',
    },
  })
}
