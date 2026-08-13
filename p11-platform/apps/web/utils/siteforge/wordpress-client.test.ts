import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CloudwaysClient,
  WordPressAPIClient,
  deployToExistingWordPress,
  flattenAcfRepeaterFields,
  injectWordPressMediaIds,
} from './wordpress-client'
import type { GeneratedPage, WebsiteAsset } from '@/types/siteforge'

const { ensureInstalledMock } = vi.hoisted(() => ({
  ensureInstalledMock: vi.fn(),
}))
vi.mock('@/utils/siteforge/wordpress/wordpress-installer', () => ({
  SshWordPressInstaller: class {
    ensureInstalled = ensureInstalledMock
  },
}))

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

  it('uses the SiteForge REST namespace for content manifests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const client = new WordPressAPIClient('https://example.com/\n', {
      username: 'admin',
      password: 'app-password',
    })

    await client.applyContentManifest('a'.repeat(64), [1, 2])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/wp-json/siteforge/v1/content-manifest',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('rejects a successful manifest response with a missing or malformed hash', async () => {
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ page_ids: [1] }))
      .mockResolvedValueOnce(
        jsonResponse({ content_hash: 'not-a-sha256', page_ids: [1] })
      )

    await expect(client.getContentManifest()).rejects.toThrow(
      'did not include a valid artifact hash'
    )
    await expect(client.getContentManifest()).rejects.toThrow(
      'did not include a valid artifact hash'
    )
  })

  it('activates indexing only when WordPress confirms the exact production hash', async () => {
    const hash = 'b'.repeat(64)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        activated: true,
        content_hash: hash,
        blog_public: '1',
      })
    )
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    await expect(client.activateProduction(hash)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/wp-json/siteforge/v1/production-activation',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content_hash: hash }),
      })
    )
  })

  it('rejects production activation when WordPress confirms a different hash', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        activated: true,
        content_hash: 'c'.repeat(64),
        blog_public: '1',
      })
    )
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    await expect(client.activateProduction('b'.repeat(64))).rejects.toThrow(
      'WordPress did not confirm production indexability'
    )
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
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response('logo-binary', {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 101 }))
      .mockResolvedValueOnce(jsonResponse({ id: 101 }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response('hero-binary', {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 202 }))
      .mockResolvedValueOnce(jsonResponse({ id: 202 }))

    const mediaIds = await client.uploadAssets(assets)

    expect(mediaIds.get('logo-asset')).toBe(101)
    expect(mediaIds.get('logo')).toBe(101)
    expect(mediaIds.get('hero-asset')).toBe(202)

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
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
          id: 'section-hero-1',
          type: 'hero',
          acfBlock: 'acf/top-slides',
          content: {
            headline: 'Welcome Home',
            heroImageUrl: 'https://cdn.example.com/logo.png',
            slides: [
              { headline: 'Slide One', subheadline: 'First' },
              { headline: 'Slide Two', subheadline: 'Second' },
            ],
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
        jsonResponse({ namespaces: ['wp/v2', 'acf/v3', 'siteforge/v1'] })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 1, name: 'Admin User' }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        new Response('logo-binary', {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 15 }))
      .mockResolvedValueOnce(jsonResponse({ id: 15 }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 9001 }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ id: 44 }))
      .mockResolvedValueOnce(jsonResponse({ id: 501 }))
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
      contentHash: 'a'.repeat(64),
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
      8,
      'https://site.example.com/wp-json/wp/v2/pages',
      expect.objectContaining({
        method: 'POST',
      })
    )

    const createPageBody = JSON.parse(String(fetchMock.mock.calls[7][1]?.body))
    expect(createPageBody.title).toBe('Home')
    expect(createPageBody.slug).toBe('home')
    expect(createPageBody.content).toContain('acf/top-slides')
    expect(createPageBody.content).toContain('heroImageId')
    expect(createPageBody.content).toContain('15')

    // ACF attrs shape and repeater flattening in serialized block data
    const blockAttrsMatch = String(createPageBody.content).match(
      /<!-- wp:acf\/top-slides (\{[\s\S]*?\}) \/-->/
    )
    expect(blockAttrsMatch).not.toBeNull()
    const blockAttrs = JSON.parse(blockAttrsMatch![1])
    expect(blockAttrs.name).toBe('acf/top-slides')
    expect(blockAttrs.mode).toBe('preview')
    expect(blockAttrs.id).toMatch(/^block_/)
    expect(blockAttrs.data.slides).toBe(2)
    expect(blockAttrs.data.slides_0_headline).toBe('Slide One')
    expect(blockAttrs.data.slides_1_subheadline).toBe('Second')

    // Classic menu created and assigned to the primary location
    const menuCall = fetchMock.mock.calls[10]
    expect(menuCall[0]).toBe('https://site.example.com/wp-json/wp/v2/menus')
    expect(JSON.parse(String(menuCall[1]?.body))).toEqual({
      name: 'Primary Navigation',
      locations: ['primary'],
    })

    const menuItemCall = fetchMock.mock.calls[11]
    expect(menuItemCall[0]).toBe('https://site.example.com/wp-json/wp/v2/menu-items')
    expect(JSON.parse(String(menuItemCall[1]?.body))).toEqual({
      title: 'Home',
      menus: 44,
      menu_order: 1,
      status: 'publish',
      type: 'post_type',
      object: 'page',
      object_id: 9001,
    })
  })

  it('falls back to block-theme navigation when classic menus are unavailable', async () => {
    const client = new WordPressAPIClient('https://example.com', {
      username: 'admin',
      password: 'app-password',
    })

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'rest_no_route' }, 404))
      .mockResolvedValueOnce(jsonResponse({ id: 900 }))

    await client.createNavigation(
      {
        navigation: {
          structure: 'primary',
          items: [{ label: 'Home', slug: 'home', priority: 'high' }],
          cta: { text: 'Tour', style: 'primary' },
        },
        pages: [
          { slug: 'home', title: 'Home', purpose: 'Convert', sections: [] },
        ],
        designDecisions: {
          colorStrategy: '',
          imageStrategy: '',
          contentDensity: 'balanced',
          conversionOptimization: [],
        },
      },
      new Map([['home', 9001]])
    )

    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/wp-json/wp/v2/menus')
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/wp-json/wp/v2/navigation')
  })

  it('aliases generic pipeline copy keys onto theme field names per block', async () => {
    const { applyBlockFieldAliases } = await import('./wordpress-client')

    expect(
      applyBlockFieldAliases('acf/form', {
        headline: 'Schedule a Tour',
        subheadline: 'We reply fast',
        form_type: 'tour',
      })
    ).toEqual({
      heading: 'Schedule a Tour',
      subheading: 'We reply fast',
      form_type: 'tour',
    })

    // Explicit template-named keys win over generic aliases
    expect(
      applyBlockFieldAliases('acf/text-section', {
        subheadline: 'generic',
        subheading: 'explicit',
      })
    ).toEqual({ subheadline: 'generic', subheading: 'explicit' })

    // Blocks without aliases pass through untouched
    expect(applyBlockFieldAliases('acf/gallery', { images: [1, 2] })).toEqual({
      images: [1, 2],
    })
  })

  it('flattens repeater arrays into ACF indexed key format', () => {
    expect(
      flattenAcfRepeaterFields({
        headline: 'Welcome',
        slides: [
          { headline: 'One', cta: { text: 'Go' } },
          { headline: 'Two' },
        ],
        tags: ['a', 'b'],
        empty: [],
      })
    ).toEqual({
      headline: 'Welcome',
      slides: 2,
      slides_0_headline: 'One',
      slides_0_cta: { text: 'Go' },
      slides_1_headline: 'Two',
      tags: ['a', 'b'],
      empty: [],
    })

    // Nested repeaters flatten recursively
    expect(
      flattenAcfRepeaterFields({
        plans: [{ units: [{ name: 'A1' }] }],
      })
    ).toEqual({
      plans: 1,
      plans_0_units: 1,
      plans_0_units_0_name: 'A1',
    })
  })

  it('collapses SiteForge image references to WordPress attachment IDs', () => {
    const mediaIds = new Map([
      ['url:https://cdn.example.com/hero.jpg', 42],
    ])

    expect(
      injectWordPressMediaIds(
        {
          slides: [
            {
              headline: 'Welcome',
              image: {
                url: 'https://cdn.example.com/hero.jpg',
                assetId: 'asset-hero',
                alt: 'Property exterior',
              },
            },
          ],
        },
        mediaIds
      )
    ).toEqual({
      slides: [
        {
          headline: 'Welcome',
          image: 42,
        },
      ],
    })
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

    expect(instance).toEqual(expect.objectContaining({
      instanceId: '50710',
      url: 'https://sunset-50710.cloudwaysapps.com',
      adminUrl: 'https://sunset-50710.cloudwaysapps.com/wp-admin',
      credentials: {
        username: 'admin',
        password: 'wp-secret',
      },
      ssh: expect.objectContaining({
        host: '12847-50710.cloudwaysapps.com',
      }),
      providerMetadata: expect.objectContaining({
        applicationId: '131933',
      }),
    }))

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.cloudways.com/api/v2/oauth/access_token',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.cloudways.com/api/v2/servers',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('application=wordpress'),
      })
    )
  })

  it('uses a modern Cloudways access token without an OAuth exchange', async () => {
    vi.stubEnv(
      'SITEFORGE_CLOUDWAYS_SSH_PRIVATE_KEY',
      '-----BEGIN OPENSSH PRIVATE KEY-----\\nkey-data\\n-----END OPENSSH PRIVATE KEY-----'
    )
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            servers: [
              {
                id: '50710',
                server_fqdn: '12847-50710.cloudwaysapps.com',
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: '50710',
          server_fqdn: '12847-50710.cloudwaysapps.com',
          master_user: 'server-master',
          master_password: 'server-password',
          apps: [{ id: '131933', label: 'SiteForge Preview' }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          app: {
            id: '131933',
            app_fqdn: 'preview.example.com',
            sys_user: 'application-system-user',
            app_user: 'preview-user',
            app_password: 'preview-password',
          },
        })
      )

    const instance = await new CloudwaysClient({
      apiKey: 'cw_access-token',
      email: 'jesse@p11.com',
    }).discoverWordPressInstance('https://preview.example.com', {
      username: 'admin',
      password: 'app-password',
    })

    expect(instance.providerMetadata?.applicationId).toBe('131933')
    expect(instance.ssh).toEqual(
      expect.objectContaining({
        username: 'server-master',
        privateKey:
          '-----BEGIN OPENSSH PRIVATE KEY-----\nkey-data\n-----END OPENSSH PRIVATE KEY-----',
        applicationRoot:
          '/home/master/applications/application-system-user/public_html',
        sftpApplicationRoot:
          '/applications/application-system-user/public_html',
      })
    )
    expect(instance.ssh?.password).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.cloudways.com/api/v2/apps/131933',
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.cloudways.com/api/v2/servers',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cw_access-token',
        }),
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
      'https://api.cloudways.com/api/v2/applications/131933/admin-password',
      expect.objectContaining({
        method: 'PUT',
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
