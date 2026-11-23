import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import {
  GOOGLE_ADS_CALLBACK, GOOGLE_ADS_SCOPE, GOOGLE_ADS_SETTINGS, googleAdsCallbackUrl, googleAdsSearch,
  googleAdsTokenRequest, readGoogleAdsAgency,
} from '@/utils/marketvision/google-ads-agency'
import { googleAdsOperator, GOOGLE_ADS_STATE_COOKIE } from '@/utils/marketvision/google-ads-operator'

const claim = z.object({ revision: z.number().int().positive(), verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
const managerResult = z.object({ results: z.array(z.object({ customer: z.object({ id: z.string(), manager: z.literal(true) }) })).length(1) })

export async function GET(request: NextRequest) {
  const callbackUrl = new URL(googleAdsCallbackUrl())
  let clearState = false
  const finish = (status: string) => {
    const url = new URL(GOOGLE_ADS_SETTINGS, callbackUrl)
    url.searchParams.set('googleAds', status)
    const response = NextResponse.redirect(url, { headers: { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } })
    if (clearState) response.cookies.set(GOOGLE_ADS_STATE_COOKIE, '', {
      maxAge: 0, httpOnly: true, sameSite: 'lax', secure: callbackUrl.protocol === 'https:', path: GOOGLE_ADS_CALLBACK,
    })
    return response
  }

  try {
    const params = request.nextUrl.searchParams
    const state = params.get('state')
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || request.cookies.get(GOOGLE_ADS_STATE_COOKIE)?.value !== state) {
      return finish('invalid')
    }
    clearState = true
    const operator = await googleAdsOperator()
    if (!operator) return finish('invalid')
    const { db, orgId, actorId } = operator
    const stateHash = createHash('sha256').update(state).digest('hex')
    const { data, error } = await db.rpc('claim_google_ads_oauth', {
      p_org_id: orgId, p_actor_id: actorId, p_state_hash: stateHash,
    })
    if (error) throw new Error('Could not claim OAuth request')
    const claimed = claim.safeParse(data)
    if (!claimed.success) return finish('invalid')
    if (params.has('error')) return finish('declined')
    const code = params.get('code')
    if (!code || code.length > 8192) return finish('invalid')
    const saved = await readGoogleAdsAgency(db, orgId)
    if (!saved || saved.revision !== claimed.data.revision) return finish('changed')

    const signal = AbortSignal.timeout(20_000)
    const token = await googleAdsTokenRequest(saved.app, {
      grant_type: 'authorization_code', code, code_verifier: claimed.data.verifier, redirect_uri: callbackUrl.href,
    }, signal)
    if (!token.refresh_token || !token.scope?.split(/\s+/).includes(GOOGLE_ADS_SCOPE)) return finish('scope')
    const manager = managerResult.safeParse(await googleAdsSearch(saved.app.managerId, token.access_token,
      'SELECT customer.id, customer.manager FROM customer', signal))
    if (!manager.success || manager.data.results[0].customer.id !== saved.app.managerId) return finish('manager')
    const result = await db.rpc('finish_google_ads_oauth', {
      p_org_id: orgId, p_actor_id: actorId, p_revision: saved.revision, p_state_hash: stateHash,
      p_refresh_token: token.refresh_token,
    })
    if (result.error) throw new Error('Could not save OAuth grant')
    return finish(result.data === true ? 'connected' : 'changed')
  } catch {
    return finish('failed')
  }
}
