import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import { getAppBaseUrl } from './runtime-config'
import type {
  IntegrationCapability,
  IntegrationProvider,
} from './integration-provider-config'

const DEFAULT_INVITE_TTL_HOURS = 168

export type IntegrationAuthInvite = {
  id: string
  property_id: string
  provider: IntegrationProvider
  requested_capabilities: IntegrationCapability[]
  token_hash: string
  token_preview: string | null
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  created_by_profile_id: string | null
}

export function createInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function safeTokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function buildExternalIntegrationLink(token: string): string {
  const url = new URL('/lumaleasing/integrations/connect', getAppBaseUrl())
  url.searchParams.set('token', token)
  return url.toString()
}

export function getInviteExpiresAt(hours = DEFAULT_INVITE_TTL_HOURS): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

export async function createIntegrationAuthInvite(params: {
  propertyId: string
  provider: IntegrationProvider
  capabilities: IntegrationCapability[]
  createdByProfileId: string
  expiresAt?: string
}) {
  const token = createInviteToken()
  const tokenHash = hashInviteToken(token)
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('integration_auth_invites')
    .insert({
      property_id: params.propertyId,
      provider: params.provider,
      requested_capabilities: params.capabilities,
      token_hash: tokenHash,
      token_preview: `${token.slice(0, 4)}...${token.slice(-4)}`,
      expires_at: params.expiresAt || getInviteExpiresAt(),
      created_by_profile_id: params.createdByProfileId,
    })
    .select('id, property_id, provider, requested_capabilities, token_preview, expires_at, consumed_at, revoked_at, created_by_profile_id, created_at')
    .single()

  if (error || !data) {
    throw error || new Error('Failed to create integration auth invite')
  }

  return {
    invite: data,
    token,
    url: buildExternalIntegrationLink(token),
  }
}

export async function getValidIntegrationAuthInviteByToken(
  token: string
): Promise<IntegrationAuthInvite | null> {
  const tokenHash = hashInviteToken(token)
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('integration_auth_invites')
    .select('id, property_id, provider, requested_capabilities, token_hash, token_preview, expires_at, consumed_at, revoked_at, created_by_profile_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  if (
    data.consumed_at ||
    data.revoked_at ||
    new Date(data.expires_at).getTime() <= Date.now() ||
    !safeTokenHashEquals(data.token_hash, tokenHash)
  ) {
    return null
  }

  return data as IntegrationAuthInvite
}
