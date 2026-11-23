import { createServiceClient } from '@/utils/supabase/admin'
import { getAppBaseUrl } from '@/utils/services/runtime-config'
import { z } from 'zod'

export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'
export const GOOGLE_ADS_API_VERSION = 'v25'
export const GOOGLE_ADS_CALLBACK = '/api/integrations/google-ads/agency/callback'
export const GOOGLE_ADS_SETTINGS = '/dashboard/settings/advertising'

export const googleAdsApp = z.object({
  clientId: z.string().trim().max(250).regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),
  clientSecret: z.string().trim().min(8).max(300),
  managerId: z.string().trim().transform(value => value.replaceAll('-', '')).pipe(z.string().regex(/^\d{10}$/)),
}).strict()

const credentials = z.object({
  revision: z.number().int().positive(),
  app: googleAdsApp,
  refreshToken: z.string().min(1).nullable(),
  authorizedAt: z.string().nullable(),
}).refine(row => (row.refreshToken === null) === (row.authorizedAt === null))

export type GoogleAdsApp = z.infer<typeof googleAdsApp>
export type GoogleAdsGrant = GoogleAdsApp & { refreshToken: string; developerToken?: string }

export async function readGoogleAdsAgency(db: ReturnType<typeof createServiceClient>, orgId: string) {
  const { data, error } = await db.rpc('read_google_ads_agency_credentials', { p_org_id: orgId })
  if (error) throw new Error('Could not read Google Ads authorization')
  return data === null ? null : credentials.parse(data)
}

export function legacyGoogleAdsGrant(): GoogleAdsGrant | null {
  const managerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim().replaceAll('-', '')
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim()
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()
  return managerId && /^\d{10}$/.test(managerId) && clientId && clientSecret && refreshToken
    ? { managerId, clientId, clientSecret, refreshToken, developerToken } : null
}

export function googleAdsCallbackUrl() {
  return new URL(GOOGLE_ADS_CALLBACK, getAppBaseUrl()).href
}

export function formatGoogleAdsCustomerId(id: string) {
  return `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`
}

export async function googleAdsTokenRequest(app: GoogleAdsApp, parameters: Record<string, string>, signal: AbortSignal) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', cache: 'no-store', signal,
    body: new URLSearchParams({ ...parameters, client_id: app.clientId, client_secret: app.clientSecret }),
  })
  if (!response.ok) throw new Error(`Google OAuth returned HTTP ${response.status}`)
  return z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), scope: z.string().optional() })
    .parse(await response.json())
}

export async function googleAdsSearch(managerId: string, token: string, query: string, signal: AbortSignal, pageToken?: string, developerToken?: string) {
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${managerId}/googleAds:search`, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'login-customer-id': managerId,
      'Content-Type': 'application/json',
      ...(developerToken ? { 'developer-token': developerToken } : {}),
    },
    body: JSON.stringify({ query, pageToken }),
  })
  if (!response.ok) throw new Error(`Google Ads returned HTTP ${response.status}`)
  return response.json()
}

const advertiserResult = z.object({
  results: z.array(z.object({
    customerClient: z.object({
      id: z.string().regex(/^\d{10}$/),
      descriptiveName: z.string().optional(),
      manager: z.boolean().optional(),
    }),
  })).optional(),
})

export async function findGoogleAdsAdvertiser(grant: GoogleAdsGrant, accountId: string) {
  if (!/^\d{10}$/.test(accountId)) return null
  const signal = AbortSignal.timeout(20_000)
  const token = await googleAdsTokenRequest(grant, {
    grant_type: 'refresh_token', refresh_token: grant.refreshToken,
  }, signal)
  const result = advertiserResult.parse(await googleAdsSearch(grant.managerId, token.access_token, `
    SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager
    FROM customer_client
    WHERE customer_client.manager = FALSE AND customer_client.id = ${accountId}
  `, signal, undefined, grant.developerToken))
  return result.results?.map(row => row.customerClient).find(row => row.id === accountId && !row.manager) ?? null
}
