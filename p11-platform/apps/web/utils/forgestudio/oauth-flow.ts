/**
 * Shared plumbing for ForgeStudio social OAuth connect/callback routes.
 *
 * - Connect: authenticated manager/admin only, session-bound signed state,
 *   one-time nonce cookie.
 * - Callback: authenticated session must match the state, nonce cookie is
 *   consumed, tokens are encrypted before persistence.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import {
  FORGESTUDIO_OAUTH_NONCE_COOKIE,
  createSignedForgeStudioOAuthState,
  generateForgeStudioOAuthNonce,
  verifyForgeStudioOAuthCallback,
} from '@/utils/services/forgestudio-oauth-state'
import { encryptSecret } from '@/utils/forgestudio/crypto'
import type { TablesInsert } from '@/types/supabase'

const NONCE_COOKIE_MAX_AGE_SECONDS = 15 * 60

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
}

export function connectionsRedirect(params: Record<string, string>): NextResponse {
  const url = new URL('/dashboard/forgestudio', getSiteUrl())
  url.searchParams.set('tab', 'connections')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return NextResponse.redirect(url.toString())
}

export type OAuthConnectContext = {
  userId: string
  propertyId: string
  state: string
  nonce: string
}

/**
 * Validate the connect request (auth + manager role + property access) and
 * produce the signed state. Returns a redirect response on any failure.
 */
export async function beginForgeStudioOAuthConnect(
  request: NextRequest
): Promise<OAuthConnectContext | NextResponse> {
  const authClient = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser()

  if (authError || !user) {
    return connectionsRedirect({ error: 'Unauthorized' })
  }

  const { searchParams } = new URL(request.url)
  const propertyId = searchParams.get('propertyId')

  if (!propertyId) {
    return connectionsRedirect({ error: 'Property ID required' })
  }

  const access = await validatePropertyManagerAccess(user.id, propertyId)
  if (!access.authorized) {
    return connectionsRedirect({
      error: access.error === 'Requires admin or manager role'
        ? 'Connecting social accounts requires an admin or manager role'
        : 'Forbidden',
    })
  }

  const nonce = generateForgeStudioOAuthNonce()
  const state = createSignedForgeStudioOAuthState({
    propertyId,
    userId: user.id,
    nonce,
  })

  return { userId: user.id, propertyId, state, nonce }
}

/** Redirect to the provider auth URL with the one-time nonce cookie attached. */
export function redirectToProvider(authUrl: string, nonce: string): NextResponse {
  const response = NextResponse.redirect(authUrl)
  response.cookies.set(FORGESTUDIO_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: getSiteUrl().startsWith('https'),
    sameSite: 'lax',
    path: '/api/forgestudio/social/callback',
    maxAge: NONCE_COOKIE_MAX_AGE_SECONDS,
  })
  return response
}

export function clearNonceCookie(response: NextResponse): NextResponse {
  response.cookies.set(FORGESTUDIO_OAUTH_NONCE_COOKIE, '', {
    httpOnly: true,
    path: '/api/forgestudio/social/callback',
    maxAge: 0,
  })
  return response
}

export type OAuthCallbackContext = {
  userId: string
  propertyId: string
  code: string
}

/**
 * Validate a provider callback: provider error params, required params,
 * authenticated session, signed state binding, and one-time nonce.
 * Returns a redirect response (with nonce cleared) on any failure.
 */
export async function validateForgeStudioOAuthCallback(
  request: NextRequest
): Promise<OAuthCallbackContext | NextResponse> {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error) {
    return clearNonceCookie(
      connectionsRedirect({ error: errorDescription || error })
    )
  }

  if (!code || !state) {
    return clearNonceCookie(connectionsRedirect({ error: 'missing_params' }))
  }

  const authClient = await createServerClient()
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser()

  if (authError || !user) {
    return clearNonceCookie(connectionsRedirect({ error: 'Unauthorized' }))
  }

  let propertyId: string
  try {
    const payload = verifyForgeStudioOAuthCallback({
      state,
      userId: user.id,
      nonceCookie: request.cookies.get(FORGESTUDIO_OAUTH_NONCE_COOKIE)?.value,
    })
    propertyId = payload.propertyId
  } catch (stateError) {
    console.error('[forgestudio-oauth] state verification failed', {
      message: stateError instanceof Error ? stateError.message : stateError,
    })
    return clearNonceCookie(connectionsRedirect({ error: 'invalid_state' }))
  }

  return { userId: user.id, propertyId, code }
}

export type SaveConnectionInput = {
  propertyId: string
  userId: string
  platform: string
  accountId: string
  accountName?: string | null
  accountUsername?: string | null
  accountAvatarUrl?: string | null
  accessToken: string
  refreshToken?: string | null
  tokenExpiresAt?: string | null
  scopes: string[]
  pageId?: string | null
  pageAccessToken?: string | null
  rawProfile?: Record<string, unknown>
}

/** Encrypt tokens and upsert the connection row. Throws on persistence error. */
export async function saveSocialConnection(input: SaveConnectionInput): Promise<void> {
  const supabase = createServiceClient()
  const row: TablesInsert<'social_connections'> = {
    property_id: input.propertyId,
    platform: input.platform,
    account_id: input.accountId,
    account_name: input.accountName ?? null,
    account_username: input.accountUsername ?? null,
    account_avatar_url: input.accountAvatarUrl ?? null,
    access_token: encryptSecret(input.accessToken),
    refresh_token: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    token_expires_at: input.tokenExpiresAt ?? null,
    scopes: input.scopes,
    page_id: input.pageId ?? null,
    page_access_token: input.pageAccessToken ? encryptSecret(input.pageAccessToken) : null,
    is_active: true,
    last_error: null,
    error_count: 0,
    connected_by: input.userId,
    raw_profile: (input.rawProfile ?? {}) as TablesInsert<'social_connections'>['raw_profile'],
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('social_connections')
    .upsert(row, { onConflict: 'property_id,platform,account_id' })

  if (error) {
    throw new Error(`Failed to save ${input.platform} connection: ${error.message}`)
  }
}
