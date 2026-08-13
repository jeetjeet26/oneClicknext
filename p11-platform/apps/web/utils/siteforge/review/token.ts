import { createHash, randomBytes } from 'node:crypto'

const REVIEW_TOKEN_PREFIX = 'sfr_'
const REVIEW_TOKEN_PATTERN = /^sfr_[A-Za-z0-9_-]{43}$/

export function generateReviewToken(): string {
  return `${REVIEW_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function hashReviewToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isReviewToken(token: string): boolean {
  return REVIEW_TOKEN_PATTERN.test(token)
}

export function reviewTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization) return null
  const match = authorization.match(/^Bearer ([^\s]+)$/)
  return match && isReviewToken(match[1]) ? match[1] : null
}
