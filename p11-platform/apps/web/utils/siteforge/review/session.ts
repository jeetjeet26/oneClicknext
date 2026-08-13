import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ReviewPermission } from './contracts'
import { SiteForgeReviewError } from './service'

export const REVIEW_SESSION_COOKIE = '__Host-siteforge_review'
export const REVIEW_SESSION_MAX_ATTEMPTS = 120
export const REVIEW_SESSION_WINDOW_MS = 5 * 60_000

export type ReviewSessionPayload = {
  version: 1
  tokenId: string
  reviewSessionId: string
  permissions: ReviewPermission[]
  expiresAt: string
  windowStartedAt: number
  attempts: number
}

function sessionSecret(): string {
  const secret =
    process.env.SITEFORGE_REVIEW_SESSION_SECRET ||
    process.env.SITEFORGE_OVERLAY_SIGNING_SECRET
  if (!secret || secret.length < 32) {
    throw new SiteForgeReviewError(
      'Review access is temporarily unavailable',
      503,
      'session_configuration_error'
    )
  }
  return secret
}

function signature(encoded: string, secret = sessionSecret()): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url')
}

export function hashReviewRateLimitClient(
  rateLimitKey: string,
  secret = sessionSecret()
): string {
  return createHmac('sha256', secret)
    .update('siteforge-public-review-rate-limit\0')
    .update(rateLimitKey)
    .digest('hex')
}

export function signReviewSession(
  payload: ReviewSessionPayload,
  secret = sessionSecret()
): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${signature(encoded, secret)}`
}

export function verifyReviewSession(
  value: string,
  secret = sessionSecret()
): ReviewSessionPayload {
  const [encoded, provided, extra] = value.split('.')
  if (!encoded || !provided || extra) {
    throw new SiteForgeReviewError(
      'Review session is invalid',
      401,
      'invalid_session'
    )
  }
  const actual = Buffer.from(provided)
  const expected = Buffer.from(signature(encoded, secret))
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new SiteForgeReviewError(
      'Review session is invalid',
      401,
      'invalid_session'
    )
  }

  let payload: ReviewSessionPayload
  try {
    payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as ReviewSessionPayload
  } catch {
    throw new SiteForgeReviewError(
      'Review session is invalid',
      401,
      'invalid_session'
    )
  }
  if (
    payload.version !== 1 ||
    !payload.tokenId ||
    !payload.reviewSessionId ||
    !Array.isArray(payload.permissions) ||
    !Number.isSafeInteger(payload.windowStartedAt) ||
    !Number.isSafeInteger(payload.attempts) ||
    payload.attempts < 0 ||
    !Number.isFinite(Date.parse(payload.expiresAt))
  ) {
    throw new SiteForgeReviewError(
      'Review session is invalid',
      401,
      'invalid_session'
    )
  }
  if (Date.parse(payload.expiresAt) <= Date.now()) {
    throw new SiteForgeReviewError(
      'Review session has expired',
      410,
      'expired_session'
    )
  }
  return payload
}

export function consumeReviewSessionAttempt(
  payload: ReviewSessionPayload,
  now = Date.now()
): ReviewSessionPayload {
  const current =
    now - payload.windowStartedAt >= REVIEW_SESSION_WINDOW_MS
      ? { ...payload, windowStartedAt: now, attempts: 0 }
      : payload
  if (current.attempts >= REVIEW_SESSION_MAX_ATTEMPTS) {
    throw new SiteForgeReviewError(
      'Too many review requests',
      429,
      'rate_limited'
    )
  }
  return { ...current, attempts: current.attempts + 1 }
}

export function assertReviewSessionAttemptAvailable(
  payload: ReviewSessionPayload,
  now = Date.now()
): void {
  if (
    now - payload.windowStartedAt < REVIEW_SESSION_WINDOW_MS &&
    payload.attempts >= REVIEW_SESSION_MAX_ATTEMPTS
  ) {
    throw new SiteForgeReviewError(
      'Too many review requests',
      429,
      'rate_limited'
    )
  }
}

export function reviewSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
  }
}

export function reviewSessionCookieFromRequest(request: Request): string | null {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === REVIEW_SESSION_COOKIE) {
      return value.join('=') || null
    }
  }
  return null
}
