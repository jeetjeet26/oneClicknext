import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  IntegrationAuthSource,
  IntegrationCapability,
  IntegrationProvider,
} from './integration-provider-config'
import {
  normalizeCapabilities,
  normalizeProvider,
} from './integration-provider-config'

const STATE_TTL_MS = 15 * 60 * 1000
const FUTURE_CLOCK_SKEW_MS = 60 * 1000

export interface IntegrationOAuthStatePayload {
  propertyId: string
  provider: IntegrationProvider
  capabilities: IntegrationCapability[]
  authSource: IntegrationAuthSource
  timestamp: number
  profileId?: string
  inviteId?: string
  tokenHash?: string
  returnPath?: string
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const padding = (4 - (value.length % 4)) % 4
  return Buffer.from(
    (value + '='.repeat(padding)).replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf-8')
}

function getStateSecret(): string {
  const secret =
    process.env.INTEGRATION_OAUTH_STATE_SECRET ||
    process.env.GMAIL_OAUTH_STATE_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.MICROSOFT_CLIENT_SECRET

  if (!secret) {
    throw new Error('Missing integration OAuth state secret')
  }

  return secret
}

function sign(encodedPayload: string): string {
  return encodeBase64Url(
    createHmac('sha256', getStateSecret()).update(encodedPayload).digest('hex')
  )
}

export function createSignedIntegrationOAuthState(
  payload: Omit<IntegrationOAuthStatePayload, 'timestamp'> & { timestamp?: number }
): string {
  const normalizedPayload: IntegrationOAuthStatePayload = {
    ...payload,
    timestamp: payload.timestamp ?? Date.now(),
    capabilities: [...new Set(payload.capabilities)],
  }

  const encodedPayload = encodeBase64Url(JSON.stringify(normalizedPayload))
  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifySignedIntegrationOAuthState(
  state: string,
  now = Date.now()
): IntegrationOAuthStatePayload {
  const [encodedPayload, encodedSignature, ...extraParts] = state.split('.')
  if (!encodedPayload || !encodedSignature || extraParts.length > 0) {
    throw new Error('Invalid OAuth state format')
  }

  const expectedSignature = sign(encodedPayload)
  const providedSignature = Buffer.from(encodedSignature, 'utf-8')
  const actualSignature = Buffer.from(expectedSignature, 'utf-8')
  if (
    providedSignature.length !== actualSignature.length ||
    !timingSafeEqual(providedSignature, actualSignature)
  ) {
    throw new Error('Invalid OAuth state signature')
  }

  const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<IntegrationOAuthStatePayload>
  const provider = normalizeProvider(parsed.provider)
  const capabilities = normalizeCapabilities(parsed.capabilities)

  if (
    typeof parsed.propertyId !== 'string' ||
    !provider ||
    capabilities.length === 0 ||
    (parsed.authSource !== 'dashboard' && parsed.authSource !== 'external_invite') ||
    typeof parsed.timestamp !== 'number'
  ) {
    throw new Error('Invalid OAuth state payload')
  }

  if (parsed.timestamp > now + FUTURE_CLOCK_SKEW_MS) {
    throw new Error('OAuth state timestamp is invalid')
  }

  if (now - parsed.timestamp > STATE_TTL_MS) {
    throw new Error('OAuth state has expired')
  }

  return {
    propertyId: parsed.propertyId,
    provider,
    capabilities,
    authSource: parsed.authSource,
    timestamp: parsed.timestamp,
    profileId: typeof parsed.profileId === 'string' ? parsed.profileId : undefined,
    inviteId: typeof parsed.inviteId === 'string' ? parsed.inviteId : undefined,
    tokenHash: typeof parsed.tokenHash === 'string' ? parsed.tokenHash : undefined,
    returnPath: typeof parsed.returnPath === 'string' ? parsed.returnPath : undefined,
  }
}
