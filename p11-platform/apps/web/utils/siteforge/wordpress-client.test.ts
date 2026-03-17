import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CloudwaysClient,
  WordPressAPIClient,
  deployToExistingWordPress,
} from './wordpress-client'
import type { GeneratedPage, WebsiteAsset } from '@/types/siteforge'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('wordpress-client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uploads assets to the WordPress media library and aliases logo media ids', async () => {
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    const assets: WebsiteAsset[] = [
      {
        id: 'logo-asset',
        websiteId: 'website-1',
        assetType: 'logo',
        source: 'brandforge',
        fileUrl: 'https://cdn.example.com/logo.png',
        mimeType: 'image/png',
        altText: 'Property logo',
        caption: 'Primary logo',
        optimized: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'hero-asset',
        websiteId: 'website-1',
        assetType: 'hero_image',
        source: 'generated',
        fileUrl: 'https://cdn.example.com/hero.jpg',
        mimeType: 'image/jpeg',
        optimized: true,
        createdAt: new Date().toISOString(),
      },
    ]

    fetchMock
      .mockResolvedValueOnce(
        new Response('logo-binary', {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 101 }))
      .mockResolvedValueOnce(jsonResponse({ id: 101 }))
      .mockResolvedValueOnce(
        new Response('hero-binary', {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 202 }))

    const mediaIds = await client.uploadAssets(assets)

    expect(mediaIds.get('logo-asset')).toBe(101)
    expect(mediaIds.get('logo')).toBe(101)
    expect(mediaIds.get('hero-asset')).toBe(202)

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/wp-json/wp/v2/media',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'image/png',
          'Content-Disposition': 'attachment; filename="logo.png"',
        }),
      })
    )
  })

  it('retries site settings without logo when the site_logo field is rejected', async () => {
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ message: 'site_logo is not supported' }, 400)
      )
      .mockResolvedValueOnce(jsonResponse({}))

    await client.updateSiteSettings({
      siteName: 'Sunset Apartments',
      tagline: 'Schedule a tour today',
      logo: 77,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      title: 'Sunset Apartments',
      description: 'Schedule a tour today',
      site_logo: 77,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      title: 'Sunset Apartments',
      description: 'Schedule a tour today',
    })
  })

  it('deploys to an existing WordPress instance with uploaded assets and published pages', async () => {
    const page: GeneratedPage = {
      slug: 'home',
      title: 'Home',
      purpose: 'Convert visitors',
      sections: [
        {
          type: 'hero',
          acfBlock: 'acf/top-slides',
          content: {
            headline: 'Welcome Home',
            heroImageUrl: 'https://cdn.example.com/logo.png',
          },
          reasoning: 'Lead with the hero',
          order: 1,
        },
      ],
    }

    const assets: WebsiteAsset[] = [
      {
        id: 'logo-asset',
        websiteId: 'website-1',
        assetType: 'logo',
        source: 'brandforge',
        fileUrl: 'https://cdn.example.com/logo.png',
        mimeType: 'image/png',
        optimized: true,
        createdAt: new Date().toISOString(),
      },
    ]

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ namespaces: ['wp/v2', 'acf/v3'] })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Admin User' }))
      .mockResolvedValueOnce(
        new Response('logo-binary', {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 15 }))
      .mockResolvedValueOnce(jsonResponse({ id: 9001 }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ namespaces: ['wp/v2'] }))
      .mockResolvedValueOnce(
        jsonResponse([{ id: 9001, slug: 'home', status: 'publish' }])
      )
      .mockResolvedValueOnce(jsonResponse({ id: 15 }))
      .mockResolvedValueOnce(jsonResponse({ title: 'Sunset Apartments' }))

    const deployed = await deployToExistingWordPress({
      wpUrl: 'https://site.example.com',
      credentials: {
        username: 'admin',
        password: 'app-password',
      },
      pages: [page],
      propertyContext: {
        name: 'Sunset Apartments',
        tagline: 'Tour today',
      },
      assets,
    })

    expect(deployed).toEqual({
      instanceId: 'existing',
      url: 'https://site.example.com',
      adminUrl: 'https://site.example.com/wp-admin',
      credentials: {
        username: 'admin',
        password: 'app-password',
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://site.example.com/wp-json/wp/v2/pages',
      expect.objectContaining({
        method: 'POST',
      })
    )

    const createPageBody = JSON.parse(String(fetchMock.mock.calls[4][1]?.body))
    expect(createPageBody.title).toBe('Home')
    expect(createPageBody.slug).toBe('home')
    expect(createPageBody.content).toContain('acf/top-slides')
    expect(createPageBody.content).toContain('heroImageId')
    expect(createPageBody.content).toContain('15')
  })

  it('fails readiness checks when required namespaces are missing', async () => {
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    fetchMock.mockImplementation(async () => jsonResponse({ namespaces: ['wp/v2'] }))

    await expect(
      client.verifyReadiness({
        timeoutMs: 10,
        pollIntervalMs: 0,
        requireNamespaces: ['wp/v2', 'acf/v3'],
      })
    ).rejects.toThrow('Missing required WordPress namespaces: acf/v3')
  })

  it('fails deployment verification when expected pages are missing', async () => {
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 15 }))
      .mockResolvedValueOnce(jsonResponse({ title: 'Sunset Apartments' }))

    await expect(
      client.verifyDeployment({
        expectedPages: [{ slug: 'home' }],
        mediaIds: new Map([['logo', 15]]),
        siteName: 'Sunset Apartments',
      })
    ).rejects.toThrow('missing published pages for slugs: home')
  })

  it('provisions a Cloudways WordPress instance using OAuth, app lookup, and server polling', async () => {
    const client = new CloudwaysClient({
      apiKey: 'cw-key',
      email: 'jesse@p11.com',
    })

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'cw-token' }))
      .mockResolvedValueOnce(
        jsonResponse({
          apps: {
            WordPress: {
              versions: [{ app_version: '6.2.2', application: 'wordpress' }],
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          server: {
            id: '50710',
            operations: [{ id: '596406' }],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          operation: { id: '596406', is_completed: '1' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          servers: [
            {
              id: '50710',
              label: 'Sunset Apartments SiteForge',
              server_fqdn: '12847-50710.cloudwaysapps.com',
              apps: [
                {
                  id: '131933',
                  label: 'Sunset Apartments',
                  application: 'wordpress',
                  app_fqdn: 'sunset-50710.cloudwaysapps.com',
                  app_user: 'admin',
                  app_password: 'wp-secret',
                },
              ],
            },
          ],
        })
      )

    const instance = await client.createWordPressInstance('Sunset Apartments')

    expect(instance).toEqual({
      instanceId: '50710',
      url: 'https://sunset-50710.cloudwaysapps.com',
      adminUrl: 'https://sunset-50710.cloudwaysapps.com/wp-admin',
      credentials: {
        username: 'admin',
        password: 'wp-secret',
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.cloudways.com/api/v1/oauth/access_token',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.cloudways.com/api/v1/server',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('application=wordpress'),
      })
    )
  })

  it('rotates the WordPress admin password when Cloudways omits app_password', async () => {
    const client = new CloudwaysClient({
      apiKey: 'cw-key',
      email: 'jesse@p11.com',
    })

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'cw-token' }))
      .mockResolvedValueOnce(
        jsonResponse({
          apps: {
            WordPress: {
              versions: [{ app_version: '6.2.2', application: 'wordpress' }],
            },
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          server: {
            id: '50710',
            operations: [{ id: '596406' }],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          operation: { id: '596406', is_completed: '1' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          servers: [
            {
              id: '50710',
              label: 'Sunset Apartments SiteForge',
              server_fqdn: '12847-50710.cloudwaysapps.com',
              apps: [
                {
                  id: '131933',
                  label: 'Sunset Apartments',
                  application: 'wordpress',
                  app_fqdn: 'sunset-50710.cloudwaysapps.com',
                  app_user: 'admin',
                },
              ],
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ response: { operation_id: 18591 } }))

    const instance = await client.createWordPressInstance('Sunset Apartments')

    expect(instance.url).toBe('https://sunset-50710.cloudwaysapps.com')
    expect(instance.credentials.username).toBe('admin')
    expect(instance.credentials.password).toHaveLength(24)

    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://api.cloudways.com/api/v1/app/creds/changeAdminCredentials?server_id=50710&app_id=131933',
      expect.objectContaining({
        method: 'POST',
      })
    )
  })

  it('fails Cloudways provisioning when an API request times out', async () => {
    vi.stubEnv('CLOUDWAYS_REQUEST_TIMEOUT_MS', '10')
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
    )

    const client = new CloudwaysClient({
      apiKey: 'cw-key',
      email: 'jesse@p11.com',
    })

    await expect(client.createWordPressInstance('Sunset Apartments')).rejects.toThrow(
      'Cloudways API POST /oauth/access_token timed out after 10ms'
    )
  })

  it('fails WordPress requests when API calls time out', async () => {
    vi.stubEnv('SITEFORGE_WP_REQUEST_TIMEOUT_MS', '10')
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
    )

    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    await expect(
      client.updateSiteSettings({
        siteName: 'Sunset Apartments',
        tagline: 'Schedule a tour today',
      })
    ).rejects.toThrow('WordPress API request /settings timed out after 10ms')
  })
})
