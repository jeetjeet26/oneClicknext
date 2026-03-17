import { createHmac, timingSafeEqual } from 'node:crypto'

const STATE_TTL_MS = 15 * 60 * 1000
const FUTURE_CLOCK_SKEW_MS = 60 * 1000

export interface GmailOAuthStatePayload {
  propertyId: string
  profileId: string
  timestamp: number
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
  const normalized = (value + '='.repeat(padding))
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  return Buffer.from(normalized, 'base64').toString('utf-8')
}

function getStateSecret(): string {
  const secret =
    process.env.GMAIL_OAUTH_STATE_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET

  if (!secret) {
    throw new Error('Missing Gmail OAuth state secret')
  }

  return secret
}

function sign(encodedPayload: string): string {
  return encodeBase64Url(
    createHmac('sha256', getStateSecret()).update(encodedPayload).digest('hex')
  )
}

export function createSignedGmailOAuthState(
  payload: Omit<GmailOAuthStatePayload, 'timestamp'> & { timestamp?: number }
): string {
  const normalizedPayload: GmailOAuthStatePayload = {
    propertyId: payload.propertyId,
    profileId: payload.profileId,
    timestamp: payload.timestamp ?? Date.now(),
  }

  const encodedPayload = encodeBase64Url(JSON.stringify(normalizedPayload))
  const signature = sign(encodedPayload)

  return `${encodedPayload}.${signature}`
}

export function verifySignedGmailOAuthState(
  state: string,
  now = Date.now()
): GmailOAuthStatePayload {
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

  const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<GmailOAuthStatePayload>

  if (
    typeof parsed.propertyId !== 'string' ||
    typeof parsed.profileId !== 'string' ||
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
    profileId: parsed.profileId,
    timestamp: parsed.timestamp,
  }
}
