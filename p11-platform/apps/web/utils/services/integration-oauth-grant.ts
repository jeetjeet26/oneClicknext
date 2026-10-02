import type {IntegrationCapability, IntegrationProvider} from './integration-provider-config'

export class OAuthGrantError extends Error {
  constructor(readonly code: 'permissions_unconfirmed' | 'permissions_incomplete' | 'invalid_token_response') {
    super(code)
    this.name = 'OAuthGrantError'
  }
}

export interface ConfirmedOAuthGrant {
  access_token: string
  refresh_token: string
  expires_in: number
  scopes: string[]
  scopeEvidence: 'provider_response' | 'microsoft_request_contract'
}

const tokenValue = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32768 && !/\s/.test(value)

/** Never infer a Google grant from requested scopes. Microsoft explicitly defines
 * omitted scope as the original request; accept that only when that exact request
 * was included in our verified signed state. Do not decode unverified JWT claims. */
export function confirmOAuthGrant(provider: IntegrationProvider, capabilities: IntegrationCapability[], response: unknown, requestedScopes?: string[]): ConfirmedOAuthGrant {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new OAuthGrantError('invalid_token_response')
  const token = response as Record<string, unknown>
  if (!tokenValue(token.access_token) || !tokenValue(token.refresh_token) ||
      typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 366 * 86400 ||
      typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') {
    throw new OAuthGrantError('invalid_token_response')
  }
  let scopeEvidence: ConfirmedOAuthGrant['scopeEvidence'] = 'provider_response'
  let scopes: string[]
  if (token.scope === undefined && provider === 'microsoft' && requestedScopes?.length) {
    scopes = [...requestedScopes]
    scopeEvidence = 'microsoft_request_contract'
  } else {
    if (typeof token.scope !== 'string' || !token.scope.trim() || token.scope.length > 16384) throw new OAuthGrantError('permissions_unconfirmed')
    scopes = token.scope.trim().split(/\s+/)
  }
  scopes = [...new Set(scopes)]
  if (scopes.length > 100 || scopes.some(scope => typeof scope !== 'string' || !scope || scope.length > 1024 || /\s/.test(scope))) throw new OAuthGrantError('permissions_unconfirmed')
  const permission = new Set(scopes.map(scope => {
    if (provider === 'google') return scope
    try { return decodeURIComponent(scope).replace(/^https:\/\/graph\.microsoft\.com\//i, '').toLowerCase() }
    catch { throw new OAuthGrantError('permissions_unconfirmed') }
  }))
  if (!capabilities.length || capabilities.some(capability => capability !== 'calendar' && capability !== 'email')) throw new OAuthGrantError('permissions_incomplete')
  const has = (scope: string) => permission.has(scope)
  const allowed = provider === 'google'
    ? (!capabilities.includes('calendar') || has('https://www.googleapis.com/auth/calendar')) &&
      (!capabilities.includes('email') || has('https://www.googleapis.com/auth/gmail.modify') || has('https://mail.google.com/'))
    : has('user.read') && (!capabilities.includes('calendar') || has('calendars.readwrite')) &&
      (!capabilities.includes('email') || (has('mail.send') && (has('mail.read') || has('mail.readwrite'))))
  if (!allowed) throw new OAuthGrantError('permissions_incomplete')
  return {access_token: token.access_token, refresh_token: token.refresh_token, expires_in: token.expires_in, scopes, scopeEvidence}
}
