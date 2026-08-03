import { z } from 'zod'

const cloudwaysOperationSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  operation_id: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
  is_completed: z.union([z.string(), z.number(), z.boolean()]).optional(),
})

export class CloudwaysUnsupportedOperationError extends Error {
  constructor(readonly operation: 'promotion' | 'restore') {
    super(`Cloudways ${operation} API is unavailable; use the Cloudways dashboard and confirm manually`)
    this.name = 'CloudwaysUnsupportedOperationError'
  }
}

const cloudwaysApplicationSchema = z.object({
  id: z.union([z.string(), z.number()]),
  app_fqdn: z.string().min(1),
  app_user: z.string().min(1),
  app_password: z.string().min(1),
  server_id: z.union([z.string(), z.number()]).optional(),
  public_ip: z.string().optional(),
}).passthrough()

export interface CloudwaysProviderCredentials {
  email: string
  apiKey: string
}

export class CloudwaysProviderClient {
  private readonly baseUrl = 'https://api.cloudways.com/api/v2'
  private accessToken?: string

  constructor(private readonly credentials: CloudwaysProviderCredentials) {}

  async createApplicationBackup(applicationId: string): Promise<{
    operationId: string | null
    backupId: string | null
  }> {
    const result = cloudwaysOperationSchema
      .extend({
        backup_id: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .parse(
      await this.request(`/applications/${encodeURIComponent(applicationId)}/backup`, {
        method: 'POST',
      })
    )
    return {
      operationId:
        result.operation_id !== undefined
          ? String(result.operation_id)
          : result.id !== undefined
            ? String(result.id)
            : null,
      backupId:
        result.backup_id !== undefined ? String(result.backup_id) : null,
    }
  }

  async promoteStagingApplication(input: {
    serverId: string
    stagingApplicationId: string
    productionApplicationId: string
  }): Promise<{ operationId: string | null }> {
    try {
      const result = cloudwaysOperationSchema.passthrough().parse(
        await this.request('/app/pushtolive', {
          method: 'POST',
          body: {
            server_id: input.serverId,
            app_id: input.productionApplicationId,
            staging_app_id: input.stagingApplicationId,
          },
        })
      )
      return {
        operationId:
          result.operation_id !== undefined
            ? String(result.operation_id)
            : result.id !== undefined
              ? String(result.id)
              : null,
      }
    } catch (error) {
      if (isUnsupportedProviderError(error)) {
        throw new CloudwaysUnsupportedOperationError('promotion')
      }
      throw error
    }
  }

  async restoreApplicationBackup(input: {
    applicationId: string
    backupId: string
  }): Promise<{ operationId: string | null }> {
    try {
      const result = cloudwaysOperationSchema.passthrough().parse(
        await this.request(
          `/applications/${encodeURIComponent(input.applicationId)}/restore`,
          {
            method: 'POST',
            body: { backup_id: input.backupId },
          }
        )
      )
      return {
        operationId:
          result.operation_id !== undefined
            ? String(result.operation_id)
            : result.id !== undefined
              ? String(result.id)
              : null,
      }
    } catch (error) {
      if (isUnsupportedProviderError(error)) {
        throw new CloudwaysUnsupportedOperationError('restore')
      }
      throw error
    }
  }

  async createStagingApplication(input: {
    serverId: string
    parentApplicationId: string
    label: string
  }): Promise<{ operationId: string | null; applicationId: string | null }> {
    const response = z
      .object({
        operation_id: z.union([z.string(), z.number()]).optional(),
        id: z.union([z.string(), z.number()]).optional(),
        app_id: z.union([z.string(), z.number()]).optional(),
        application_id: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .parse(
        await this.request('/app/createstaging', {
          method: 'POST',
          body: {
            server_id: input.serverId,
            app_id: input.parentApplicationId,
            app_label: input.label.replace(/[^a-z0-9-]/gi, '-').slice(0, 48),
          },
        })
      )
    return {
      operationId:
        response.operation_id !== undefined
          ? String(response.operation_id)
          : response.id !== undefined
            ? String(response.id)
            : null,
      applicationId:
        response.application_id !== undefined
          ? String(response.application_id)
          : response.app_id !== undefined
            ? String(response.app_id)
            : null,
    }
  }

  async waitForOperation(operationId: string, timeoutMs = 30 * 60_000): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const operation = cloudwaysOperationSchema.passthrough().parse(
        await this.request(`/operation/${encodeURIComponent(operationId)}`, {
          method: 'GET',
        })
      )
      const status = operation.status?.toLowerCase()
      if (
        operation.is_completed === true ||
        operation.is_completed === 1 ||
        operation.is_completed === '1'
      ) {
        return
      }
      if (status && ['completed', 'complete', 'success', 'succeeded'].includes(status)) {
        return
      }
      if (status && ['failed', 'error', 'cancelled'].includes(status)) {
        throw new Error(`Cloudways operation ${operationId} ${status}`)
      }
      await new Promise(resolve => setTimeout(resolve, 5_000))
    }
    throw new Error(`Cloudways operation ${operationId} timed out`)
  }

  async getApplication(input: {
    serverId: string
    applicationId?: string | null
    parentApplicationId?: string
  }): Promise<z.infer<typeof cloudwaysApplicationSchema>> {
    const response = z
      .object({
        servers: z.array(
          z.object({
            id: z.union([z.string(), z.number()]),
            public_ip: z.string().optional(),
            apps: z.array(cloudwaysApplicationSchema).default([]),
          }).passthrough()
        ).default([]),
      })
      .passthrough()
      .parse(await this.request('/servers', { method: 'GET' }))
    const server = response.servers.find(candidate => String(candidate.id) === input.serverId)
    const application = server?.apps.find(candidate =>
      input.applicationId
        ? String(candidate.id) === input.applicationId
        : String(candidate.id) !== input.parentApplicationId
    )
    if (!server || !application) {
      throw new Error('Cloudways staging application was not found after provisioning')
    }
    return cloudwaysApplicationSchema.parse({
      ...application,
      server_id: server.id,
      public_ip: server.public_ip,
    })
  }

  async configureApplicationDomain(input: {
    applicationId: string
    domain: string
  }): Promise<void> {
    const domain = z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/)
      .parse(input.domain)
    const applicationId = encodeURIComponent(input.applicationId)
    await this.request(`/applications/${applicationId}/cname`, {
      method: 'PUT',
      body: { new_cname: domain },
    })
    await this.request(
      `/security/ssl/lets-encrypt/install?domain=${encodeURIComponent(domain)}`,
      {
        method: 'POST',
        body: { application_id: input.applicationId },
      }
    )
    await this.request(`/applications/${applicationId}/enforce-https`, {
      method: 'POST',
    })
  }

  async verifyDns(domain: string): Promise<unknown> {
    return this.request('/security/dns/verify', {
      method: 'POST',
      body: { domain },
    })
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken) return this.accessToken
    if (this.credentials.apiKey.startsWith('cw_')) {
      this.accessToken = this.credentials.apiKey
      return this.accessToken
    }

    const response = await fetch(`${this.baseUrl}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: this.credentials.email,
        api_key: this.credentials.apiKey,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const payload = (await response.json()) as { access_token?: string; message?: string }
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Cloudways authentication failed (${response.status}): ${
          payload.message || 'missing access token'
        }`
      )
    }
    this.accessToken = payload.access_token
    return payload.access_token
  }

  private async request(
    endpoint: string,
    init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }
  ): Promise<unknown> {
    const accessToken = await this.authenticate()
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    })
    const text = await response.text()
    let payload: unknown = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { message: text }
    }
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === 'object' &&
        'message' in payload
          ? String(payload.message)
          : 'Unknown Cloudways error'
      throw new Error(
        `Cloudways API ${init.method} ${endpoint} failed (${response.status}): ${message}`
      )
    }
    if (
      payload &&
      typeof payload === 'object' &&
      'data' in payload &&
      (payload as Record<string, unknown>).data !== undefined
    ) {
      return (payload as Record<string, unknown>).data
    }
    return payload
  }
}

function isUnsupportedProviderError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /failed \((?:404|405|501)\):/.test(error.message)
  )
}
