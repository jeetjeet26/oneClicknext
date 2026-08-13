import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ReviewArtifact,
  ReviewRepository,
  ReviewSessionRow,
  ReviewTokenRow,
} from './repository'
import {
  authorizeReviewSession,
  exchangeReviewToken,
  reviewSessionAttemptLimit,
} from './access'
import {
  REVIEW_SESSION_COOKIE,
  REVIEW_SESSION_WINDOW_MS,
  hashReviewRateLimitClient,
  reviewSessionCookieOptions,
  signReviewSession,
  verifyReviewSession,
} from './session'
import type {
  PublicReviewRateLimitInput,
  PublicReviewRateLimitStore,
} from './service'
import { hashReviewToken } from './token'

const rawToken = 'sfr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const tokenId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const websiteId = '33333333-3333-4333-8333-333333333333'
const propertyId = '44444444-4444-4444-8444-444444444444'
const orgId = '55555555-5555-4555-8555-555555555555'
const artifactId = '66666666-6666-4666-8666-666666666666'
const contentHash = 'a'.repeat(64)

const allowingStore: PublicReviewRateLimitStore = {
  async consume() {
    return {
      allowed: true,
      remaining: 119,
      resetAt: new Date(Date.now() + REVIEW_SESSION_WINDOW_MS).toISOString(),
    }
  },
}

function durableRateLimitBackend(maxAttempts: number) {
  let now = Date.now()
  const windows = new Map<
    string,
    { windowStartedAt: number; requestCount: number }
  >()
  const recordedInputs: PublicReviewRateLimitInput[] = []

  const createStore = (): PublicReviewRateLimitStore => ({
    async consume(input) {
      recordedInputs.push(structuredClone(input))
      const key = [
        input.reviewSessionId,
        input.reviewTokenId,
        input.clientHash,
      ].join(':')
      const previous = windows.get(key)
      const current =
        !previous ||
        now - previous.windowStartedAt >= REVIEW_SESSION_WINDOW_MS
          ? { windowStartedAt: now, requestCount: 1 }
          : {
              windowStartedAt: previous.windowStartedAt,
              requestCount: Math.min(
                previous.requestCount + 1,
                maxAttempts + 1
              ),
            }
      windows.set(key, current)
      return {
        allowed: current.requestCount <= maxAttempts,
        remaining: Math.max(maxAttempts - current.requestCount, 0),
        resetAt: new Date(
          current.windowStartedAt + REVIEW_SESSION_WINDOW_MS
        ).toISOString(),
      }
    },
  })

  return {
    createStore,
    recordedInputs,
    advance(milliseconds: number) {
      now += milliseconds
    },
  }
}

function fixture() {
  const session: ReviewSessionRow = {
    id: sessionId,
    org_id: orgId,
    property_id: propertyId,
    website_id: websiteId,
    artifact_id: artifactId,
    artifact_content_hash: contentHash,
    status: 'open',
    title: 'Client review',
    instructions: null,
    client_safe_summary: {},
    opened_by: null,
    opened_at: new Date().toISOString(),
    closes_at: null,
    closed_at: null,
  }
  const token: ReviewTokenRow = {
    id: tokenId,
    review_session_id: sessionId,
    org_id: orgId,
    property_id: propertyId,
    website_id: websiteId,
    token_hash: hashReviewToken(rawToken),
    reviewer_name: 'Client',
    reviewer_email: 'client@example.com',
    permissions: ['view', 'comment', 'decide'],
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    revoked_at: null,
    last_used_at: null,
    created_by: null,
    created_at: new Date().toISOString(),
  }
  const artifact: ReviewArtifact = {
    id: artifactId,
    websiteId,
    propertyId,
    orgId,
    version: 1,
    contentHash,
    blueprint: { pages: [] },
  }
  const repository: Pick<
    ReviewRepository,
    | 'getTokenByHash'
    | 'getToken'
    | 'claimToken'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'updateToken'
    | 'updateSession'
  > = {
    async getTokenByHash(hash) {
      return hash === token.token_hash ? token : null
    },
    async getToken(id) {
      return id === token.id ? token : null
    },
    async claimToken(id, claimedAt) {
      if (id !== token.id || token.last_used_at) return null
      token.last_used_at = claimedAt
      return token
    },
    async getSession(id) {
      return id === session.id ? session : null
    },
    async getWebsiteCurrentArtifact(id) {
      return id === websiteId ? artifact : null
    },
    async updateToken(_id, input) {
      Object.assign(token, input)
      return token
    },
    async updateSession(_id, input) {
      Object.assign(session, input)
      return session
    },
  }
  return { repository, session, token }
}

describe('SiteForge public review access boundary', () => {
  beforeEach(() => {
    vi.stubEnv('SITEFORGE_REVIEW_SESSION_SECRET', 'r'.repeat(48))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('exchanges a raw token for a scoped HttpOnly session without serializing it', async () => {
    const { repository } = fixture()
    const access = await exchangeReviewToken(
      rawToken,
      `exchange:${crypto.randomUUID()}`,
      repository,
      allowingStore
    )
    const payload = verifyReviewSession(access.sessionCookie)

    expect(payload).toMatchObject({
      tokenId,
      reviewSessionId: sessionId,
      attempts: 0,
    })
    expect(access.sessionCookie).not.toContain(rawToken)
    expect(JSON.stringify(payload)).not.toContain(rawToken)
    expect(REVIEW_SESSION_COOKIE).toBe('__Host-siteforge_review')
    expect(reviewSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    })
    await expect(
      exchangeReviewToken(
        rawToken,
        `exchange:${crypto.randomUUID()}`,
        repository,
        allowingStore
      )
    ).rejects.toMatchObject({
      code: 'token_already_exchanged',
      statusCode: 410,
    })
  })

  it('rechecks token expiry and revocation after exchange', async () => {
    const { repository, token } = fixture()
    const access = await exchangeReviewToken(
      rawToken,
      `exchange:${crypto.randomUUID()}`,
      repository,
      allowingStore
    )

    token.revoked_at = new Date().toISOString()
    await expect(
      authorizeReviewSession(
        access.sessionCookie,
        'view',
        `session:${crypto.randomUUID()}`,
        {},
        repository,
        allowingStore
      )
    ).rejects.toMatchObject({ code: 'revoked_token', statusCode: 410 })

    token.revoked_at = null
    token.expires_at = new Date(Date.now() - 1_000).toISOString()
    await expect(
      authorizeReviewSession(
        access.sessionCookie,
        'view',
        `session:${crypto.randomUUID()}`,
        {},
        repository,
        allowingStore
      )
    ).rejects.toMatchObject({ code: 'expired_token', statusCode: 410 })
  })

  it('enforces one signed attempt budget for page and API validation', async () => {
    const { repository, token } = fixture()
    const exhausted = signReviewSession({
      version: 1,
      tokenId,
      reviewSessionId: sessionId,
      permissions: ['view', 'comment', 'decide'],
      expiresAt: token.expires_at,
      windowStartedAt: Date.now(),
      attempts: reviewSessionAttemptLimit(),
    })

    await expect(
      authorizeReviewSession(
        exhausted,
        'view',
        `page:${crypto.randomUUID()}`,
        { consumeAttempt: false },
        repository
      )
    ).rejects.toMatchObject({ code: 'rate_limited', statusCode: 429 })
    await expect(
      authorizeReviewSession(
        exhausted,
        'view',
        `api:${crypto.randomUUID()}`,
        {},
        repository
      )
    ).rejects.toMatchObject({ code: 'rate_limited', statusCode: 429 })
  })

  it('retains shared IP protection around the signed-counter fallback', async () => {
    const { repository } = fixture()
    const rateKey = `replay-limitation:${crypto.randomUUID()}`
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await exchangeReviewToken('invalid', rateKey, repository).catch(() => null)
    }
    await expect(
      exchangeReviewToken('invalid', rateKey, repository)
    ).rejects.toMatchObject({ code: 'rate_limited', statusCode: 429 })
  })

  it('enforces one durable quota across instances and replayed cookies', async () => {
    const { repository } = fixture()
    const backend = durableRateLimitBackend(3)
    const rateLimitKey = 'siteforge-client-review:203.0.113.11'
    const original = await exchangeReviewToken(
      rawToken,
      rateLimitKey,
      repository,
      backend.createStore()
    )

    await authorizeReviewSession(
      original.sessionCookie,
      'view',
      rateLimitKey,
      {},
      repository,
      backend.createStore()
    )
    await authorizeReviewSession(
      original.sessionCookie,
      'view',
      rateLimitKey,
      {},
      repository,
      backend.createStore()
    )
    await expect(
      authorizeReviewSession(
        original.sessionCookie,
        'view',
        rateLimitKey,
        {},
        repository,
        backend.createStore()
      )
    ).rejects.toMatchObject({ code: 'rate_limited', statusCode: 429 })
  })

  it('resets durable windows without changing token or session scope', async () => {
    const { repository } = fixture()
    const backend = durableRateLimitBackend(2)
    const rateLimitKey = 'siteforge-client-review:203.0.113.12'
    const original = await exchangeReviewToken(
      rawToken,
      rateLimitKey,
      repository,
      backend.createStore()
    )

    await authorizeReviewSession(
      original.sessionCookie,
      'view',
      rateLimitKey,
      {},
      repository,
      backend.createStore()
    )
    await expect(
      authorizeReviewSession(
        original.sessionCookie,
        'view',
        rateLimitKey,
        {},
        repository,
        backend.createStore()
      )
    ).rejects.toMatchObject({ code: 'rate_limited' })

    backend.advance(REVIEW_SESSION_WINDOW_MS)
    await expect(
      authorizeReviewSession(
        original.sessionCookie,
        'view',
        rateLimitKey,
        {},
        repository,
        backend.createStore()
      )
    ).resolves.toMatchObject({ credential: { session: { id: sessionId } } })
  })

  it('scopes durable counters by token, session, and client hash only', async () => {
    const backend = durableRateLimitBackend(1)
    const storeA = backend.createStore()
    const clientHashA = hashReviewRateLimitClient(
      'siteforge-client-review:203.0.113.13',
      'h'.repeat(48)
    )
    const clientHashB = hashReviewRateLimitClient(
      'siteforge-client-review:203.0.113.14',
      'h'.repeat(48)
    )
    const base = {
      reviewSessionId: sessionId,
      reviewTokenId: tokenId,
      clientHash: clientHashA,
    }

    expect((await storeA.consume(base)).allowed).toBe(true)
    expect((await backend.createStore().consume(base)).allowed).toBe(false)
    expect(
      (
        await backend.createStore().consume({
          ...base,
          reviewTokenId: '77777777-7777-4777-8777-777777777777',
        })
      ).allowed
    ).toBe(true)
    expect(
      (
        await backend.createStore().consume({
          ...base,
          reviewSessionId: '88888888-8888-4888-8888-888888888888',
        })
      ).allowed
    ).toBe(true)
    expect(
      (
        await backend.createStore().consume({
          ...base,
          clientHash: clientHashB,
        })
      ).allowed
    ).toBe(true)
  })

  it('persists no raw token or client address in limiter inputs', async () => {
    const { repository } = fixture()
    const backend = durableRateLimitBackend(5)
    const rateLimitKey = 'siteforge-client-review:203.0.113.15'
    await exchangeReviewToken(
      rawToken,
      rateLimitKey,
      repository,
      backend.createStore()
    )

    expect(backend.recordedInputs).toEqual([
      {
        reviewSessionId: sessionId,
        reviewTokenId: tokenId,
        clientHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ])
    expect(JSON.stringify(backend.recordedInputs)).not.toContain(rawToken)
    expect(JSON.stringify(backend.recordedInputs)).not.toContain('203.0.113.15')
  })

  it('declares validated website tenant and private limiter invariants', async () => {
    const migration = await readFile(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260811060315_finish_siteforge_director_invariants.sql'
      ),
      'utf8'
    )

    expect(migration).toMatch(
      /foreign key \(property_id, org_id\)\s+references public\.properties \(id, org_id\)/i
    )
    expect(migration).toMatch(
      /validate constraint property_websites_property_tenant_fkey/i
    )
    expect(migration).toMatch(
      /primary key \(review_session_id, review_token_id, client_hash\)/i
    )
    expect(migration).toMatch(
      /revoke all on function public\.consume_siteforge_public_review_rate_limit[\s\S]*from public, anon, authenticated/i
    )
  })
})
