// SiteForge: WordPress Client
// Handles WordPress REST API, WP-CLI, and Cloudways API interactions
// Created: December 11, 2025

import type {
  SiteArchitecture,
  GeneratedPage,
  SiteConfiguration,
  WebsiteAsset,
} from '@/types/siteforge'
import { SshWordPressInstaller } from '@/utils/siteforge/wordpress/wordpress-installer'
import { SiteForgeRuntimeV3Client } from '@/utils/siteforge/wordpress/runtime-client-v3'
import type { VerifiedRuntimeV3PackageIdentity } from '@/utils/siteforge/artifacts/release'

export interface CloudwaysCredentials {
  apiKey: string
  email: string
}

interface CloudwaysOperation {
  id?: string | number
  is_completed?: string | number
  message?: string
}

interface CloudwaysAppVersion {
  application?: string
  app_version?: string
}

interface CloudwaysAppsResponse {
  apps?: Record<string, { versions?: CloudwaysAppVersion[] }>
}

interface CloudwaysAppRecord {
  id?: string | number
  label?: string
  application?: string
  app_version?: string
  app_fqdn?: string
  cname?: string
  aliases?: string[]
  sys_user?: string
  app_user?: string
  app_password?: string
}

interface CloudwaysServerRecord {
  id?: string | number
  label?: string
  server_fqdn?: string
  public_ip?: string
  master_user?: string
  master_password?: string
  apps?: CloudwaysAppRecord[]
  operations?: CloudwaysOperation[]
}

interface CloudwaysServerListResponse {
  servers?: CloudwaysServerRecord[]
}

interface CloudwaysCreateServerResponse {
  server?: CloudwaysServerRecord
  operation_id?: string | number
}

export interface WordPressInstance {
  instanceId: string
  url: string
  adminUrl: string
  credentials: {
    username: string
    password: string
  }
  ssh?: {
    host: string
    port: number
    username: string
    password?: string
    privateKey?: string
    applicationRoot?: string
    sftpApplicationRoot?: string
  }
  providerMetadata?: {
    provider: 'cloudways'
    serverId: string
    applicationId: string
    publicIp: string
  }
}

interface WordPressApiRootResponse {
  namespaces?: unknown
}

export type DeploymentProgressReporter = (step: string) => void | Promise<void>

export interface ExactSiteForgeRuntimeInstallation {
  runtimeContractVersion: 1 | 2 | 3
  themeArchive: Buffer
  runtimePluginArchive: Buffer
  runtimePluginIdentity?: VerifiedRuntimeV3PackageIdentity
  siteId?: string
}

/**
 * Cloudways API Client
 */
export class CloudwaysClient {
  private apiKey: string
  private email: string
  private baseUrl = 'https://api.cloudways.com/api/v2'
  private progressReporter?: DeploymentProgressReporter
  
  constructor(
    credentials: CloudwaysCredentials,
    options?: { onProgress?: DeploymentProgressReporter }
  ) {
    this.apiKey = credentials.apiKey
    this.email = credentials.email
    this.progressReporter = options?.onProgress
  }

  async discoverWordPressInstance(
    wpUrl: string,
    credentials: WordPressInstance['credentials']
  ): Promise<WordPressInstance> {
    await this.reportProgress('Discovering existing Cloudways preview application...')
    const accessToken = await this.getAccessToken()
    const response = await this.request<CloudwaysServerListResponse>({
      method: 'GET',
      endpoint: '/servers',
      accessToken,
      errorLabel: 'Cloudways preview application lookup failed',
    })
    const targetHost = new URL(normalizeSiteUrl(wpUrl)).hostname.toLowerCase()
    for (const serverSummary of response.servers || []) {
      const server = serverSummary.id
        ? await this.request<CloudwaysServerRecord>({
            method: 'GET',
            endpoint: `/servers/${encodeURIComponent(String(serverSummary.id))}`,
            accessToken,
            errorLabel: 'Cloudways preview server lookup failed',
          })
        : serverSummary
      const candidates = [...(server.apps || [])].sort(
        (left, right) =>
          Number(
            targetHost.endsWith(`-${String(right.id)}.cloudwaysapps.com`)
          ) -
          Number(
            targetHost.endsWith(`-${String(left.id)}.cloudwaysapps.com`)
          )
      )
      let app: CloudwaysAppRecord | undefined
      for (const candidate of candidates) {
        const detailed = candidate.id
          ? await this.request<CloudwaysAppRecord & { app?: CloudwaysAppRecord }>({
              method: 'GET',
              endpoint: `/apps/${encodeURIComponent(String(candidate.id))}`,
              accessToken,
              errorLabel: 'Cloudways preview application lookup failed',
            })
          : {}
        const resolved =
          detailed.app || ('id' in detailed && detailed.id ? detailed : candidate)
        const hosts = [
          resolved.app_fqdn,
          resolved.cname,
          ...(resolved.aliases || []),
        ]
          .filter((value): value is string => Boolean(value))
          .map(value => new URL(normalizeSiteUrl(value)).hostname.toLowerCase())
        if (hosts.includes(targetHost)) {
          app = resolved
          break
        }
      }
      if (!app?.app_user || !app.app_password) continue
      const url = normalizeSiteUrl(app.app_fqdn || wpUrl)
      const privateKey = process.env.SITEFORGE_CLOUDWAYS_SSH_PRIVATE_KEY?.replace(
        /\\n/g,
        '\n'
      )
      return {
        instanceId: String(server.id || 'cloudways'),
        url,
        adminUrl: `${url}/wp-admin`,
        credentials,
        ssh: {
          host: server.public_ip || server.server_fqdn || targetHost,
          port: 22,
          username: server.master_user || app.app_user,
          password: privateKey
            ? undefined
            : server.master_password || app.app_password,
          privateKey,
          applicationRoot:
            privateKey && server.master_user && app.sys_user
              ? `/home/master/applications/${app.sys_user}/public_html`
              : 'public_html',
          sftpApplicationRoot:
            privateKey && server.master_user && app.sys_user
              ? `/applications/${app.sys_user}/public_html`
              : 'public_html',
        },
        providerMetadata: {
          provider: 'cloudways',
          serverId: String(server.id || ''),
          applicationId: String(app.id || ''),
          publicIp: server.public_ip || server.server_fqdn || targetHost,
        },
      }
    }
    throw new Error(`Cloudways application was not found for ${targetHost}`)
  }
  
  /**
   * Create a new WordPress instance
   */
  async createWordPressInstance(propertyName: string): Promise<WordPressInstance> {
    await this.reportProgress('Authenticating with Cloudways API...')
    const accessToken = await this.getAccessToken()
    await this.reportProgress('Fetching Cloudways WordPress app versions...')
    const appSpec = await this.getWordPressAppSpec(accessToken)
    const serverLabel = buildCloudwaysServerLabel(propertyName)
    const appLabel = buildCloudwaysAppLabel(propertyName)

    await this.reportProgress('Provisioning Cloudways server and WordPress app...')
    const createResponse = await this.request<CloudwaysCreateServerResponse>({
      method: 'POST',
      endpoint: '/servers',
      accessToken,
      form: {
        cloud: process.env.CLOUDWAYS_CLOUD || 'do',
        region: process.env.CLOUDWAYS_REGION || 'nyc3',
        instance_type: process.env.CLOUDWAYS_INSTANCE_TYPE || '1GB',
        application: appSpec.application,
        app_version: appSpec.appVersion,
        server_label: serverLabel,
        app_label: appLabel,
      },
      errorLabel: 'Cloudways server creation failed',
    })

    const operationId =
      createResponse.operation_id ??
      createResponse.server?.operations?.[0]?.id

    if (!operationId) {
      throw new Error('Cloudways did not return an operation id for server creation')
    }

    await this.reportProgress(`Waiting for Cloudways operation ${String(operationId)} to complete...`)
    await this.pollOperation(accessToken, String(operationId))

    await this.reportProgress('Discovering provisioned Cloudways server details...')
    const createdServer = await this.waitForServer(accessToken, {
      serverId: createResponse.server?.id,
      serverLabel,
      appLabel,
    })

    const app = selectCloudwaysApp(createdServer, appLabel)
    if (!app) {
      throw new Error(`Cloudways did not return an application for ${serverLabel}`)
    }

    const username = app.app_user || 'admin'
    let password = app.app_password

    if (!password && createdServer.id && app.id) {
      password = generateSecurePassword()
      await this.reportProgress('Rotating Cloudways WordPress admin password...')
      await this.updateWordPressAdminPassword(
        accessToken,
        String(createdServer.id),
        String(app.id),
        password
      )
    }

    if (!password) {
      throw new Error(
        'Cloudways did not return WordPress application credentials after provisioning'
      )
    }

    const fqdn = app.app_fqdn || createdServer.server_fqdn
    if (!fqdn) {
      throw new Error('Cloudways did not return a WordPress application URL')
    }

    const url = normalizeSiteUrl(fqdn)
    await this.reportProgress('Cloudways provisioning complete.')
    return {
      instanceId: String(createdServer.id ?? createResponse.server?.id ?? 'cloudways'),
      url,
      adminUrl: `${url}/wp-admin`,
      credentials: {
        username,
        password,
      },
      ssh: {
        host: createdServer.public_ip || createdServer.server_fqdn || fqdn,
        port: 22,
        username,
        password,
        applicationRoot: 'public_html',
      },
      providerMetadata: {
        provider: 'cloudways',
        serverId: String(createdServer.id ?? createResponse.server?.id ?? ''),
        applicationId: String(app.id ?? ''),
        publicIp: createdServer.public_ip || createdServer.server_fqdn || fqdn,
      },
    }
  }
  
  /**
   * Deploy theme and plugin prerequisites to WordPress instance.
   * Cloudways does not expose first-party theme/plugin install APIs, so we
   * enforce deployment readiness by waiting for wp-json + required namespaces.
   */
  async deployThemeAndPlugins(
    instance: WordPressInstance,
    exactRelease?: ExactSiteForgeRuntimeInstallation
  ): Promise<void> {
    if (!instance.ssh) {
      throw new Error('Cloudways did not return application SSH credentials')
    }
    const acfProLicenseKey = process.env.SITEFORGE_ACF_PRO_LICENSE_KEY
    if (!acfProLicenseKey) {
      throw new Error(
        'SITEFORGE_ACF_PRO_LICENSE_KEY is required for clean WordPress installation'
      )
    }
    await new SshWordPressInstaller().ensureInstalled({
      ssh: instance.ssh,
      runtimeContractVersion: exactRelease?.runtimeContractVersion,
      themeArchive: exactRelease?.themeArchive,
      runtimePluginArchive: exactRelease?.runtimePluginArchive,
      runtimePluginIdentity: exactRelease?.runtimePluginIdentity,
      acfProLicenseKey,
      onProgress: this.progressReporter,
    })
    await this.reportProgress('Waiting for WordPress API readiness...')
    const wpClient = new WordPressAPIClient(instance.url, instance.credentials)
    await wpClient.verifyReadiness({
      timeoutMs: Number(process.env.SITEFORGE_WP_READY_TIMEOUT_MS || 300000),
      pollIntervalMs: Number(process.env.SITEFORGE_WP_READY_POLL_MS || 5000),
      requireNamespaces: getRequiredWordPressNamespaces(),
    })
    if (exactRelease?.runtimeContractVersion === 3) {
      if (!exactRelease.runtimePluginIdentity) {
        throw new Error(
          'SiteForge runtime v3 installation is missing its verified package identity'
        )
      }
      await this.reportProgress(
        'Verifying exact SiteForge runtime v3 archive and manifest identity...'
      )
      await new SiteForgeRuntimeV3Client({
        baseUrl: instance.url,
        username: instance.credentials.username,
        applicationPassword: instance.credentials.password,
      }).verifyInstalledPackageIdentity(
        exactRelease.runtimePluginIdentity,
        exactRelease.siteId
      )
    }
  }

  async deployThemeOverlay(
    instance: WordPressInstance,
    archive: Buffer,
    contentHash: string
  ): Promise<string> {
    if (!instance.ssh) {
      throw new Error('Cloudways did not return application SSH credentials')
    }
    return new SshWordPressInstaller().installThemeOverlay({
      ssh: instance.ssh,
      archive,
      contentHash,
      onProgress: this.progressReporter,
    })
  }
  
  private async getAccessToken(): Promise<string> {
    if (this.apiKey.startsWith('cw_')) {
      return this.apiKey
    }

    const response = await this.request<{ access_token?: string }>({
      method: 'POST',
      endpoint: '/oauth/access_token',
      form: {
        email: this.email,
        api_key: this.apiKey,
      },
      errorLabel: 'Cloudways OAuth failed',
    })

    if (!response.access_token) {
      throw new Error('Cloudways OAuth response did not include an access token')
    }

    return response.access_token
  }

  private async getWordPressAppSpec(accessToken: string): Promise<{
    application: string
    appVersion: string
  }> {
    const preferredApplication = process.env.CLOUDWAYS_APPLICATION || 'wordpress'
    const preferredVersion = process.env.CLOUDWAYS_APP_VERSION
    const response = await this.request<CloudwaysAppsResponse>({
      method: 'GET',
      endpoint: '/apps',
      accessToken,
      errorLabel: 'Cloudways app list lookup failed',
    })

    const versions = Object.values(response.apps || {})
      .flatMap(app => app.versions || [])
      .filter(
        version =>
          typeof version.application === 'string' &&
          typeof version.app_version === 'string' &&
          version.application.toLowerCase().includes('wordpress')
      )

    const exactMatch =
      versions.find(
        version =>
          version.application === preferredApplication &&
          (!preferredVersion || version.app_version === preferredVersion)
      ) ||
      versions.find(version => version.application === preferredApplication) ||
      versions.find(version => version.application === 'wordpress') ||
      versions[0]

    if (!exactMatch?.application || !exactMatch.app_version) {
      throw new Error('Cloudways did not return an installable WordPress application version')
    }

    return {
      application: exactMatch.application,
      appVersion: preferredVersion || exactMatch.app_version,
    }
  }

  private async pollOperation(accessToken: string, operationId: string): Promise<void> {
    const maxAttempts = Number(process.env.CLOUDWAYS_OPERATION_POLL_ATTEMPTS || 60)
    const intervalMs = Number(process.env.CLOUDWAYS_OPERATION_POLL_MS || 30000)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.request<{ operation?: CloudwaysOperation }>({
        method: 'GET',
        endpoint: `/operations/${operationId}/status`,
        accessToken,
        errorLabel: `Cloudways operation ${operationId} lookup failed`,
      })

      const operation = response.operation
      if (!operation) {
        throw new Error(`Cloudways operation ${operationId} response was empty`)
      }

      if (String(operation.is_completed) === '1') {
        return
      }

      if (attempt % 3 === 0) {
        await this.reportProgress(
          `Cloudways operation ${operationId} in progress (${attempt + 1}/${maxAttempts})...`
        )
      }
      await sleep(intervalMs)
    }

    throw new Error(`Timed out waiting for Cloudways operation ${operationId}`)
  }

  private async waitForServer(
    accessToken: string,
    lookup: { serverId?: string | number; serverLabel: string; appLabel: string }
  ): Promise<CloudwaysServerRecord> {
    const maxAttempts = Number(process.env.CLOUDWAYS_SERVER_DISCOVERY_ATTEMPTS || 20)
    const intervalMs = Number(process.env.CLOUDWAYS_SERVER_DISCOVERY_POLL_MS || 15000)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.request<CloudwaysServerListResponse>({
        method: 'GET',
        endpoint: '/servers',
        accessToken,
        errorLabel: 'Cloudways server lookup failed',
      })

      const server = selectCloudwaysServer(response.servers || [], lookup)
      if (server) {
        return server
      }

      await sleep(intervalMs)
    }

    throw new Error(`Unable to locate provisioned Cloudways server for ${lookup.serverLabel}`)
  }

  private async updateWordPressAdminPassword(
    accessToken: string,
    _serverId: string,
    appId: string,
    password: string
  ): Promise<void> {
    await this.request({
      method: 'PUT',
      endpoint: `/applications/${encodeURIComponent(appId)}/admin-password`,
      accessToken,
      form: {
        new_password: password,
      },
      errorLabel: 'Cloudways WordPress admin password update failed',
    })
  }

  private async request<T = Record<string, unknown>>(args: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    endpoint: string
    accessToken?: string
    query?: Record<string, string | number | boolean | undefined>
    form?: Record<string, string | number | boolean | undefined>
    errorLabel: string
  }): Promise<T> {
    const url = new URL(`${this.baseUrl}${args.endpoint}`)
    for (const [key, value] of Object.entries(args.query || {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = {}
    let body: string | undefined
    if (args.form && Object.keys(args.form).length > 0) {
      const formBody = new URLSearchParams()
      for (const [key, value] of Object.entries(args.form)) {
        if (value !== undefined) {
          formBody.set(key, String(value))
        }
      }
      body = formBody.toString()
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    if (args.accessToken) {
      headers.Authorization = `Bearer ${args.accessToken}`
    }

    const response = await fetchWithTimeout(url.toString(), {
      method: args.method,
      headers,
      body,
    }, getCloudwaysRequestTimeoutMs(), `Cloudways API ${args.method} ${args.endpoint}`)

    const text = await response.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // ignore
    }

    if (!response.ok) {
      const message =
        json && typeof json === 'object' && 'message' in json
          ? String((json as Record<string, unknown>).message)
          : text || 'Unknown error'
      throw new Error(`${args.errorLabel} (${response.status}): ${message}`)
    }

    if (
      json &&
      typeof json === 'object' &&
      'data' in json &&
      (json as Record<string, unknown>).data !== undefined
    ) {
      return (json as { data: T }).data
    }

    return (json as T) ?? ({} as T)
  }

  private async reportProgress(step: string): Promise<void> {
    if (!this.progressReporter) {
      return
    }
    await this.progressReporter(step)
  }
}

/**
 * WordPress REST API Client
 */
export class WordPressAPIClient {
  private baseUrl: string
  private siteUrl: string
  private credentials: {
    username: string
    password: string
  }
  private progressReporter?: DeploymentProgressReporter
  
  constructor(
    wpUrl: string,
    credentials: { username: string; password: string },
    options?: { onProgress?: DeploymentProgressReporter }
  ) {
    this.siteUrl = normalizeSiteUrl(wpUrl)
    this.baseUrl = `${this.siteUrl}/wp-json/wp/v2`
    this.credentials = credentials
    this.progressReporter = options?.onProgress
  }

  async verifyReadiness(options?: {
    timeoutMs?: number
    pollIntervalMs?: number
    requireNamespaces?: string[]
  }): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? 300000
    const pollIntervalMs = options?.pollIntervalMs ?? 5000
    const requireNamespaces = options?.requireNamespaces || ['wp/v2']
    const deadline = Date.now() + timeoutMs
    let lastError: string | null = null

    while (Date.now() < deadline) {
      try {
        const apiRoot = await this.getApiRoot()
        const namespaces = normalizeNamespaceList(apiRoot.namespaces)
        assertNamespacesAvailable(namespaces, requireNamespaces)
        await this.get('/users/me')
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (this.progressReporter) {
          await this.progressReporter(
            `Waiting for WordPress API readiness... ${Math.max(
              Math.ceil((deadline - Date.now()) / Math.max(pollIntervalMs, 1)),
              0
            )} checks remaining`
          )
        }
        await sleep(pollIntervalMs)
      }
    }

    throw new Error(
      `WordPress instance did not become ready within ${timeoutMs}ms` +
        (lastError ? ` (last error: ${lastError})` : '')
    )
  }

  async applySiteForgeSettings(input: {
    themeArtifact: {
      contentHash: string
      designTokens: unknown
      componentVariants: unknown
      siteConfiguration: unknown
      motion: unknown
      themeOverlay: unknown
    }
    legal: unknown
    analytics: unknown
    propertyProfile?: {
      name: string
      address: string
      phone: string
      email: string
      socialLinks: Record<string, string>
    }
    publicRuntime?: {
      enabled: boolean
      apiKey: string
      apiBaseUrl: string
      websiteId: string
      conversionEndpoint: string
      conversionKey: string
      telemetryEndpoint: string
    }
    targetMode?: 'canonical_preview' | 'staging'
  }): Promise<void> {
    const endpoint = `${this.siteUrl}/wp-json/siteforge/v1/settings`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.credentials.username}:${this.credentials.password}`
        ).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content_hash: input.themeArtifact.contentHash,
        design_tokens: input.themeArtifact.designTokens,
        component_variants: input.themeArtifact.componentVariants,
        site_configuration: input.themeArtifact.siteConfiguration,
        motion: input.themeArtifact.motion,
        theme_overlay: input.themeArtifact.themeOverlay,
        legal: input.legal,
        analytics: input.analytics,
        property_profile: input.propertyProfile,
        lumaleasing: input.publicRuntime,
        target_mode: input.targetMode || 'staging',
      }),
    })
    if (!response.ok) {
      throw new Error(
        `Failed to apply SiteForge design tokens: ${response.status} ${await response.text()}`
      )
    }
  }

  async applyContentManifest(
    contentHash: string,
    pageIds: number[]
  ): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new Error('A valid artifact hash is required for content reconciliation')
    }
    await this.request(
      '/siteforge/v1/content-manifest',
      {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content_hash: contentHash,
          page_ids: pageIds,
        }),
      },
      'Failed to apply SiteForge content manifest'
    )
  }

  async getContentManifest(): Promise<{
    content_hash: string | null
    page_ids: number[]
    updated_at?: string
  }> {
    const response = await this.request(
      '/siteforge/v1/content-manifest',
      {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
        },
      },
      'Failed to load SiteForge content manifest'
    )
    const record =
      response && typeof response === 'object' && !Array.isArray(response)
        ? response
        : {}
    return {
      content_hash:
        typeof record.content_hash === 'string' ? record.content_hash : null,
      page_ids: Array.isArray(record.page_ids)
        ? record.page_ids.filter(
            (id): id is number => typeof id === 'number' && id > 0
          )
        : [],
      updated_at:
        typeof record.updated_at === 'string' ? record.updated_at : undefined,
    }
  }

  async activateProduction(contentHash: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new Error('A valid artifact hash is required for production activation')
    }
    const response = await this.request<{
      activated?: boolean
      content_hash?: string
      blog_public?: string
    }>(
      '/siteforge/v1/production-activation',
      {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content_hash: contentHash }),
      },
      'Failed to activate exact SiteForge production artifact'
    )
    if (
      response.activated !== true ||
      response.content_hash !== contentHash ||
      response.blog_public !== '1'
    ) {
      throw new Error('WordPress did not confirm production indexability')
    }
  }

  async verifyDeployment(args: {
    expectedPages: Array<Pick<GeneratedPage, 'slug'>>
    mediaIds: Map<string, number>
    siteName: string
  }): Promise<void> {
    const publishedPages = await this.get<unknown>('/pages?per_page=100&status=publish&_fields=id,slug,status')
    const pageRows = Array.isArray(publishedPages) ? publishedPages : []
    const publishedSlugs = new Set(
      pageRows
        .map(page => {
          if (!page || typeof page !== 'object') {
            return null
          }
          const slug = (page as Record<string, unknown>).slug
          return typeof slug === 'string' ? normalizePageSlug(slug) : null
        })
        .filter((slug): slug is string => Boolean(slug))
    )

    const missingPages = args.expectedPages
      .map(page => normalizePageSlug(page.slug))
      .filter(slug => !publishedSlugs.has(slug))

    if (missingPages.length > 0) {
      throw new Error(
        `Deployment verification failed: missing published pages for slugs: ${missingPages.join(', ')}`
      )
    }

    const mediaIdValues = Array.from(
      new Set(
        Array.from(args.mediaIds.values()).filter(
          mediaId => Number.isInteger(mediaId) && mediaId > 0
        )
      )
    )
    for (const mediaId of mediaIdValues) {
      await this.get(`/media/${mediaId}`)
    }

    const settings = await this.get<Record<string, unknown>>('/settings')
    const configuredSiteName =
      typeof settings.title === 'string' ? settings.title.trim() : ''
    const expectedSiteName = args.siteName.trim()
    if (configuredSiteName !== expectedSiteName) {
      throw new Error(
        `Deployment verification failed: expected site title "${expectedSiteName}" but found "${configuredSiteName}"`
      )
    }
  }
  
  /**
   * Create WordPress page with ACF blocks
   */
  async createPage(page: GeneratedPage, mediaIds: Map<string, number>): Promise<number> {
    const blocks = page.sections.map(section => 
      convertToGutenbergBlock(section, mediaIds)
    )
    
    const content = renderGutenbergBlocks(blocks)
    
    const existing = await this.get<
      Array<{ id?: number }>
    >(`/pages?context=edit&per_page=1&slug=${encodeURIComponent(page.slug)}`)
    const existingId =
      Array.isArray(existing) && typeof existing[0]?.id === 'number'
        ? existing[0].id
        : null
    const response = await this.post(existingId ? `/pages/${existingId}` : '/pages', {
      title: page.title,
      slug: page.slug,
      status: 'publish',
      content,
      // ACF blocks carry their data inside block attrs; meta mapping is optional
    })
    
    const id = typeof response.id === 'number' ? response.id : undefined
    if (!id) throw new Error('WordPress API did not return a page id')
    return id
  }

  /**
   * Upload SiteForge assets into the WordPress media library.
   */
  async uploadAssets(assets: WebsiteAsset[]): Promise<Map<string, number>> {
    const mediaIds = new Map<string, number>()

    for (const asset of assets) {
      const mediaTitle = `siteforge-${asset.id}`
      const existingMedia = await this.get<
        Array<{
          id?: number
          source_url?: string
          title?: { rendered?: string }
        }>
      >(`/media?context=edit&per_page=20&search=${encodeURIComponent(mediaTitle)}`)
      const matchedMedia = Array.isArray(existingMedia)
        ? existingMedia.find(
            (item) =>
              item.title?.rendered === mediaTitle &&
              typeof item.id === 'number'
          )
        : undefined
      if (typeof matchedMedia?.id === 'number') {
        mediaIds.set(asset.id, matchedMedia.id)
        mediaIds.set(`url:${normalizeAssetUrl(asset.fileUrl)}`, matchedMedia.id)
        if (asset.assetType === 'logo' && !mediaIds.has('logo')) {
          mediaIds.set('logo', matchedMedia.id)
        }
        if (matchedMedia.source_url) {
          mediaIds.set(
            `url:${normalizeAssetUrl(matchedMedia.source_url)}`,
            matchedMedia.id
          )
        }
        continue
      }
      const assetResponse = await fetchWithTimeout(
        asset.fileUrl,
        undefined,
        getAssetFetchTimeoutMs(),
        `Asset fetch ${asset.fileUrl}`
      )
      if (!assetResponse.ok) {
        throw new Error(
          `Failed to download asset ${asset.id} from ${asset.fileUrl} (${assetResponse.status})`
        )
      }

      const assetBuffer = await assetResponse.arrayBuffer()
      const contentType =
        asset.mimeType ||
        assetResponse.headers.get('content-type') ||
        'application/octet-stream'
      const filename = buildAssetFilename(asset, contentType)

      const mediaResponse = await this.postBinary('/media', assetBuffer, {
        contentType,
        filename,
      })

      const mediaId =
        typeof mediaResponse.id === 'number' ? mediaResponse.id : undefined
      if (!mediaId) {
        throw new Error(`WordPress media upload did not return an id for asset ${asset.id}`)
      }

      mediaIds.set(asset.id, mediaId)
      if (asset.assetType === 'logo' && !mediaIds.has('logo')) {
        mediaIds.set('logo', mediaId)
      }
      mediaIds.set(`url:${normalizeAssetUrl(asset.fileUrl)}`, mediaId)

      const metadataPayload: Record<string, unknown> = { title: mediaTitle }
      if (asset.altText) metadataPayload.alt_text = asset.altText
      if (asset.caption) metadataPayload.caption = asset.caption
      if (typeof mediaResponse.source_url === 'string') {
        mediaIds.set(`url:${normalizeAssetUrl(mediaResponse.source_url)}`, mediaId)
      }

      if (Object.keys(metadataPayload).length > 0) {
        await this.post(`/media/${mediaId}`, metadataPayload)
      }
    }

    return mediaIds
  }
  
  /**
   * Update WordPress site settings
   */
  async updateSiteSettings(settings: {
    siteName: string
    tagline: string
    logo?: number
    homepageId?: number
    primaryColor?: string
    secondaryColor?: string
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      title: settings.siteName,
      description: settings.tagline,
    }

    if (settings.logo) {
      payload.site_logo = settings.logo
    }
    if (settings.homepageId) {
      payload.show_on_front = 'page'
      payload.page_on_front = settings.homepageId
    }

    try {
      await this.post('/settings', payload)
    } catch (error) {
      if (settings.logo) {
        console.warn(
          'WordPress settings update rejected site_logo, retrying without logo'
        )
        delete payload.site_logo
        try {
          await this.post('/settings', payload)
          return
        } catch (retryError) {
          if (!settings.homepageId) throw retryError
        }
      }
      if (!settings.homepageId) throw error
      console.warn(
        'WordPress settings endpoint rejected homepage fields; keeping generated pages available by URL'
      )
      await this.post('/settings', {
        title: settings.siteName,
        description: settings.tagline,
      })
    }
  }
  
  /**
   * Create navigation menu.
   *
   * Primary path targets classic-theme menus (the oneclick-siteforge theme
   * registers a `primary` location via register_nav_menus): create a menu via
   * the core `/wp/v2/menus` endpoint (WP 5.9+), attach page items through
   * `/wp/v2/menu-items`, and assign the `primary` location. Falls back to the
   * block-theme `/navigation` endpoint only when classic menus are unavailable.
   */
  async createNavigation(
    architecture: SiteArchitecture,
    pageIdsBySlug?: Map<string, number>
  ): Promise<void> {
    const proposedNavigationItems =
      architecture.navigation?.items && architecture.navigation.items.length > 0
        ? architecture.navigation.items
        : architecture.pages.map(page => ({
            label: page.title,
            slug: page.slug,
            priority: 'medium' as const,
          }))
    const footerOnlySlugs = new Set(['privacy', 'terms', 'accessibility'])
    const navigationItems = proposedNavigationItems.filter(
      item => !footerOnlySlugs.has(normalizePageSlug(item.slug))
    )

    const knownSlugs = new Set(architecture.pages.map(page => normalizePageSlug(page.slug)))
    const missingSlugs = navigationItems
      .map(item => normalizePageSlug(item.slug))
      .filter(slug => !knownSlugs.has(slug))

    if (missingSlugs.length > 0) {
      throw new Error(
        `Navigation references missing page slugs: ${Array.from(new Set(missingSlugs)).join(', ')}`
      )
    }

    try {
      await this.createClassicMenu(navigationItems, pageIdsBySlug)
      return
    } catch (error) {
      if (!isMissingEndpointError(error)) {
        throw error
      }
      console.warn(
        'WordPress /menus endpoint is unavailable; attempting block-theme navigation'
      )
    }

    const menuMarkup = `<ul>${navigationItems
      .map(item => {
        const normalizedSlug = normalizePageSlug(item.slug)
        const href = normalizedSlug === 'home' ? '/' : `/${normalizedSlug}/`
        return `<li><a href="${escapeHtmlAttribute(href)}">${escapeHtml(item.label)}</a></li>`
      })
      .join('')}</ul>`

    try {
      await this.post('/navigation', {
        title: 'Primary Navigation',
        status: 'publish',
        content: menuMarkup,
      })
    } catch (error) {
      if (isMissingEndpointError(error)) {
        console.warn(
          'WordPress /navigation endpoint is unavailable; keeping default theme navigation'
        )
        return
      }
      throw error
    }
  }

  private async createClassicMenu(
    items: Array<{ label: string; slug: string }>,
    pageIdsBySlug?: Map<string, number>
  ): Promise<void> {
    const menuLocation = process.env.SITEFORGE_WP_MENU_LOCATION || 'primary'

    const menuResponse = await this.post('/menus', {
      name: 'Primary Navigation',
      locations: [menuLocation],
    })
    const menuId = typeof menuResponse.id === 'number' ? menuResponse.id : undefined
    if (!menuId) {
      throw new Error('WordPress API did not return a menu id')
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const normalizedSlug = normalizePageSlug(item.slug)
      const pageId = pageIdsBySlug?.get(normalizedSlug)

      const payload: Record<string, unknown> = {
        title: item.label,
        menus: menuId,
        menu_order: i + 1,
        status: 'publish',
      }

      if (pageId) {
        payload.type = 'post_type'
        payload.object = 'page'
        payload.object_id = pageId
      } else {
        payload.type = 'custom'
        payload.url = normalizedSlug === 'home' ? '/' : `/${normalizedSlug}/`
      }

      await this.post('/menu-items', payload)
    }
  }
  
  /**
   * Configure Yoast SEO
   */
  async configureYoastSEO(
    property: { name: string; tagline?: string },
    pages: Array<{ id: number; title: string; purpose: string }>
  ): Promise<void> {
    const apiRoot = await this.getApiRoot()
    const namespaces = normalizeNamespaceList(apiRoot.namespaces)
    if (!namespaces.includes('yoast/v1')) {
      console.warn('Yoast namespace not available; skipping per-page SEO metadata')
      return
    }

    for (const page of pages) {
      const title = truncateMetaTitle(`${page.title} | ${property.name}`)
      const description = truncateMetaDescription(
        page.purpose || property.tagline || `Explore ${property.name}`
      )

      try {
        await this.post(`/pages/${page.id}`, {
          meta: {
            _yoast_wpseo_title: title,
            _yoast_wpseo_metadesc: description,
          },
        })
      } catch (error) {
        if (isYoastMetaUnsupportedError(error)) {
          console.warn(
            'Yoast metadata keys are unavailable in WordPress API; skipping per-page SEO metadata'
          )
          return
        }
        throw error
      }
    }
  }
  
  private getAuthHeader(): string {
    return `Basic ${Buffer.from(
      `${this.credentials.username}:${this.credentials.password}`
    ).toString('base64')}`
  }

  private async request<T = Record<string, unknown>>(
    endpoint: string,
    init: RequestInit,
    errorLabel: string
  ): Promise<T> {
    const url = endpoint.startsWith('/siteforge/')
      ? `${this.siteUrl}/wp-json${endpoint}`
      : `${this.baseUrl}${endpoint}`
    const res = await fetchWithTimeout(
      url,
      init,
      getWordPressRequestTimeoutMs(),
      `WordPress API request ${endpoint}`
    )

    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // ignore
    }

    if (!res.ok) {
      const message =
        json && typeof json === 'object' && 'message' in json
          ? String((json as Record<string, unknown>).message)
          : text || 'Unknown error'
      throw new Error(`${errorLabel} (${res.status}): ${message}`)
    }

    return (json === null ? ({} as T) : (json as T))
  }

  private async get<T = Record<string, unknown>>(endpoint: string): Promise<T> {
    return this.request<T>(
      endpoint,
      {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
        },
      },
      `WordPress API GET ${endpoint} failed`
    )
  }

  private async post(endpoint: string, data: unknown): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(data),
      },
      `WordPress API POST ${endpoint} failed`
    )
  }

  private async postBinary(
    endpoint: string,
    body: ArrayBuffer,
    options: { contentType: string; filename: string }
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': options.contentType,
          'Content-Disposition': `attachment; filename="${options.filename}"`,
          Authorization: this.getAuthHeader(),
        },
        body,
      },
      `WordPress media upload ${endpoint} failed`
    )
  }

  private async getApiRoot(): Promise<WordPressApiRootResponse> {
    const response = await fetchWithTimeout(`${this.siteUrl}/wp-json`, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader(),
      },
    }, getWordPressRequestTimeoutMs(), 'WordPress API request /wp-json')

    const text = await response.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // ignore JSON parse failures
    }

    if (!response.ok) {
      const message =
        json && typeof json === 'object' && 'message' in json
          ? String((json as Record<string, unknown>).message)
          : text || 'Unknown error'
      throw new Error(`WordPress API GET /wp-json failed (${response.status}): ${message}`)
    }

    return (json && typeof json === 'object'
      ? (json as WordPressApiRootResponse)
      : {}) as WordPressApiRootResponse
  }
}

/**
 * Convert section to Gutenberg block format
 */
type GutenbergBlock = {
  blockName: string
  attrs?: Record<string, unknown>
}

function convertToGutenbergBlock(
  section: {
    id?: string
    acfBlock: string
    content: Record<string, unknown>
    order?: number
    variant?: string
  },
  mediaIds: Map<string, number>
): GutenbergBlock {
  // ACF blocks hydrate from $block['attrs']['data'] using registered field
  // definitions. Two requirements for that to work:
  //   1. attrs must carry ACF's `id`/`name`/`data`/`mode` shape
  //   2. repeater rows must be flattened to ACF's indexed key format
  //      (slides_0_headline, slides = row count) — nested arrays never hydrate
  const withMediaIds = injectWordPressMediaIds(
    section.variant
      ? { ...section.content, variant: section.variant }
      : section.content,
    mediaIds
  )
  const data = flattenAcfRepeaterFields(
    applyBlockFieldAliases(
      section.acfBlock,
      (withMediaIds && typeof withMediaIds === 'object' && !Array.isArray(withMediaIds)
        ? (withMediaIds as Record<string, unknown>)
        : {})
    )
  )

  const blockIdSource = section.id || `order-${section.order ?? 0}`
  const blockId = `block_${blockIdSource.replace(/[^a-zA-Z0-9]/g, '').substring(0, 12)}`

  return {
    blockName: section.acfBlock,
    attrs: {
      id: blockId,
      name: section.acfBlock,
      data,
      mode: 'preview',
    }
  }
}

/**
 * The generation pipeline emits generic copy keys (headline, subheadline,
 * html), but a few theme blocks read differently-named fields. Alias the
 * generic key onto the template's field name when the target is absent so
 * generated copy hydrates instead of being silently dropped.
 */
const BLOCK_FIELD_ALIASES: Record<string, Record<string, string>> = {
  'acf/text-section': { subheadline: 'subheading' },
  'acf/form': { headline: 'heading', subheadline: 'subheading' },
  'acf/html-section': { html: 'html_content' },
}

export function applyBlockFieldAliases(
  acfBlock: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  const aliases = BLOCK_FIELD_ALIASES[acfBlock]
  if (!aliases) {
    return data
  }

  const output: Record<string, unknown> = { ...data }
  for (const [sourceKey, targetKey] of Object.entries(aliases)) {
    if (output[sourceKey] !== undefined && output[targetKey] === undefined) {
      output[targetKey] = output[sourceKey]
      delete output[sourceKey]
    }
  }
  return output
}

/**
 * Flatten repeater arrays into ACF's indexed key format.
 *
 * ACF stores repeater rows as:
 *   fieldname_0_subfield = "value"
 *   fieldname_1_subfield = "value"
 *   fieldname = 2                   (row count)
 *
 * Blueprint JSON stores them as plain arrays of objects:
 *   { fieldname: [{ subfield: "value" }, { subfield: "value" }] }
 *
 * Nested repeaters are flattened recursively (parent_0_child_0_sub).
 */
export function flattenAcfRepeaterFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const flat: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
    ) {
      // Repeater field: emit row count plus indexed sub-keys
      flat[key] = value.length

      for (let i = 0; i < value.length; i++) {
        const row = flattenAcfRepeaterFields(value[i] as Record<string, unknown>)
        for (const [subKey, subVal] of Object.entries(row)) {
          flat[`${key}_${i}_${subKey}`] = subVal
        }
      }
    } else {
      // Scalar, simple array, null, or non-repeater object — pass through
      flat[key] = value
    }
  }

  return flat
}

/**
 * Render Gutenberg blocks as HTML
 */
function renderGutenbergBlocks(blocks: GutenbergBlock[]): string {
  return blocks
    .map(b => {
      const attrs = b.attrs && Object.keys(b.attrs).length > 0 ? ` ${JSON.stringify(b.attrs)}` : ''
      return `<!-- wp:${b.blockName}${attrs} /-->`
    })
    .join('\n\n')
}

/**
 * Utility: generate secure password
 */
function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  return Array.from({ length: 24 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('')
}

/**
 * Complete WordPress deployment orchestration
 */
export async function deployToWordPress(
  architecture: SiteArchitecture,
  propertyContext: { name: string; tagline?: string },
  assets: WebsiteAsset[],
  cloudwaysCredentials: CloudwaysCredentials,
  options: {
    onProgress?: DeploymentProgressReporter
    contentHash: string
  }
): Promise<WordPressInstance> {
  const onProgress = options?.onProgress
  const cloudways = new CloudwaysClient(cloudwaysCredentials, { onProgress })
  
  // 1. Create WordPress instance
  await reportProgress(onProgress, 'Provisioning WordPress infrastructure...')
  const instance = await cloudways.createWordPressInstance(propertyContext.name)
  
  // 2. Deploy theme and plugins
  await reportProgress(onProgress, 'Validating required WordPress theme/plugin readiness...')
  await cloudways.deployThemeAndPlugins(instance)

  const wpClient = new WordPressAPIClient(instance.url, instance.credentials, { onProgress })

  // 3. Upload assets
  await reportProgress(onProgress, 'Uploading generated assets to WordPress...')
  const mediaIds = await wpClient.uploadAssets(assets)

  // 4. Create pages
  await reportProgress(onProgress, 'Publishing generated pages to WordPress...')
  const createdPages: Array<{ id: number; title: string; purpose: string }> = []
  const pageIdsBySlug = new Map<string, number>()
  for (const page of architecture.pages) {
    const pageId = await wpClient.createPage(page, mediaIds)
    createdPages.push({
      id: pageId,
      title: page.title,
      purpose: page.purpose,
    })
    pageIdsBySlug.set(normalizePageSlug(page.slug), pageId)
  }
  await wpClient.applyContentManifest(
    options.contentHash,
    createdPages.map((page) => page.id)
  )
  
  // 5. Configure site settings
  await reportProgress(onProgress, 'Applying WordPress site settings...')
  await wpClient.updateSiteSettings({
    siteName: propertyContext.name,
    tagline: propertyContext.tagline || '',
    logo: mediaIds.get('logo'),
    homepageId: pageIdsBySlug.get('home'),
  })
  
  // 6. Create navigation
  await reportProgress(onProgress, 'Configuring navigation...')
  await wpClient.createNavigation(architecture, pageIdsBySlug)
  
  // 7. Configure SEO
  await reportProgress(onProgress, 'Applying SEO metadata...')
  await wpClient.configureYoastSEO(propertyContext, createdPages)

  // 8. Verify deployment completed with reachable assets/pages/settings.
  await reportProgress(onProgress, 'Running deployment verification checks...')
  await wpClient.verifyDeployment({
    expectedPages: architecture.pages,
    mediaIds,
    siteName: propertyContext.name,
  })
  
  return instance
}

/**
 * Deploy to an existing WordPress instance (no Cloudways provisioning).
 * Assumes the instance already has required theme/plugins installed.
 */
export async function deployToExistingWordPress(args: {
  wpUrl: string
  credentials: { username: string; password: string }
  pages: GeneratedPage[]
  propertyContext: { name: string; tagline?: string }
  assets: WebsiteAsset[]
  contentHash: string
  siteConfiguration?: SiteConfiguration
  requireContentManifest?: boolean
  onProgress?: DeploymentProgressReporter
}): Promise<WordPressInstance> {
  const { wpUrl, credentials, pages, propertyContext, assets, onProgress } = args
  const wpClient = new WordPressAPIClient(wpUrl, credentials, { onProgress })
  await reportProgress(onProgress, 'Connecting to existing WordPress target...')
  await wpClient.verifyReadiness({
    timeoutMs: Number(process.env.SITEFORGE_WP_READY_TIMEOUT_MS || 180000),
    pollIntervalMs: Number(process.env.SITEFORGE_WP_READY_POLL_MS || 5000),
    requireNamespaces: getRequiredWordPressNamespaces(),
  })

  await reportProgress(onProgress, 'Uploading generated assets to existing WordPress...')
  const mediaIds = await wpClient.uploadAssets(assets)

  await reportProgress(onProgress, 'Publishing generated pages to existing WordPress...')
  const createdPages: Array<{ id: number; title: string; purpose: string }> = []
  const pageIdsBySlug = new Map<string, number>()
  for (const page of pages) {
    const pageId = await wpClient.createPage(page, mediaIds)
    createdPages.push({
      id: pageId,
      title: page.title,
      purpose: page.purpose,
    })
    pageIdsBySlug.set(normalizePageSlug(page.slug), pageId)
  }
  try {
    await wpClient.applyContentManifest(
      args.contentHash,
      createdPages.map((page) => page.id)
    )
  } catch (error) {
    const canUseLegacyPreview =
      args.requireContentManifest === false &&
      error instanceof Error &&
      error.message.includes('content manifest') &&
      error.message.includes('(404)')
    if (!canUseLegacyPreview) throw error
    console.warn(
      '[siteforge_wordpress] preview target lacks content manifest endpoint; using P11 artifact identity',
      { contentHash: args.contentHash }
    )
  }

  await reportProgress(onProgress, 'Applying site settings...')
  await wpClient.updateSiteSettings({
    siteName: propertyContext.name,
    tagline: propertyContext.tagline || '',
    logo: mediaIds.get('logo'),
    homepageId: pageIdsBySlug.get('home'),
  })

  await reportProgress(onProgress, 'Configuring navigation...')
  await wpClient.createNavigation({
    navigation: {
      structure: 'primary',
      items: args.siteConfiguration?.navigation.items.length
        ? args.siteConfiguration.navigation.items.map(item => ({
            label: item.label,
            slug: item.href.replace(/^\/|\/$/g, '') || 'home',
            priority: 'medium' as const,
          }))
        : pages.map(page => ({
            label: page.title,
            slug: page.slug,
            priority: 'medium' as const,
          })),
      cta: {
        text:
          args.siteConfiguration?.header.cta.label || 'Schedule a Tour',
        style: 'primary',
      },
    },
    pages,
    designDecisions: {
      colorStrategy: 'defer_to_generated_site',
      imageStrategy: 'defer_to_uploaded_assets',
      contentDensity: 'balanced',
      conversionOptimization: [],
    },
  }, pageIdsBySlug)

  await reportProgress(onProgress, 'Applying SEO metadata...')
  await wpClient.configureYoastSEO(propertyContext, createdPages)

  await reportProgress(onProgress, 'Running deployment verification checks...')
  await wpClient.verifyDeployment({
    expectedPages: pages,
    mediaIds,
    siteName: propertyContext.name,
  })

  return {
    instanceId: 'existing',
    url: wpUrl,
    adminUrl: `${wpUrl.replace(/\/$/, '')}/wp-admin`,
    credentials
  }
}

function buildAssetFilename(asset: WebsiteAsset, contentType: string): string {
  const urlFilename = extractFilenameFromUrl(asset.fileUrl)
  if (urlFilename) {
    return urlFilename
  }

  const extension = mimeTypeToExtension(contentType)
  return `${asset.assetType}-${asset.id}.${extension}`
}

function extractFilenameFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').pop()
    return filename && filename.length > 0 ? filename : null
  } catch {
    return null
  }
}

function mimeTypeToExtension(contentType: string): string {
  const normalized = contentType.split(';')[0].trim().toLowerCase()
  const mappings: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
  }

  return mappings[normalized] || 'bin'
}

export function injectWordPressMediaIds(
  value: unknown,
  mediaIds: Map<string, number>
): unknown {
  if (Array.isArray(value)) {
    return value.map(entry => injectWordPressMediaIds(entry, mediaIds))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}

  for (const [key, raw] of Object.entries(input)) {
    const nested = injectWordPressMediaIds(raw, mediaIds)
    output[key] = nested

    if (typeof raw !== 'string') {
      continue
    }

    const mediaId = findMediaIdForUrl(raw, mediaIds)
    if (!mediaId) {
      continue
    }

    const derivedKey = deriveMediaIdKey(key)
    if (derivedKey && output[derivedKey] === undefined) {
      output[derivedKey] = mediaId
    }
  }

  // Generic object-level fallback for `{ url: "..." }` shapes.
  if (
    typeof output.url === 'string' &&
    output.id === undefined
  ) {
    const mediaId = findMediaIdForUrl(output.url, mediaIds)
    if (mediaId) {
      output.id = mediaId
    }
  }

  // ACF image fields persist attachment IDs, not arbitrary JSON objects.
  // Collapse SiteForge asset references after their URL has been resolved so
  // nested repeater images hydrate in PHP through get_field().
  if (
    typeof output.url === 'string' &&
    typeof output.id === 'number' &&
    (typeof output.assetId === 'string' ||
      typeof output.contentHash === 'string' ||
      typeof output.alt === 'string')
  ) {
    return output.id
  }

  return output
}

function deriveMediaIdKey(key: string): string | null {
  if (/_url$/i.test(key)) {
    return key.replace(/_url$/i, '_id')
  }
  if (/Url$/.test(key)) {
    return key.replace(/Url$/, 'Id')
  }
  if (/^image$/i.test(key) || /^photo$/i.test(key) || /^logo$/i.test(key) || /^src$/i.test(key)) {
    return `${key}Id`
  }
  return null
}

function findMediaIdForUrl(url: string, mediaIds: Map<string, number>): number | undefined {
  return mediaIds.get(`url:${normalizeAssetUrl(url)}`)
}

function normalizeAssetUrl(url: string): string {
  return url.trim().replace(/\/$/, '')
}

function normalizeNamespaceList(namespaces: unknown): string[] {
  if (!Array.isArray(namespaces)) {
    return []
  }
  return namespaces.filter((entry): entry is string => typeof entry === 'string')
}

function assertNamespacesAvailable(
  namespaces: string[],
  requiredNamespaces: string[]
): void {
  const missing = requiredNamespaces.filter(namespace => !namespaces.includes(namespace))
  if (missing.length > 0) {
    throw new Error(`Missing required WordPress namespaces: ${missing.join(', ')}`)
  }
}

function normalizePageSlug(slug: string): string {
  return slug.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}

function truncateMetaTitle(value: string): string {
  return value.length <= 60 ? value : `${value.slice(0, 57)}...`
}

function truncateMetaDescription(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 156) {
    return trimmed
  }
  return `${trimmed.slice(0, 153)}...`
}

function isMissingEndpointError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return (
    error.message.includes('(404)') ||
    error.message.includes('(403)') ||
    error.message.includes('(400)') ||
    error.message.includes('rest_no_route')
  )
}

function isYoastMetaUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return (
    error.message.includes('(400)') ||
    error.message.includes('meta') ||
    error.message.includes('(403)')
  )
}

function getRequiredWordPressNamespaces(): string[] {
  const requiredNamespaces = ['wp/v2', 'siteforge/v1']
  if (process.env.SITEFORGE_REQUIRE_YOAST === 'true') {
    requiredNamespaces.push('yoast/v1')
  }
  return requiredNamespaces
}

function buildCloudwaysServerLabel(propertyName: string): string {
  return truncateCloudwaysLabel(`${propertyName} SiteForge`)
}

function buildCloudwaysAppLabel(propertyName: string): string {
  return truncateCloudwaysLabel(propertyName)
}

function truncateCloudwaysLabel(label: string, maxLength = 50): string {
  const trimmed = label.replace(/\s+/g, ' ').trim()
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength).trim()
}

function normalizeSiteUrl(fqdnOrUrl: string): string {
  const value = fqdnOrUrl.trim()
  return /^https?:\/\//i.test(value)
    ? value.replace(/\/$/, '')
    : `https://${value.replace(/\/$/, '')}`
}

function selectCloudwaysServer(
  servers: CloudwaysServerRecord[],
  lookup: { serverId?: string | number; serverLabel: string; appLabel: string }
): CloudwaysServerRecord | undefined {
  return (
    servers.find(server => lookup.serverId && String(server.id) === String(lookup.serverId)) ||
    servers.find(server => server.label === lookup.serverLabel) ||
    servers.find(server => selectCloudwaysApp(server, lookup.appLabel))
  )
}

function selectCloudwaysApp(
  server: CloudwaysServerRecord,
  appLabel: string
): CloudwaysAppRecord | undefined {
  const apps = server.apps || []
  return (
    apps.find(app => app.label === appLabel) ||
    apps.find(app => app.application?.toLowerCase().includes('wordpress')) ||
    apps[0]
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function reportProgress(
  reporter: DeploymentProgressReporter | undefined,
  step: string
): Promise<void> {
  if (!reporter) {
    return
  }
  await reporter(step)
}

function getCloudwaysRequestTimeoutMs(): number {
  return getEnvTimeout('CLOUDWAYS_REQUEST_TIMEOUT_MS', 45000)
}

function getWordPressRequestTimeoutMs(): number {
  return getEnvTimeout('SITEFORGE_WP_REQUEST_TIMEOUT_MS', 45000)
}

function getAssetFetchTimeoutMs(): number {
  return getEnvTimeout('SITEFORGE_ASSET_FETCH_TIMEOUT_MS', 45000)
}

function getEnvTimeout(name: string, fallback: number): number {
  const raw = process.env[name]
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}







