import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveAssetManifestHash,
  deriveRuntimeIdempotencyKey,
  deriveRuntimeOperationHash,
  type AssetPreparationRequest,
  type CompiledMutationPlan,
  type DeploymentSubmission,
} from '@/utils/siteforge/runtime-contract'
import {
  SiteForgeRuntimeClient,
  SiteForgeRuntimeClientError,
} from './runtime-client'

describe('SiteForgeRuntimeClient v2', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let client: SiteForgeRuntimeClient

  beforeEach(() => {
    fetchMock.mockReset()
    client = new SiteForgeRuntimeClient({
      baseUrl: 'https://wordpress.example.com/',
      username: 'siteforge-runtime',
      applicationPassword: 'abcd efgh ijkl mnop',
      fetch: fetchMock,
    })
  })

  it('uses v2 and WordPress Application Password authentication', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(await fixture('health.json')))
      .mockResolvedValueOnce(jsonResponse(await fixture('capabilities.json')))
      .mockResolvedValueOnce(jsonResponse(await fixture('state.json')))

    await expect(client.getHealth()).resolves.toMatchObject({
      contractVersion: 2,
    })
    await expect(client.getCapabilities()).resolves.toMatchObject({
      authentication: 'wordpress_application_password',
    })
    await expect(client.getState('site-1')).resolves.toMatchObject({
      artifactId: ARTIFACT_ID,
      artifactContentHash: 'a'.repeat(64),
    })

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://wordpress.example.com/wp-json/siteforge/v2/health',
      'https://wordpress.example.com/wp-json/siteforge/v2/capabilities',
      'https://wordpress.example.com/wp-json/siteforge/v2/state?siteId=site-1',
    ])
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from(
        'siteforge-runtime:abcd efgh ijkl mnop'
      ).toString('base64')}`
    )
    expect(headers.get('x-siteforge-contract-version')).toBe('2')
  })

  it('sends exact artifact and immutable asset identities', async () => {
    const request = assetRequest()
    const fixtureResult = (await fixture(
      'asset-preparation-result.json'
    )) as Record<string, unknown>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...fixtureResult,
        artifactContentHash: request.artifactContentHash,
        assetManifestHash: request.assetManifestHash,
        idempotencyKey: request.idempotencyKey,
      })
    )

    const result = await client.prepareAssets(request)

    expect(result.assets[0]).toMatchObject({
      attachmentId: 201,
      byteHash: 'd'.repeat(64),
    })
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.get('x-siteforge-artifact-id')).toBe(ARTIFACT_ID)
    expect(headers.get('x-siteforge-artifact-content-hash')).toBe(
      ARTIFACT_CONTENT_HASH
    )
    expect(JSON.parse(String(init?.body))).toEqual(request)
  })

  it('submits the compiled operation hash and parses transaction results', async () => {
    const submission = deploymentSubmission()
    const fixtureResult = (await fixture(
      'deployment-succeeded.json'
    )) as Record<string, unknown>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...fixtureResult,
        artifactContentHash: submission.artifactContentHash,
        assetManifestHash: submission.assetManifestHash,
        operationHash: submission.operationHash,
        idempotencyKey: submission.idempotencyKey,
        expectedRemoteContentHash:
          submission.expectedRemoteContentHash,
        previousRemoteContentHash:
          submission.expectedRemoteContentHash,
        appliedContentHash: submission.artifactContentHash,
      })
    )

    const result = await client.submitDeployment(submission)

    expect(result).toMatchObject({
      transactionId: TRANSACTION_ID,
      appliedContentHash: ARTIFACT_CONTENT_HASH,
      runtimeVersion: '2.0.0',
      rollback: { attempted: false },
    })
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.get('x-siteforge-operation-hash')).toBe(
      submission.operationHash
    )
    expect(headers.get('if-match')).toBe(`"${'f'.repeat(64)}"`)
    expect(headers.get('idempotency-key')).toBe(
      submission.idempotencyKey
    )
  })

  it('parses precise stale-state failures', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(await fixture('stale-remote-error.json'), 409)
    )

    const error = await client
      .submitDeployment(deploymentSubmission())
      .catch(value => value)

    expect(error).toBeInstanceOf(SiteForgeRuntimeClientError)
    expect(error).toMatchObject({
      status: 409,
      requestId: 'request-stale-1',
      failure: {
        code: 'stale_remote_state',
        expectedRemoteContentHash: 'f'.repeat(64),
        actualRemoteContentHash: '9'.repeat(64),
      },
    })
  })

  it('replays an identical deployment with the exact idempotency identity', async () => {
    const submission = deploymentSubmission()
    const fixtureResult = (await fixture(
      'deployment-succeeded.json'
    )) as Record<string, unknown>
    const response = {
      ...fixtureResult,
      artifactContentHash: submission.artifactContentHash,
      assetManifestHash: submission.assetManifestHash,
      operationHash: submission.operationHash,
      idempotencyKey: submission.idempotencyKey,
      expectedRemoteContentHash: submission.expectedRemoteContentHash,
      previousRemoteContentHash: submission.expectedRemoteContentHash,
      appliedContentHash: submission.artifactContentHash,
    }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(response))
      .mockResolvedValueOnce(
        jsonResponse({ ...response, idempotentReplay: true })
      )

    const first = await client.submitDeployment(submission)
    const replay = await client.submitDeployment(submission)

    expect(first.idempotentReplay).toBe(false)
    expect(replay).toMatchObject({
      transactionId: first.transactionId,
      idempotencyKey: submission.idempotencyKey,
      idempotentReplay: true,
    })
    const requests = fetchMock.mock.calls.map(([, init]) => ({
      body: init?.body,
      idempotencyKey: new Headers(init?.headers).get('idempotency-key'),
    }))
    expect(requests[1]).toEqual(requests[0])
  })

  it('parses an idempotency conflict for a reused key with different intent', async () => {
    const submission = deploymentSubmission()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          contractVersion: 2,
          requestId: 'request-conflict-1',
          error: {
            code: 'idempotency_conflict',
            message:
              'Idempotency key was already used for another operation hash',
            retryable: false,
            stage: 'preflight',
            operationHash: submission.operationHash,
            details: {
              idempotencyKey: submission.idempotencyKey,
              existingOperationHash: '9'.repeat(64),
            },
          },
        },
        409
      )
    )

    await expect(
      client.submitDeployment(submission)
    ).rejects.toMatchObject({
      status: 409,
      requestId: 'request-conflict-1',
      failure: {
        code: 'idempotency_conflict',
        retryable: false,
        operationHash: submission.operationHash,
        details: {
          idempotencyKey: submission.idempotencyKey,
          existingOperationHash: '9'.repeat(64),
        },
      },
    })
  })

  it('parses immutable asset byte and hash mismatch failures', async () => {
    const request = assetRequest()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          contractVersion: 2,
          requestId: 'request-asset-mismatch-1',
          error: {
            code: 'asset_hash_mismatch',
            message: 'Downloaded asset bytes do not match the manifest',
            retryable: false,
            stage: 'asset_preparation',
            details: {
              assetId: request.assets[0].assetId,
              expectedByteHash: request.assets[0].byteHash,
              actualByteHash: 'e'.repeat(64),
              expectedBytes: request.assets[0].bytes,
              actualBytes: request.assets[0].bytes + 1,
            },
          },
        },
        422
      )
    )

    await expect(client.prepareAssets(request)).rejects.toMatchObject({
      status: 422,
      requestId: 'request-asset-mismatch-1',
      failure: {
        code: 'asset_hash_mismatch',
        retryable: false,
        stage: 'asset_preparation',
        details: {
          assetId: request.assets[0].assetId,
          expectedByteHash: request.assets[0].byteHash,
          actualByteHash: 'e'.repeat(64),
          expectedBytes: request.assets[0].bytes,
          actualBytes: request.assets[0].bytes + 1,
        },
      },
    })
  })

  it('preserves rollback metadata on a failed deployment status', async () => {
    const fixtureResult = (await fixture(
      'deployment-succeeded.json'
    )) as Record<string, unknown>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...fixtureResult,
        status: 'failed',
        phase: 'rollback',
        appliedContentHash: null,
        rollback: {
          attempted: true,
          succeeded: true,
          restoredContentHash: 'f'.repeat(64),
          failure: null,
        },
        verification: null,
        failure: {
          code: 'operation_failed',
          message: 'Page mutation failed and the previous state was restored',
          retryable: true,
          stage: 'pages',
          operationHash: fixtureResult.operationHash,
          expectedRemoteContentHash: 'f'.repeat(64),
          actualRemoteContentHash: 'f'.repeat(64),
          details: { failedPageKey: 'page:home' },
        },
      })
    )

    const failed = await client.getDeploymentStatus(TRANSACTION_ID)

    expect(failed).toMatchObject({
      status: 'failed',
      phase: 'rollback',
      appliedContentHash: null,
      rollback: {
        attempted: true,
        succeeded: true,
        restoredContentHash: 'f'.repeat(64),
        failure: null,
      },
      failure: {
        code: 'operation_failed',
        retryable: true,
        stage: 'pages',
        details: { failedPageKey: 'page:home' },
      },
    })
  })

  it('rejects incomplete successful deployment responses', async () => {
    const fixtureResult = (await fixture(
      'deployment-succeeded.json'
    )) as Record<string, unknown>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...fixtureResult,
        appliedContentHash: null,
      })
    )

    await expect(
      client.getDeploymentStatus(TRANSACTION_ID)
    ).rejects.toMatchObject({
      failure: { code: 'invalid_response' },
    })
  })
})

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111'
const TRANSACTION_ID = '55555555-5555-4555-8555-555555555555'
const ARTIFACT_CONTENT_HASH = 'a'.repeat(64)

function assetRequest(): AssetPreparationRequest {
  const assets = [
    {
      assetId: '22222222-2222-4222-8222-222222222222',
      sourceUrl: 'https://cdn.example.com/logo.png?signature=one',
      byteHash: 'd'.repeat(64),
      bytes: 1_024,
      mimeType: 'image/png',
      filename: 'logo.png',
      role: 'logo',
      altText: 'Property logo',
      caption: null,
    },
  ]
  const assetManifestHash = deriveAssetManifestHash(assets)
  return {
    contractVersion: 2,
    siteId: 'site-1',
    artifactId: ARTIFACT_ID,
    artifactContentHash: ARTIFACT_CONTENT_HASH,
    assetManifestHash,
    idempotencyKey: deriveRuntimeIdempotencyKey('asset_preparation', {
      siteId: 'site-1',
      artifactId: ARTIFACT_ID,
      artifactContentHash: ARTIFACT_CONTENT_HASH,
      payloadHash: assetManifestHash,
    }),
    assets,
  }
}

function deploymentSubmission(): DeploymentSubmission {
  const plan = minimalPlan()
  const operationHash = deriveRuntimeOperationHash(plan)
  const expectedRemoteContentHash = 'f'.repeat(64)
  return {
    contractVersion: 2,
    siteId: 'site-1',
    artifactId: ARTIFACT_ID,
    artifactContentHash: ARTIFACT_CONTENT_HASH,
    assetManifestHash: 'b'.repeat(64),
    operationHash,
    idempotencyKey: deriveRuntimeIdempotencyKey('deployment', {
      siteId: 'site-1',
      artifactId: ARTIFACT_ID,
      artifactContentHash: ARTIFACT_CONTENT_HASH,
      expectedRemoteContentHash,
      payloadHash: operationHash,
    }),
    expectedRemoteContentHash,
    assetPreparationId: 'prep:fixture',
    plan,
  }
}

function minimalPlan(): CompiledMutationPlan {
  return {
    pages: [
      {
        pageKey: 'page:home',
        slug: 'home',
        title: 'Home',
        purpose: 'Convert',
        status: 'publish',
        menuOrder: 0,
        template: '',
        excerpt: '',
        seo: null,
        sections: [],
      },
    ],
    removals: { pageKeys: [], pageSlugs: [] },
    navigation: {
      location: 'primary',
      name: 'SiteForge Primary',
      items: [],
    },
    designTokens: {
      colors: {
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333',
        background: '#ffffff',
        text: '#111111',
      },
      typography: {
        headingFont: 'Inter, sans-serif',
        bodyFont: 'Inter, sans-serif',
        headingWeight: 600,
      },
      spacing: {
        containerMaxWidth: '1200px',
        sectionPadding: '4rem',
      },
    },
    siteSettings: {
      siteName: 'Sunset Apartments',
      tagline: 'Welcome home',
      homepagePageKey: 'page:home',
      logoAssetId: null,
      faviconAssetId: null,
    },
    legal: {},
    analytics: {},
  }
}

async function fixture(name: string): Promise<unknown> {
  const file = path.resolve(
    process.cwd(),
    '../../../wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2',
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
