import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discoverWordPressCapabilities,
  getBuiltinThemeCapabilities,
} from './wordpress-discovery'
import { ACF_BLOCK_TYPES } from '@/types/siteforge'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('wordpress-discovery', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns built-in theme capabilities when no instance is configured', async () => {
    vi.stubEnv('SITEFORGE_WP_URL', '')

    const capabilities = await discoverWordPressCapabilities()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(capabilities.availableBlocks).toEqual([...ACF_BLOCK_TYPES])
    expect(capabilities.theme.name).toBe('oneclick-siteforge')
    expect(Object.keys(capabilities.blockSchemas)).toHaveLength(ACF_BLOCK_TYPES.length)
  })

  it('falls back to built-in capabilities when the live instance is unreachable', async () => {
    vi.stubEnv('SITEFORGE_WP_URL', 'https://wp.example.com')
    fetchMock.mockRejectedValue(new Error('connection refused'))

    const capabilities = await discoverWordPressCapabilities()

    expect(capabilities).toEqual(getBuiltinThemeCapabilities())
  })

  it('maps live discovery responses into typed capabilities', async () => {
    vi.stubEnv('SITEFORGE_WP_URL', 'https://wp.example.com/')
    vi.stubEnv('SITEFORGE_WP_USERNAME', 'admin')
    vi.stubEnv('SITEFORGE_WP_APP_PASSWORD', 'app-password')

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/abilities')) {
        return jsonResponse({
          available_blocks: ['acf/top-slides'],
          theme: { name: 'oneclick-siteforge', version: '1.2.0', supports: { acf_blocks: true } },
          plugins: ['advanced-custom-fields-pro'],
          capabilities: {
            can_create_pages: true,
            can_upload_media: true,
            can_modify_theme: false,
            can_install_plugins: false,
            max_upload_size_mb: 64,
          },
        })
      }
      if (url.endsWith('/acf-schemas')) {
        return jsonResponse({
          'acf/top-slides': { label: 'Hero', description: '', fields: {} },
        })
      }
      return jsonResponse({
        colors: { primary: '#111111', secondary: '#222222', available_variants: ['primary'] },
        typography: { available_fonts: ['Inter'], heading_scales: ['balanced'] },
        spacing: { available_scales: ['balanced'], presets: {} },
      })
    })

    const capabilities = await discoverWordPressCapabilities()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://wp.example.com/wp-json/siteforge/v1/abilities'
    )
    expect(capabilities.availableBlocks).toEqual(['acf/top-slides'])
    expect(capabilities.theme.version).toBe('1.2.0')
    expect(capabilities.designTokens.colors.primary).toBe('#111111')
    expect(capabilities.capabilities.maxUploadSizeMb).toBe(64)
  })
})
