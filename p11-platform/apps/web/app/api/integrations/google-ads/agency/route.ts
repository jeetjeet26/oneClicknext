import { createHash, randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import {
  formatGoogleAdsCustomerId, GOOGLE_ADS_CALLBACK, GOOGLE_ADS_SCOPE,
  googleAdsApp, googleAdsCallbackUrl, legacyGoogleAdsGrant, readGoogleAdsAgency,
} from '@/utils/marketvision/google-ads-agency'
import { googleAdsOperator, GOOGLE_ADS_STATE_COOKIE, GOOGLE_ADS_STATE_MAX_AGE } from '@/utils/marketvision/google-ads-operator'

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configure'), revision: z.number().int().nonnegative(), app: googleAdsApp }).strict(),
  z.object({ action: z.literal('authorize') }).strict(),
])

export async function GET() {
  try {
    const operator = await googleAdsOperator()
    if (!operator) return NextResponse.json({ error: 'Google Ads setup requires a platform operator.' }, { status: 403 })
    const saved = await readGoogleAdsAgency(operator.db, operator.orgId)
    const legacy = saved?.refreshToken ? null : legacyGoogleAdsGrant()
    const managerId = saved?.app.managerId ?? legacy?.managerId
    return NextResponse.json({
      appConfigured: !!saved, authorized: !!saved?.refreshToken, legacyConfigured: !!legacy,
      revision: saved?.revision ?? 0, authorizedAt: saved?.authorizedAt ?? null,
      managerId: managerId ? formatGoogleAdsCustomerId(managerId) : null, callbackUrl: googleAdsCallbackUrl(),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Could not load Google Ads setup.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const operator = await googleAdsOperator()
    if (!operator) return NextResponse.json({ error: 'Google Ads setup requires a platform operator.' }, { status: 403 })
    const callbackUrl = new URL(googleAdsCallbackUrl())
    if (request.headers.get('origin') !== callbackUrl.origin) {
      return NextResponse.json({ error: `Open ${callbackUrl.origin} to authorize Google Ads.` }, { status: 403 })
    }
    const parsed = input.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Enter a valid Google OAuth client ID, client secret and manager ID.' }, { status: 400 })
    const { db, orgId, actorId } = operator
    if (parsed.data.action === 'configure') {
      const { data, error } = await db.rpc('configure_google_ads_agency', {
        p_org_id: orgId, p_app: parsed.data.app, p_revision: parsed.data.revision,
      })
      if (error) throw new Error('Could not save Google Ads app')
      return data === true ? NextResponse.json({ saved: true }) : NextResponse.json({
        error: 'Google Ads setup has changed or already has an authorization. Refresh to see the current configuration.',
      }, { status: 409 })
    }

    const saved = await readGoogleAdsAgency(db, orgId)
    if (!saved) return NextResponse.json({ error: 'Save the Google OAuth app first.' }, { status: 409 })
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const { data, error } = await db.rpc('begin_google_ads_oauth', {
      p_org_id: orgId, p_actor_id: actorId, p_revision: saved.revision, p_verifier: verifier,
      p_state_hash: createHash('sha256').update(state).digest('hex'),
    })
    if (error || data !== true) throw new Error('Could not start Google Ads OAuth')
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: saved.app.clientId, response_type: 'code', redirect_uri: callbackUrl.href,
      scope: GOOGLE_ADS_SCOPE, access_type: 'offline', prompt: 'consent select_account', state,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString()
    const response = NextResponse.json({ authorizationUrl: url.href }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set(GOOGLE_ADS_STATE_COOKIE, state, {
      httpOnly: true, sameSite: 'lax', secure: callbackUrl.protocol === 'https:', path: GOOGLE_ADS_CALLBACK,
      maxAge: GOOGLE_ADS_STATE_MAX_AGE,
    })
    return response
  } catch {
    return NextResponse.json({ error: 'Google Ads setup could not be saved or started. Refresh and try again.' }, { status: 500 })
  }
}
