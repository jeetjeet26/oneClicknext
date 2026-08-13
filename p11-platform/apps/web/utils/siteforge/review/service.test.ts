import { describe, expect, it } from 'vitest'
import type { Json } from '@/types/supabase'
import type {
  ClientDecisionRow,
  ReviewArtifact,
  ReviewCommentRow,
  ReviewRepository,
  ReviewSessionRow,
  ReviewTokenRow,
  RevisionRoundRow,
} from './repository'
import { ReviewRepositoryConflictError } from './repository'
import {
  addClientComment,
  createReviewSession,
  createRevisionRound,
  getPublicReviewData,
  issueReviewToken,
  recordClientDecision,
  SiteForgeReviewError,
  updateCommentTrace,
  validateReviewCredential,
} from './service'
import { hashReviewToken } from './token'

const websiteId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'
const orgId = '33333333-3333-4333-8333-333333333333'
const profileId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const secondArtifactId = '66666666-6666-4666-8666-666666666666'
const contentHash = 'a'.repeat(64)
const secondContentHash = 'b'.repeat(64)
const certificationId = '99999999-9999-4999-8999-999999999998'
const canonicalUrl = 'https://preview.example.com'

function decisionIdentity() {
  return {
    artifactId,
    contentHash,
    certificationId,
    canonicalUrl,
  }
}

function makeArtifact(
  id = artifactId,
  hash = contentHash,
  version = 1
): ReviewArtifact {
  return {
    id,
    websiteId,
    propertyId,
    orgId,
    version,
    contentHash: hash,
    blueprint: {
      pages: [
        {
          slug: 'home',
          title: 'Home',
          purpose: 'internal planning detail',
          sections: [
            {
              id: 'hero',
              type: 'hero',
              acfBlock: 'acf/top-slides',
              reasoning: 'internal reasoning',
              order: 1,
              content: {
                heading: 'Welcome',
                provider: 'internal-provider',
                contentHash,
              },
            },
          ],
        },
      ],
    },
  }
}

function createMemoryRepository() {
  let sequence = 0
  const nextId = () =>
    `70000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  const artifacts = new Map<string, ReviewArtifact>([
    [artifactId, makeArtifact()],
    [
      secondArtifactId,
      makeArtifact(secondArtifactId, secondContentHash, 2),
    ],
  ])
  let currentArtifact = artifacts.get(artifactId)!
  const sessions = new Map<string, ReviewSessionRow>()
  const tokens = new Map<string, ReviewTokenRow>()
  const comments = new Map<string, ReviewCommentRow>()
  const rounds = new Map<string, RevisionRoundRow>()
  const decisions = new Map<string, ClientDecisionRow>()
  const now = new Date().toISOString()

  const repository: ReviewRepository = {
    async getWebsite(id) {
      return id === websiteId
        ? {
            id: websiteId,
            propertyId,
            orgId,
            currentArtifactId: currentArtifact.id,
          }
        : null
    },
    async getWebsiteCurrentArtifact(id) {
      return id === websiteId ? currentArtifact : null
    },
    async getArtifact(id, scopedWebsiteId) {
      const artifact = artifacts.get(id)
      return artifact?.websiteId === scopedWebsiteId ? artifact : null
    },
    async getCanonicalReviewRelease(scopedWebsiteId, scopedArtifactId) {
      return scopedWebsiteId === websiteId && scopedArtifactId === artifactId
        ? {
            ...decisionIdentity(),
            url: canonicalUrl,
            previewedAt: now,
            certificationPolicy: 'siteforge-certification-v3',
            certificationReportHash: 'c'.repeat(64),
            certifiedAt: now,
          }
        : null
    },
    async getProfileOrg(id) {
      return id === profileId ? orgId : null
    },
    async createSession(input) {
      const row: ReviewSessionRow = {
        id: input.id || nextId(),
        org_id: input.org_id,
        property_id: input.property_id,
        website_id: input.website_id,
        artifact_id: input.artifact_id,
        artifact_content_hash: input.artifact_content_hash,
        status: input.status || 'open',
        title: input.title,
        instructions: input.instructions || null,
        client_safe_summary: input.client_safe_summary || {},
        opened_by: input.opened_by || null,
        opened_at: input.opened_at || now,
        closes_at: input.closes_at || null,
        closed_at: input.closed_at || null,
      }
      sessions.set(row.id, row)
      return row
    },
    async getSession(id) {
      return sessions.get(id) || null
    },
    async listSessions(id) {
      return [...sessions.values()].filter(session => session.website_id === id)
    },
    async updateSession(id, input) {
      const row = { ...sessions.get(id)!, ...input } as ReviewSessionRow
      sessions.set(id, row)
      return row
    },
    async createToken(input) {
      const row: ReviewTokenRow = {
        id: input.id || nextId(),
        review_session_id: input.review_session_id,
        org_id: input.org_id,
        property_id: input.property_id,
        website_id: input.website_id,
        token_hash: input.token_hash,
        reviewer_name: input.reviewer_name || null,
        reviewer_email: input.reviewer_email || null,
        permissions: input.permissions || ['view', 'comment', 'decide'],
        expires_at: input.expires_at,
        revoked_at: input.revoked_at || null,
        last_used_at: input.last_used_at || null,
        created_by: input.created_by || null,
        created_at: input.created_at || now,
      }
      tokens.set(row.id, row)
      return row
    },
    async getToken(id) {
      return tokens.get(id) || null
    },
    async getTokenByHash(hash) {
      return [...tokens.values()].find(token => token.token_hash === hash) || null
    },
    async claimToken(id, claimedAt) {
      const token = tokens.get(id)
      if (!token || token.last_used_at) return null
      const claimed = { ...token, last_used_at: claimedAt }
      tokens.set(id, claimed)
      return claimed
    },
    async listTokens(sessionId) {
      return [...tokens.values()].filter(
        token => token.review_session_id === sessionId
      )
    },
    async updateToken(id, input) {
      const row = { ...tokens.get(id)!, ...input } as ReviewTokenRow
      tokens.set(id, row)
      return row
    },
    async createComment(input) {
      const row: ReviewCommentRow = {
        id: input.id || nextId(),
        review_session_id: input.review_session_id,
        revision_round_id: input.revision_round_id || null,
        org_id: input.org_id,
        property_id: input.property_id,
        website_id: input.website_id,
        artifact_id: input.artifact_id,
        parent_comment_id: input.parent_comment_id || null,
        author_type: input.author_type,
        author_profile_id: input.author_profile_id || null,
        author_name: input.author_name || null,
        author_email: input.author_email || null,
        page_path: input.page_path,
        section_id: input.section_id || null,
        viewport: input.viewport || null,
        anchor: input.anchor || {},
        body: input.body,
        category: input.category || 'general',
        status: input.status || 'open',
        disposition_reason: input.disposition_reason || null,
        semantic_operations: input.semantic_operations || [],
        resulting_artifact_id: input.resulting_artifact_id || null,
        created_at: input.created_at || now,
        updated_at: input.updated_at || now,
      }
      comments.set(row.id, row)
      return row
    },
    async getComment(id) {
      return comments.get(id) || null
    },
    async listComments(sessionId) {
      return [...comments.values()].filter(
        comment => comment.review_session_id === sessionId
      )
    },
    async updateComment(id, input) {
      const row = { ...comments.get(id)!, ...input } as ReviewCommentRow
      comments.set(id, row)
      return row
    },
    async assignUnscopedCommentsToRound(sessionId, scopedArtifactId, roundId) {
      for (const [id, comment] of comments) {
        if (
          comment.review_session_id === sessionId &&
          comment.artifact_id === scopedArtifactId &&
          !comment.revision_round_id
        ) {
          comments.set(id, { ...comment, revision_round_id: roundId })
        }
      }
    },
    async createRound(input) {
      if (
        (input.id && rounds.has(input.id)) ||
        [...rounds.values()].some(
          round =>
            round.review_session_id === input.review_session_id &&
            round.round_number === input.round_number
        )
      ) {
        throw new ReviewRepositoryConflictError('Create revision round')
      }
      const row: RevisionRoundRow = {
        id: input.id || nextId(),
        review_session_id: input.review_session_id,
        org_id: input.org_id,
        property_id: input.property_id,
        website_id: input.website_id,
        round_number: input.round_number,
        status: input.status || 'collecting',
        requested_by_name: input.requested_by_name || null,
        requested_by_email: input.requested_by_email || null,
        assigned_to: input.assigned_to || null,
        due_at: input.due_at || null,
        resulting_artifact_id: input.resulting_artifact_id || null,
        resulting_content_hash: input.resulting_content_hash || null,
        created_at: input.created_at || now,
        updated_at: input.updated_at || now,
      }
      rounds.set(row.id, row)
      return row
    },
    async getRound(id) {
      return rounds.get(id) || null
    },
    async listRounds(sessionId) {
      return [...rounds.values()].filter(
        round => round.review_session_id === sessionId
      )
    },
    async updateRound(id, input) {
      const row = { ...rounds.get(id)!, ...input } as RevisionRoundRow
      rounds.set(id, row)
      return row
    },
    async createDecision(input) {
      if (input.id && decisions.has(input.id)) {
        throw new ReviewRepositoryConflictError(
          'Create client review decision'
        )
      }
      const row: ClientDecisionRow = {
        id: input.id || nextId(),
        review_session_id: input.review_session_id,
        review_token_id: input.review_token_id || null,
        org_id: input.org_id,
        property_id: input.property_id,
        website_id: input.website_id,
        artifact_id: input.artifact_id,
        artifact_content_hash: input.artifact_content_hash,
        certification_evidence_id: input.certification_evidence_id || null,
        certification_report_hash: input.certification_report_hash || null,
        canonical_url: input.canonical_url || null,
        certified_at: input.certified_at || null,
        decision: input.decision,
        rationale: input.rationale,
        reviewer_name: input.reviewer_name || null,
        reviewer_email: input.reviewer_email || null,
        created_at:
          input.created_at ||
          new Date(Date.now() + decisions.size + 1).toISOString(),
      }
      decisions.set(row.id, row)
      return row
    },
    async getDecision(id) {
      return decisions.get(id) || null
    },
    async listDecisions(sessionId) {
      return [...decisions.values()]
        .filter(decision => decision.review_session_id === sessionId)
        .toSorted((left, right) =>
          right.created_at.localeCompare(left.created_at)
        )
    },
  }

  return {
    repository,
    sessions,
    tokens,
    comments,
    rounds,
    decisions,
    setCurrentArtifact(artifact: ReviewArtifact) {
      currentArtifact = artifact
    },
  }
}

async function createSessionAndToken(
  memory: ReturnType<typeof createMemoryRepository>,
  overrides?: { permissions?: string[]; expiresAt?: string }
) {
  const session = await createReviewSession(
    {
      websiteId,
      artifactId,
      contentHash,
      title: 'Client review',
    },
    profileId,
    memory.repository
  )
  const issued = await issueReviewToken(
    session.id,
    {
      reviewerName: 'Jordan Client',
      reviewerEmail: 'jordan@example.com',
      permissions: overrides?.permissions || ['view', 'comment', 'decide'],
      expiresAt:
        overrides?.expiresAt ||
        new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    },
    profileId,
    memory.repository
  )
  return { session, issued }
}

describe('SiteForge external review service', () => {
  it('binds sessions to the exact current artifact and persists only token hashes', async () => {
    const memory = createMemoryRepository()
    await expect(
      createReviewSession(
        {
          websiteId,
          artifactId,
          contentHash: secondContentHash,
          title: 'Wrong hash',
        },
        profileId,
        memory.repository
      )
    ).rejects.toMatchObject({ code: 'stale_artifact' })

    const { issued } = await createSessionAndToken(memory)
    const stored = [...memory.tokens.values()][0]
    expect(stored.token_hash).toBe(hashReviewToken(issued.rawToken))
    expect(stored.token_hash).not.toContain(issued.rawToken)
    expect(JSON.stringify(stored)).not.toContain(issued.rawToken)
  })

  it('rejects expired, revoked, and cross-tenant credentials', async () => {
    const expiredMemory = createMemoryRepository()
    const expiredSession = await createReviewSession(
      { websiteId, artifactId, contentHash, title: 'Expired token test' },
      profileId,
      expiredMemory.repository
    )
    const expiredRawToken = 'sfr_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    await expiredMemory.repository.createToken({
      review_session_id: expiredSession.id,
      org_id: orgId,
      property_id: propertyId,
      website_id: websiteId,
      token_hash: hashReviewToken(expiredRawToken),
      permissions: ['view'],
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    })
    await expect(
      validateReviewCredential(
        expiredRawToken,
        'view',
        expiredMemory.repository
      )
    ).rejects.toMatchObject({ code: 'expired_token' })

    const memory = createMemoryRepository()
    const { issued } = await createSessionAndToken(memory)
    const token = [...memory.tokens.values()][0]
    await memory.repository.updateToken(token.id, {
      revoked_at: new Date().toISOString(),
    })
    await expect(
      validateReviewCredential(issued.rawToken, 'view', memory.repository)
    ).rejects.toMatchObject({ code: 'revoked_token' })

    await memory.repository.updateToken(token.id, {
      revoked_at: null,
      org_id: '88888888-8888-4888-8888-888888888888',
    })
    await expect(
      validateReviewCredential(issued.rawToken, 'view', memory.repository)
    ).rejects.toMatchObject({ code: 'scope_mismatch', statusCode: 403 })
  })

  it('invalidates approval and write access when the current artifact changes', async () => {
    const memory = createMemoryRepository()
    const { session, issued } = await createSessionAndToken(memory)
    await recordClientDecision(
      issued.rawToken,
      {
        decision: 'approved',
        rationale: 'Approved as shown.',
        ...decisionIdentity(),
      },
      memory.repository
    )
    memory.setCurrentArtifact(makeArtifact(secondArtifactId, secondContentHash, 2))

    const staleReview = await getPublicReviewData(
      issued.rawToken,
      memory.repository
    )
    expect(staleReview.artifact.isCurrent).toBe(false)
    expect(staleReview.clientApproval?.validForCurrentArtifact).toBe(false)
    expect(memory.sessions.get(session.id)?.status).toBe('superseded')
    await expect(
      addClientComment(
        issued.rawToken,
        { pagePath: '/home', body: 'Change this old revision.' },
        memory.repository
      )
    ).rejects.toMatchObject({ code: 'stale_artifact' })
  })

  it('creates page and section-scoped threaded comments', async () => {
    const memory = createMemoryRepository()
    const { issued } = await createSessionAndToken(memory)
    const root = await addClientComment(
      issued.rawToken,
      {
        pagePath: '/home',
        sectionId: 'hero',
        viewport: 'mobile',
        category: 'copy',
        body: 'Make this headline clearer.',
      },
      memory.repository
    )
    const reply = await addClientComment(
      issued.rawToken,
      {
        pagePath: '/home',
        sectionId: 'hero',
        parentCommentId: root.id,
        body: 'Use the approved value proposition.',
      },
      memory.repository
    )
    expect(reply.parent_comment_id).toBe(root.id)
    expect(reply.org_id).toBe(orgId)
    await expect(
      addClientComment(
        issued.rawToken,
        {
          pagePath: '/hidden-admin',
          body: 'This path is not in the reviewed artifact.',
        },
        memory.repository
      )
    ).rejects.toMatchObject({ code: 'invalid_comment_scope' })
  })

  it('records client decisions separately and creates numbered change rounds', async () => {
    const memory = createMemoryRepository()
    const { session, issued } = await createSessionAndToken(memory)
    const comment = await addClientComment(
      issued.rawToken,
      { pagePath: '/home', body: 'Please revise the hero.' },
      memory.repository
    )
    const requested = await recordClientDecision(
      issued.rawToken,
      {
        decision: 'changes_requested',
        rationale: 'The hero copy needs another pass.',
        ...decisionIdentity(),
      },
      memory.repository
    )
    expect(requested.round?.round_number).toBe(1)
    expect(memory.comments.get(comment.id)?.revision_round_id).toBe(
      requested.round?.id
    )

    const approved = await recordClientDecision(
      issued.rawToken,
      {
        decision: 'approved_with_notes',
        rationale: 'Approved for client purposes with the noted follow-up.',
        ...decisionIdentity(),
      },
      memory.repository
    )
    expect(approved.decision.review_session_id).toBe(session.id)
    expect(approved.decision).not.toHaveProperty('deployment_decision')
    expect(approved.decision).toMatchObject({
      certification_evidence_id: certificationId,
      certification_report_hash: 'c'.repeat(64),
      canonical_url: canonicalUrl,
      certified_at: expect.any(String),
    })
    const publicReview = await getPublicReviewData(
      issued.rawToken,
      memory.repository
    )
    expect(publicReview.clientApproval).toMatchObject({
      decision: 'approved_with_notes',
      validForCurrentArtifact: true,
    })
    expect(publicReview.canonicalRelease).toMatchObject({
      artifactId,
      contentHash,
      certificationId,
      url: canonicalUrl,
      exact: true,
    })
    const serializedPreview = JSON.stringify(publicReview.preview)
    expect(serializedPreview).not.toContain('internal-provider')
    expect(serializedPreview).not.toContain(contentHash)
    expect(serializedPreview).not.toContain('internal reasoning')
  })

  it('rejects a decision for any other canonical certification identity', async () => {
    const memory = createMemoryRepository()
    const { issued } = await createSessionAndToken(memory)
    await expect(
      recordClientDecision(
        issued.rawToken,
        {
          decision: 'approved',
          rationale: 'Approved only if this exact release is shown.',
          ...decisionIdentity(),
          certificationId: '88888888-8888-4888-8888-888888888888',
        },
        memory.repository
      )
    ).rejects.toMatchObject({ code: 'canonical_release_mismatch' })
    expect(memory.decisions.size).toBe(0)
  })

  it('converges duplicate and concurrent decision retries', async () => {
    const memory = createMemoryRepository()
    const { session, issued } = await createSessionAndToken(memory)
    const changes = {
      decision: 'changes_requested' as const,
      rationale: 'The hero needs one more pass.',
      ...decisionIdentity(),
    }

    const duplicates = await Promise.all(
      Array.from({ length: 8 }, () =>
        recordClientDecision(issued.rawToken, changes, memory.repository)
      )
    )
    expect(new Set(duplicates.map(result => result.decision.id)).size).toBe(1)
    expect(new Set(duplicates.map(result => result.round?.id)).size).toBe(1)
    expect(memory.decisions.size).toBe(1)
    expect(memory.rounds.size).toBe(1)
    expect(memory.sessions.get(session.id)?.status).toBe('changes_requested')

    const approved = await recordClientDecision(
      issued.rawToken,
      {
        decision: 'approved',
        rationale: 'The revised direction is approved.',
        ...decisionIdentity(),
      },
      memory.repository
    )
    await recordClientDecision(issued.rawToken, changes, memory.repository)

    expect(memory.decisions.size).toBe(2)
    expect(memory.rounds.size).toBe(1)
    expect(memory.sessions.get(session.id)?.status).toBe('approved')
    expect([...memory.rounds.values()][0]?.status).toBe('closed')
    expect(approved.decision.decision).toBe('approved')
  })

  it('allocates distinct round numbers for concurrent change decisions', async () => {
    const memory = createMemoryRepository()
    const { issued } = await createSessionAndToken(memory)

    await Promise.all([
      recordClientDecision(
        issued.rawToken,
        {
          decision: 'changes_requested',
          rationale: 'Revise the headline.',
          ...decisionIdentity(),
        },
        memory.repository
      ),
      recordClientDecision(
        issued.rawToken,
        {
          decision: 'changes_requested',
          rationale: 'Replace the supporting image.',
          ...decisionIdentity(),
        },
        memory.repository
      ),
    ])

    expect(memory.decisions.size).toBe(2)
    expect(
      [...memory.rounds.values()]
        .map(round => round.round_number)
        .toSorted((left, right) => left - right)
    ).toEqual([1, 2])
  })

  it('persists comment interpretation, operations, result, and verification trace', async () => {
    const memory = createMemoryRepository()
    const { session, issued } = await createSessionAndToken(memory)
    const round = await createRevisionRound(
      session.id,
      { requestedByName: 'Jordan Client', assignedTo: profileId },
      memory.repository
    )
    const comment = await addClientComment(
      issued.rawToken,
      {
        pagePath: '/home',
        sectionId: 'hero',
        revisionRoundId: round.id,
        body: 'Use more specific leasing language.',
      },
      memory.repository
    )
    const traced = await updateCommentTrace(
      session.id,
      comment.id,
      {
        status: 'verified',
        interpretation: 'Replace generic headline with approved leasing copy.',
        semanticOperations: [
          {
            operation: 'replace_copy',
            target: 'home.hero.heading',
            summary: 'Applied approved value proposition.',
            pagePath: '/home',
            sectionId: 'hero',
          },
        ],
        resultingArtifactId: artifactId,
        resultingContentHash: contentHash,
      },
      memory.repository
    )
    expect(traced).toMatchObject({
      status: 'verified',
      disposition_reason:
        'Replace generic headline with approved leasing copy.',
      resulting_artifact_id: artifactId,
    })
    expect(traced.semantic_operations).toEqual([
      expect.objectContaining({
        operation: 'replace_copy',
        target: 'home.hero.heading',
      }),
    ] as Json)
    expect(memory.rounds.get(round.id)).toMatchObject({
      resulting_artifact_id: artifactId,
      resulting_content_hash: contentHash,
      status: 'ready_for_verification',
    })
  })

  it('enforces assignee tenant scope for revision rounds', async () => {
    const memory = createMemoryRepository()
    const { session } = await createSessionAndToken(memory)
    await expect(
      createRevisionRound(
        session.id,
        {
          requestedByName: 'Jordan Client',
          assignedTo: '99999999-9999-4999-8999-999999999999',
        },
        memory.repository
      )
    ).rejects.toBeInstanceOf(SiteForgeReviewError)
  })
})
