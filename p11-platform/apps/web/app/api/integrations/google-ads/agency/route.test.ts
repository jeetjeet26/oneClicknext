import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { GET, POST } from './route'
import { GET as complete } from './callback/route'
import { GOOGLE_ADS_STATE_COOKIE } from '@/utils/marketvision/google-ads-operator'

const mocks = vi.hoisted(() => ({ operator: vi.fn(), rpc: vi.fn(), fetch: vi.fn() }))
vi.mock('@/utils/marketvision/google-ads-operator', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/marketvision/google-ads-operator')>(),
  googleAdsOperator: mocks.operator,
}))

const origin = 'https://console.example'
const path = '/api/integrations/google-ads/agency'
const app = { clientId: 'test.apps.googleusercontent.com', clientSecret: 'example-test-secret', managerId: '1630505086' }
const configured = { app, revision: 1, refreshToken: null, authorizedAt: null }
const adsScope = 'https://www.googleapis.com/auth/adwords'
const state = 'a'.repeat(43)
const verifier = 'b'.repeat(43)

function post(body: unknown, requestOrigin = origin) {
  return new NextRequest(origin + path, {
    method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

function callback(parameters = `state=${state}&code=google-code`, cookie = state) {
  return new NextRequest(`${origin}${path}/callback?${parameters}`, {
    headers: { cookie: `${GOOGLE_ADS_STATE_COOKIE}=${cookie}` },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', origin)
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.operator.mockResolvedValue({ db: { rpc: mocks.rpc }, orgId: 'org', actorId: 'operator' })
  mocks.rpc.mockImplementation(async name => ({
    data: name === 'read_google_ads_agency_credentials' ? configured
      : name === 'claim_google_ads_oauth' ? { revision: 1, verifier } : true,
    error: null,
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Google Ads manager authorization', () => {
  it('restricts setup to the platform operator and accepts writes only from the Console origin', async () => {
    expect((await POST(post({ action: 'authorize' }, 'https://other.example'))).status).toBe(403)
    mocks.operator.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
    expect((await POST(post({ action: 'authorize' }))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns redacted status and reserves an offline PKCE grant scoped to the operator and organization', async () => {
    const status = await (await GET()).json()
    expect(status).toMatchObject({ callbackUrl: origin + path + '/callback', managerId: '163-050-5086', appConfigured: true })
    expect(JSON.stringify(status)).not.toContain(app.clientSecret)

    const response = await POST(post({ action: 'authorize' }))
    expect(response.status).toBe(200)
    const url = new URL((await response.json()).authorizationUrl)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ scope: adsScope, access_type: 'offline', code_challenge_method: 'S256' })
    const saved = response.cookies.get(GOOGLE_ADS_STATE_COOKIE)
    expect(saved).toMatchObject({ value: url.searchParams.get('state'), httpOnly: true, sameSite: 'lax', secure: true, path: path + '/callback' })
    expect(mocks.rpc).toHaveBeenCalledWith('begin_google_ads_oauth', expect.objectContaining({
      p_org_id: 'org', p_actor_id: 'operator', p_revision: 1,
      p_state_hash: createHash('sha256').update(saved!.value).digest('hex'),
    }))
  })

  it('rejects a callback with an unrelated browser cookie before exchanging its code', async () => {
    const result = await complete(callback(undefined, 'different'))
    expect(result.headers.get('location')).toContain('googleAds=invalid')
    expect(result.cookies.get(GOOGLE_ADS_STATE_COOKIE)).toBeUndefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('stores the refresh grant after verifying the exact manager and never repeats a claimed callback', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'saved-grant', scope: adsScope }))
      .mockResolvedValueOnce(Response.json({ results: [{ customer: { id: '1630505086', manager: true } }] }))
    const result = await complete(callback())
    expect(result.headers.get('location')).toBe(origin + '/dashboard/settings/advertising?googleAds=connected')
    expect(mocks.rpc).toHaveBeenCalledWith('finish_google_ads_oauth', expect.objectContaining({
      p_actor_id: 'operator', p_org_id: 'org', p_refresh_token: 'saved-grant', p_revision: 1,
    }))
    expect(mocks.fetch.mock.calls[0][1].body.get('code_verifier')).toBe(verifier)
    expect(mocks.fetch.mock.calls[1]).toEqual([
      'https://googleads.googleapis.com/v25/customers/1630505086/googleAds:search',
      expect.objectContaining({ headers: expect.objectContaining({ 'login-customer-id': '1630505086' }) }),
    ])
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect((await complete(callback())).headers.get('location')).toContain('googleAds=invalid')
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not save a grant when Google returns an advertiser or a different manager', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'grant', scope: adsScope }))
      .mockResolvedValueOnce(Response.json({ results: [{ customer: { id: '7185923747', manager: false } }] }))
    expect((await complete(callback())).headers.get('location')).toContain('googleAds=manager')
    expect(mocks.rpc).not.toHaveBeenCalledWith('finish_google_ads_oauth', expect.anything())
  })
})
