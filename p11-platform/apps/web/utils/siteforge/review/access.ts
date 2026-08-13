import type { ReviewPermission } from './contracts'
import {
  reviewRepository,
  type ReviewRepository,
} from './repository'
import {
  SiteForgeReviewError,
  type PublicReviewRateLimitStore,
  type ValidatedReviewCredential,
  validateReviewCredentialByTokenId,
  validateReviewCredentialForExchange,
} from './service'
import {
  REVIEW_SESSION_MAX_ATTEMPTS,
  assertReviewSessionAttemptAvailable,
  consumeReviewSessionAttempt,
  hashReviewRateLimitClient,
  signReviewSession,
  verifyReviewSession,
  type ReviewSessionPayload,
} from './session'
import { reviewPublicLimiter } from '@/utils/services/rate-limiter'

type CredentialRepository = Pick<
  ReviewRepository,
  | 'getTokenByHash'
  | 'getToken'
  | 'claimToken'
  | 'getSession'
  | 'getWebsiteCurrentArtifact'
  | 'updateToken'
  | 'updateSession'
>

export type ReviewAccessResult = {
  credential: ValidatedReviewCredential
  sessionCookie: string
}

function enforcePublicLimit(rateLimitKey: string) {
  const result = reviewPublicLimiter.check(rateLimitKey)
  if (!result.allowed) {
    throw new SiteForgeReviewError(
      'Too many review requests',
      429,
      'rate_limited'
    )
  }
}

function expiresAtForCredential(
  credential: ValidatedReviewCredential
): string {
  const tokenExpiry = Date.parse(credential.token.expires_at)
  const sessionExpiry = credential.session.closes_at
    ? Date.parse(credential.session.closes_at)
    : Number.POSITIVE_INFINITY
  return new Date(Math.min(tokenExpiry, sessionExpiry)).toISOString()
}

export async function exchangeReviewToken(
  rawToken: string,
  rateLimitKey: string,
  repository: CredentialRepository = reviewRepository,
  rateLimitStore?: PublicReviewRateLimitStore
): Promise<ReviewAccessResult> {
  enforcePublicLimit(rateLimitKey)
  const credential = await validateReviewCredentialForExchange(
    rawToken,
    repository,
    {
      clientHash: hashReviewRateLimitClient(rateLimitKey),
      store: rateLimitStore,
    }
  )
  const claimed = await repository.claimToken(
    credential.token.id,
    new Date().toISOString()
  )
  if (!claimed) {
    throw new SiteForgeReviewError(
      'Review link has already been exchanged',
      410,
      'token_already_exchanged'
    )
  }
  credential.token = claimed
  const payload: ReviewSessionPayload = {
    version: 1,
    tokenId: credential.token.id,
    reviewSessionId: credential.session.id,
    permissions: credential.permissions,
    expiresAt: expiresAtForCredential(credential),
    windowStartedAt: Date.now(),
    attempts: 0,
  }
  return { credential, sessionCookie: signReviewSession(payload) }
}

export async function authorizeReviewSession(
  sessionCookie: string | null,
  requiredPermission: ReviewPermission,
  rateLimitKey: string,
  options: { consumeAttempt?: boolean } = {},
  repository: CredentialRepository = reviewRepository,
  rateLimitStore?: PublicReviewRateLimitStore
): Promise<ReviewAccessResult> {
  enforcePublicLimit(rateLimitKey)
  if (!sessionCookie) {
    throw new SiteForgeReviewError(
      'Review session is missing',
      401,
      'invalid_session'
    )
  }
  const payload = verifyReviewSession(sessionCookie)
  if (!payload.permissions.includes(requiredPermission)) {
    throw new SiteForgeReviewError(
      'Review session does not permit this action',
      403,
      'permission_denied'
    )
  }

  // The signed counter and process-local IP limiter are defense in depth. The
  // durable counter below is authoritative because replaying an older cookie
  // cannot rewind database state.
  let nextPayload = payload
  if (options.consumeAttempt === false) {
    assertReviewSessionAttemptAvailable(payload)
  } else {
    nextPayload = consumeReviewSessionAttempt(payload)
  }
  const credential = await validateReviewCredentialByTokenId(
    payload.tokenId,
    requiredPermission,
    repository,
    {
      clientHash: hashReviewRateLimitClient(rateLimitKey),
      store: rateLimitStore,
    }
  )
  if (credential.session.id !== payload.reviewSessionId) {
    throw new SiteForgeReviewError(
      'Review credential scope does not match',
      403,
      'scope_mismatch'
    )
  }
  const refreshed: ReviewSessionPayload = {
    ...nextPayload,
    permissions: credential.permissions,
    expiresAt: expiresAtForCredential(credential),
  }
  return { credential, sessionCookie: signReviewSession(refreshed) }
}

export function reviewSessionAttemptLimit(): number {
  return REVIEW_SESSION_MAX_ATTEMPTS
}
