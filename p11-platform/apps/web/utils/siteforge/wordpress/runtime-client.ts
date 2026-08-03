import { z } from 'zod'
import {
  SITEFORGE_RUNTIME_CONTRACT_VERSION,
  assetPreparationRequestSchema,
  assetPreparationResultSchema,
  deploymentStatusSchema,
  deploymentSubmissionSchema,
  runtimeCapabilitiesSchema,
  runtimeErrorResponseSchema,
  runtimeFailureSchema,
  runtimeHealthSchema,
  runtimeStateSchema,
  type AssetPreparationRequest,
  type AssetPreparationResult,
  type DeploymentStatus,
  type DeploymentSubmission,
  type RuntimeCapabilities,
  type RuntimeFailure,
  type RuntimeHealth,
  type RuntimeState,
} from '@/utils/siteforge/runtime-contract'

export interface SiteForgeRuntimeClientOptions {
  baseUrl: string
  username: string
  applicationPassword: string | (() => string | Promise<string>)
  fetch?: typeof fetch
  timeoutMs?: number
  runtimePath?: string
}

export class SiteForgeRuntimeClientError extends Error {
  readonly failure: RuntimeFailure
  readonly status: number | null
  readonly requestId: string | null

  constructor(input: {
    failure: RuntimeFailure
    status?: number | null
    requestId?: string | null
    cause?: unknown
  }) {
    super(input.failure.message, { cause: input.cause })
    this.name = 'SiteForgeRuntimeClientError'
    this.failure = runtimeFailureSchema.parse(input.failure)
    this.status = input.status ?? null
    this.requestId = input.requestId ?? null
  }
}

export class SiteForgeRuntimeClient {
  private readonly baseUrl: string
  private readonly username: string
  private readonly applicationPassword: SiteForgeRuntimeClientOptions['applicationPassword']
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly runtimePath: string

  constructor(options: SiteForgeRuntimeClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.username = options.username.trim()
    this.applicationPassword = options.applicationPassword
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.runtimePath = normalizeRuntimePath(
      options.runtimePath ?? '/wp-json/siteforge/v2'
    )
    if (!this.username) {
      throw new Error('WordPress Application Password username is required')
    }
  }

  async getHealth(): Promise<RuntimeHealth> {
    return this.request('/health', { method: 'GET' }, runtimeHealthSchema)
  }

  async getCapabilities(): Promise<RuntimeCapabilities> {
    return this.request(
      '/capabilities',
      { method: 'GET' },
      runtimeCapabilitiesSchema
    )
  }

  async getState(siteId: string): Promise<RuntimeState> {
    if (!siteId.trim()) {
      throw clientInputError('A non-empty SiteForge runtime site id is required')
    }
    const query = new URLSearchParams({ siteId })
    return this.request(
      `/state?${query.toString()}`,
      { method: 'GET' },
      runtimeStateSchema
    )
  }

  async prepareAssets(
    request: AssetPreparationRequest
  ): Promise<AssetPreparationResult> {
    const payload = assetPreparationRequestSchema.parse(request)
    return this.request(
      '/assets/prepare',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payload.idempotencyKey,
          'X-SiteForge-Artifact-Id': payload.artifactId,
          'X-SiteForge-Artifact-Content-Hash':
            payload.artifactContentHash,
        },
        body: JSON.stringify(payload),
      },
      assetPreparationResultSchema
    )
  }

  async submitDeployment(
    request: DeploymentSubmission
  ): Promise<DeploymentStatus> {
    const payload = deploymentSubmissionSchema.parse(request)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Idempotency-Key': payload.idempotencyKey,
      'X-SiteForge-Artifact-Id': payload.artifactId,
      'X-SiteForge-Artifact-Content-Hash': payload.artifactContentHash,
      'X-SiteForge-Operation-Hash': payload.operationHash,
    }
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
      deploymentStatusSchema
    )
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    if (!deploymentId.trim()) {
      throw clientInputError(
        'A non-empty SiteForge runtime deployment id is required'
      )
    }
    return this.request(
      `/deployments/${encodeURIComponent(deploymentId)}`,
      { method: 'GET' },
      deploymentStatusSchema
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
          'X-SiteForge-Contract-Version':
            String(SITEFORGE_RUNTIME_CONTRACT_VERSION),
          ...headersToRecord(init.headers),
        },
        signal: controller.signal,
      })
      const requestId = response.headers.get('x-request-id')
      const body = await parseResponseBody(response)

      if (!response.ok) {
        const parsedError = runtimeErrorResponseSchema.safeParse(body)
        if (parsedError.success) {
          throw new SiteForgeRuntimeClientError({
            failure: parsedError.data.error,
            status: response.status,
            requestId: parsedError.data.requestId ?? requestId,
          })
        }
        throw new SiteForgeRuntimeClientError({
          failure: fallbackHttpFailure(response.status, body),
          status: response.status,
          requestId,
        })
      }

      const parsed = responseSchema.safeParse(body)
      if (!parsed.success) {
        throw new SiteForgeRuntimeClientError({
          failure: {
            code: 'invalid_response',
            message: `SiteForge runtime returned an invalid response for ${path}`,
            retryable: false,
            details: {
              issues: parsed.error.issues,
            },
          },
          status: response.status,
          requestId,
        })
      }
      return parsed.data
    } catch (error) {
      if (error instanceof SiteForgeRuntimeClientError) {
        throw error
      }
      const timedOut = error instanceof Error && error.name === 'AbortError'
      throw new SiteForgeRuntimeClientError({
        failure: {
          code: 'runtime_unavailable',
          message: timedOut
            ? `SiteForge runtime request timed out after ${this.timeoutMs}ms`
            : `SiteForge runtime request failed: ${
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
      throw new SiteForgeRuntimeClientError({
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

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function fallbackHttpFailure(status: number, body: unknown): RuntimeFailure {
  const message =
    body &&
    typeof body === 'object' &&
    'message' in body &&
    typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : typeof body === 'string' && body.trim()
        ? body
        : `SiteForge runtime request failed with HTTP ${status}`

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

function clientInputError(message: string): SiteForgeRuntimeClientError {
  return new SiteForgeRuntimeClientError({
    failure: {
      code: 'invalid_artifact',
      message,
      retryable: false,
    },
  })
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
