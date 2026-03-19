import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAppBaseUrl, getDataEngineUrl } from './runtime-config'

describe('runtime-config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers explicit app base URL env values', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.com/')
    expect(getAppBaseUrl()).toBe('https://example.com')
  })

  it('falls back to localhost app base URL in local runtime', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('RENDER', '')
    vi.stubEnv('RENDER_SERVICE_ID', '')

    expect(getAppBaseUrl()).toBe('http://localhost:3000')
  })

  it('throws when data-engine URL is missing in hosted runtime', () => {
    vi.stubEnv('DATA_ENGINE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL', '1')

    expect(() => getDataEngineUrl()).toThrow('Missing DATA_ENGINE_URL')
  })

  it('falls back to localhost data-engine URL in local runtime', () => {
    vi.stubEnv('DATA_ENGINE_URL', '')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('RENDER', '')
    vi.stubEnv('RENDER_SERVICE_ID', '')

    expect(getDataEngineUrl()).toBe('http://localhost:8000')
  })
})
