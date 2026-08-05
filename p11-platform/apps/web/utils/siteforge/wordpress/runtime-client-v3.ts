import { z } from 'zod'
import {
  SITEFORGE_RUNTIME_V3_CONTRACT_VERSION,
  runtimeV3AssetPreparationRequestSchema,
  runtimeV3AssetPreparationResultSchema,
  runtimeV3CapabilitiesSchema,
  runtimeV3DeploymentStatusSchema,
  runtimeV3DeploymentSubmissionSchema,
  runtimeV3ErrorResponseSchema,
  runtimeV3FailureSchema,
  runtimeV3HealthSchema,
  runtimeV3IdSchema,
  runtimeV3RollbackRequestSchema,
  runtimeV3StateSchema,
  runtimeV3V2ProjectionResponseSchema,
  runtimeV3ArtifactIdSchema,
  type RuntimeV3AssetPreparationRequest,
  type RuntimeV3AssetPreparationResult,
  type RuntimeV3Capabilities,
  type RuntimeV3DeploymentStatus,
  type RuntimeV3DeploymentSubmission,
  type RuntimeV3Failure,
  type RuntimeV3Health,
  type RuntimeV3PackageIdentity,
  type RuntimeV3RollbackRequest,
  type RuntimeV3State,
  type RuntimeV3V2ProjectionResponse,
} from '@/utils/siteforge/runtime-contract-v3'

export interface SiteForgeRuntimeV3ClientOptions {
  baseUrl: string
  username: string
  applicationPassword: string | (() => string | Promise<string>)
  fetch?: typeof fetch
  timeoutMs?: number
  runtimePath?: string
}

export class SiteForgeRuntimeV3ClientError extends Error {
  readonly failure: RuntimeV3Failure
  readonly status: number | null
  readonly requestId: string | null

  constructor(input: {
    failure: RuntimeV3Failure
    status?: number | null
    requestId?: string | null
    cause?: unknown
  }) {
    super(input.failure.message, { cause: input.cause })
    this.name = 'SiteForgeRuntimeV3ClientError'
    this.failure = runtimeV3FailureSchema.parse(input.failure)
    this.status = input.status ?? null
    this.requestId = input.requestId ?? null
  }
}

export class SiteForgeRuntimeV3Client {
  private readonly baseUrl: string
  private readonly username: string
  private readonly applicationPassword: SiteForgeRuntimeV3ClientOptions['applicationPassword']
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly runtimePath: string

  constructor(options: SiteForgeRuntimeV3ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.username = options.username.trim()
    this.applicationPassword = options.applicationPassword
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.runtimePath = normalizeRuntimePath(
      options.runtimePath ?? '/wp-json/siteforge/v3'
    )
    if (!this.username) {
      throw new Error('WordPress Application Password username is required')
    }
  }

  async getHealth(): Promise<RuntimeV3Health> {
    return this.request('/health', { method: 'GET' }, runtimeV3HealthSchema)
  }

  async getCapabilities(): Promise<RuntimeV3Capabilities> {
    return this.request(
      '/capabilities',
      { method: 'GET' },
      runtimeV3CapabilitiesSchema
    )
  }

  async getState(siteId: string): Promise<RuntimeV3State> {
    const parsedSiteId = parseClientInput(
      runtimeV3IdSchema,
      siteId,
      'A valid SiteForge runtime v3 site id is required'
    )
    const query = new URLSearchParams({ siteId: parsedSiteId })
    return this.request(
      `/state?${query.toString()}`,
      { method: 'GET' },
      runtimeV3StateSchema
    )
  }

  async verifyInstalledPackageIdentity(
    expected: Pick<
      RuntimeV3PackageIdentity,
      'archiveSha256' | 'manifestSha256'
    >,
    siteId?: string
  ): Promise<{ health: RuntimeV3Health; state: RuntimeV3State | null }> {
    const health = await this.getHealth()
    assertRemotePackageIdentity(health.installedRuntime, expected, 'health')
    const state = siteId ? await this.getState(siteId) : null
    if (state?.identity) {
      assertRemotePackageIdentity(
        state.identity.runtimePackage,
        expected,
        'state'
      )
    }
    return { health, state }
  }

  async getV2Projection(): Promise<RuntimeV3V2ProjectionResponse> {
    return this.request(
      '/projection/v2',
      { method: 'GET' },
      runtimeV3V2ProjectionResponseSchema
    )
  }

  async prepareAssets(
    request: RuntimeV3AssetPreparationRequest
  ): Promise<RuntimeV3AssetPreparationResult> {
    const payload = runtimeV3AssetPreparationRequestSchema.parse(request)
    return this.request(
      '/assets/prepare',
      {
        method: 'POST',
        headers: identityHeaders(payload.identity, payload.idempotencyKey),
        body: JSON.stringify(payload),
      },
      runtimeV3AssetPreparationResultSchema
    )
  }

  async submitDeployment(
    request: RuntimeV3DeploymentSubmission
  ): Promise<RuntimeV3DeploymentStatus> {
    const payload = runtimeV3DeploymentSubmissionSchema.parse(request)
    const headers = identityHeaders(
      payload.release.identity,
      payload.idempotencyKey
    )
    headers['X-SiteForge-Resource-Graph-Hash'] =
      payload.release.identity.resourceGraphHash
    headers['X-SiteForge-Operation-Set-Hash'] =
      payload.release.identity.operationSetHash
    headers['X-SiteForge-Runtime-Archive-Sha256'] =
      payload.release.identity.runtimePackage.archiveSha256
    headers['X-SiteForge-Runtime-Manifest-Sha256'] =
      payload.release.identity.runtimePackage.manifestSha256
    if (payload.expectedRemoteContentHash) {
      headers['If-Match'] = `"${payload.expectedRemoteContentHash}"`
    } else {
      headers['If-None-Match'] = '*'
    }
    return this.request(
      '/deployments',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      runtimeV3DeploymentStatusSchema
    )
  }

  async getDeploymentStatus(
    transactionId: string
  ): Promise<RuntimeV3DeploymentStatus> {
    const parsedTransactionId = parseClientInput(
      runtimeV3ArtifactIdSchema,
      transactionId,
      'A valid SiteForge runtime v3 transaction id is required'
    )
    return this.request(
      `/deployments/${encodeURIComponent(parsedTransactionId)}`,
      { method: 'GET' },
      runtimeV3DeploymentStatusSchema
    )
  }

  async rollbackDeployment(
    request: RuntimeV3RollbackRequest
  ): Promise<RuntimeV3DeploymentStatus> {
    const payload = runtimeV3RollbackRequestSchema.parse(request)
    return this.request(
      `/deployments/${encodeURIComponent(payload.transactionId)}/rollback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payload.idempotencyKey,
          'X-SiteForge-Artifact-Content-Hash':
            payload.restoreArtifactContentHash,
          'X-SiteForge-Resource-Graph-Hash': payload.restoreResourceGraphHash,
          'If-Match': `"${payload.expectedCurrentContentHash}"`,
        },
        body: JSON.stringify(payload),
      },
      runtimeV3DeploymentStatusSchema
    )
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    responseSchema: z.ZodType<T>
  ): Promise<T> {
    const authorization = await this.resolveAuthorization()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const url = `${this.baseUrl}${this.runtimePath}${path}`

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: authorization,
          'X-SiteForge-Contract-Version': String(
            SITEFORGE_RUNTIME_V3_CONTRACT_VERSION
          ),
          ...headersToRecord(init.headers),
        },
        signal: controller.signal,
      })
      const requestId = response.headers.get('x-request-id')
      const body = await parseResponseBody(response)
      if (!response.ok) {
        const parsedError = runtimeV3ErrorResponseSchema.safeParse(body)
        if (parsedError.success) {
          throw new SiteForgeRuntimeV3ClientError({
            failure: parsedError.data.error,
            status: response.status,
            requestId: parsedError.data.requestId ?? requestId,
          })
        }
        throw new SiteForgeRuntimeV3ClientError({
          failure: fallbackHttpFailure(response.status, body),
          status: response.status,
          requestId,
        })
      }

      const parsed = responseSchema.safeParse(body)
      if (!parsed.success) {
        throw new SiteForgeRuntimeV3ClientError({
          failure: {
            code: 'invalid_response',
            message: `SiteForge runtime v3 returned an invalid response for ${path}`,
            retryable: false,
            details: { issues: parsed.error.issues },
          },
          status: response.status,
          requestId,
        })
      }
      return parsed.data
    } catch (error) {
      if (error instanceof SiteForgeRuntimeV3ClientError) throw error
      const timedOut = error instanceof Error && error.name === 'AbortError'
      throw new SiteForgeRuntimeV3ClientError({
        failure: {
          code: 'runtime_unavailable',
          message: timedOut
            ? `SiteForge runtime v3 request timed out after ${this.timeoutMs}ms`
            : `SiteForge runtime v3 request failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
          retryable: true,
        },
        cause: error,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async resolveAuthorization(): Promise<string> {
    const password =
      typeof this.applicationPassword === 'function'
        ? await this.applicationPassword()
        : this.applicationPassword
    if (!password.trim()) {
      throw new SiteForgeRuntimeV3ClientError({
        failure: {
          code: 'unauthorized',
          message: 'A WordPress Application Password is required',
          retryable: false,
          stage: 'authentication',
        },
      })
    }
    return `Basic ${Buffer.from(
      `${this.username}:${password.trim()}`,
      'utf8'
    ).toString('base64')}`
  }
}

function identityHeaders(
  identity: RuntimeV3AssetPreparationRequest['identity'],
  idempotencyKey: string
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    'X-SiteForge-Artifact-Id': identity.artifactId,
    'X-SiteForge-Artifact-Content-Hash': identity.artifactContentHash,
    'X-SiteForge-Asset-Manifest-Hash': identity.assetManifestHash,
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function fallbackHttpFailure(status: number, body: unknown): RuntimeV3Failure {
  const message =
    body &&
    typeof body === 'object' &&
    'message' in body &&
    typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : typeof body === 'string' && body.trim()
        ? body
        : `SiteForge runtime v3 request failed with HTTP ${status}`
  if (status === 401) {
    return { code: 'unauthorized', message, retryable: false }
  }
  if (status === 403) {
    return { code: 'forbidden', message, retryable: false }
  }
  if (status === 429) {
    return { code: 'rate_limited', message, retryable: true }
  }
  if (status >= 500) {
    return { code: 'runtime_unavailable', message, retryable: true }
  }
  return { code: 'invalid_response', message, retryable: false }
}

function clientInputError(message: string): SiteForgeRuntimeV3ClientError {
  return new SiteForgeRuntimeV3ClientError({
    failure: {
      code: 'invalid_artifact',
      message,
      retryable: false,
    },
  })
}

function assertRemotePackageIdentity(
  actual: Pick<RuntimeV3PackageIdentity, 'archiveSha256' | 'manifestSha256'>,
  expected: Pick<RuntimeV3PackageIdentity, 'archiveSha256' | 'manifestSha256'>,
  endpoint: 'health' | 'state'
): void {
  if (
    actual.archiveSha256 !== expected.archiveSha256 ||
    actual.manifestSha256 !== expected.manifestSha256
  ) {
    throw new SiteForgeRuntimeV3ClientError({
      failure: {
        code: 'invalid_response',
        message: `SiteForge runtime v3 ${endpoint} package identity does not match the installed release`,
        retryable: false,
        stage: 'verification',
        details: {
          expectedArchiveSha256: expected.archiveSha256,
          actualArchiveSha256: actual.archiveSha256,
          expectedManifestSha256: expected.manifestSha256,
          actualManifestSha256: actual.manifestSha256,
        },
      },
    })
  }
}

function parseClientInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw clientInputError(message)
  return parsed.data
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('SiteForge runtime base URL must use HTTP or HTTPS')
  }
  return url.toString().replace(/\/$/, '')
}

function normalizeRuntimePath(value: string): string {
  const path = `/${value.trim().replace(/^\/+|\/+$/g, '')}`
  if (path.includes('?') || path.includes('#')) {
    throw new Error('SiteForge runtime path cannot include a query or fragment')
  }
  return path
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  return Object.fromEntries(new Headers(headers).entries())
}
