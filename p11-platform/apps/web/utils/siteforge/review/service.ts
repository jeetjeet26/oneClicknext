import { createHash } from 'node:crypto'
import type { Json } from '@/types/supabase'
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '@/utils/supabase/config'
import {
  createClientDecisionSchema,
  createReviewCommentSchema,
  createReviewSessionSchema,
  createRevisionRoundSchema,
  issueReviewTokenSchema,
  reviewPermissionSchema,
  updateCommentTraceSchema,
  updateRevisionRoundSchema,
  type PublicReviewData,
  type ReviewDecision,
  type ReviewPermission,
} from './contracts'
import {
  buildClientSafePreview,
  previewContainsScope,
  redactInternalReviewText,
  sanitizeClientSafeRecord,
  sanitizeSemanticOperations,
} from './client-preview'
import {
  reviewRepository,
  ReviewRepositoryConflictError,
  type ReviewArtifact,
  type ReviewCommentRow,
  type ReviewRepository,
  type ReviewSessionRow,
  type ReviewTokenRow,
} from './repository'
import {
  generateReviewToken,
  hashReviewToken,
  isReviewToken,
} from './token'

const MAX_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000
const ACTIVE_SESSION_STATUSES = new Set(['open', 'changes_requested'])

export class SiteForgeReviewError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message)
    this.name = 'SiteForgeReviewError'
  }
}

export type PublicReviewRateLimitInput = {
  reviewSessionId: string
  reviewTokenId: string
  clientHash: string
}

export type PublicReviewRateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: string
}

export interface PublicReviewRateLimitStore {
  consume(
    input: PublicReviewRateLimitInput
  ): Promise<PublicReviewRateLimitResult>
}

export type PublicReviewRateLimitContext = {
  clientHash: string
  store?: PublicReviewRateLimitStore
}

function parseRateLimitResult(value: unknown): PublicReviewRateLimitResult {
  const row = Array.isArray(value) ? value[0] : value
  if (
    !row ||
    typeof row !== 'object' ||
    typeof (row as { allowed?: unknown }).allowed !== 'boolean' ||
    !Number.isSafeInteger((row as { remaining?: unknown }).remaining) ||
    typeof (row as { reset_at?: unknown }).reset_at !== 'string'
  ) {
    throw new SiteForgeReviewError(
      'Review access is temporarily unavailable',
      503,
      'rate_limit_unavailable'
    )
  }
  return {
    allowed: (row as { allowed: boolean }).allowed,
    remaining: (row as { remaining: number }).remaining,
    resetAt: (row as { reset_at: string }).reset_at,
  }
}

export const databasePublicReviewRateLimitStore: PublicReviewRateLimitStore = {
  async consume(input) {
    try {
      const serviceRoleKey = getSupabaseServiceRoleKey()
      const response = await fetch(
        `${getSupabaseUrl().replace(/\/$/, '')}/rest/v1/rpc/consume_siteforge_public_review_rate_limit`,
        {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_review_session_id: input.reviewSessionId,
            p_review_token_id: input.reviewTokenId,
            p_client_hash: input.clientHash,
          }),
          cache: 'no-store',
        }
      )
      if (!response.ok) {
        throw new SiteForgeReviewError(
          'Review access is temporarily unavailable',
          503,
          'rate_limit_unavailable'
        )
      }
      return parseRateLimitResult(await response.json())
    } catch (error) {
      if (error instanceof SiteForgeReviewError) throw error
      throw new SiteForgeReviewError(
        'Review access is temporarily unavailable',
        503,
        'rate_limit_unavailable'
      )
    }
  },
}

async function enforcePublicReviewRateLimit(
  token: ReviewTokenRow,
  session: ReviewSessionRow,
  context: PublicReviewRateLimitContext
): Promise<void> {
  const result = await (
    context.store || databasePublicReviewRateLimitStore
  ).consume({
    reviewSessionId: session.id,
    reviewTokenId: token.id,
    clientHash: context.clientHash,
  })
  if (!result.allowed) {
    throw new SiteForgeReviewError(
      'Too many review requests',
      429,
      'rate_limited'
    )
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parsePermissions(value: Json): ReviewPermission[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(permission => {
    const parsed = reviewPermissionSchema.safeParse(permission)
    return parsed.success ? [parsed.data] : []
  })
}

function assertTenantIdentity(
  session: ReviewSessionRow,
  identity: {
    website_id?: string
    property_id?: string
    org_id?: string
    review_session_id?: string
  }
) {
  if (
    (identity.review_session_id &&
      identity.review_session_id !== session.id) ||
    (identity.website_id && identity.website_id !== session.website_id) ||
    (identity.property_id && identity.property_id !== session.property_id) ||
    (identity.org_id && identity.org_id !== session.org_id)
  ) {
    throw new SiteForgeReviewError(
      'Review credential scope does not match',
      403,
      'scope_mismatch'
    )
  }
}

function isExactSessionArtifact(
  session: ReviewSessionRow,
  artifact: ReviewArtifact | null
): boolean {
  return Boolean(
    artifact &&
      artifact.id === session.artifact_id &&
      artifact.contentHash === session.artifact_content_hash &&
      artifact.websiteId === session.website_id &&
      artifact.propertyId === session.property_id &&
      artifact.orgId === session.org_id
  )
}

export async function createReviewSession(
  rawInput: unknown,
  openedBy: string,
  repository: Pick<
    ReviewRepository,
    'getWebsiteCurrentArtifact' | 'createSession'
  > = reviewRepository
) {
  const input = createReviewSessionSchema.parse(rawInput)
  const current = await repository.getWebsiteCurrentArtifact(input.websiteId)
  if (!current) {
    throw new SiteForgeReviewError(
      'Current website artifact is unavailable',
      404,
      'artifact_not_found'
    )
  }
  if (
    current.id !== input.artifactId ||
    current.contentHash !== input.contentHash
  ) {
    throw new SiteForgeReviewError(
      'Review must be bound to the exact current artifact',
      409,
      'stale_artifact'
    )
  }
  if (input.closesAt && Date.parse(input.closesAt) <= Date.now()) {
    throw new SiteForgeReviewError(
      'Review close time must be in the future',
      400,
      'invalid_expiry'
    )
  }

  return repository.createSession({
    org_id: current.orgId,
    property_id: current.propertyId,
    website_id: current.websiteId,
    artifact_id: current.id,
    artifact_content_hash: current.contentHash,
    title: input.title,
    instructions: input.instructions || null,
    client_safe_summary: sanitizeClientSafeRecord(
      input.clientSafeSummary
    ) as Json,
    opened_by: openedBy,
    closes_at: input.closesAt || null,
  })
}

export async function issueReviewToken(
  sessionId: string,
  rawInput: unknown,
  createdBy: string,
  repository: Pick<
    ReviewRepository,
    'getSession' | 'getWebsiteCurrentArtifact' | 'createToken'
  > = reviewRepository
) {
  const input = issueReviewTokenSchema.parse(rawInput)
  const session = await repository.getSession(sessionId)
  if (!session) {
    throw new SiteForgeReviewError(
      'Review session not found',
      404,
      'session_not_found'
    )
  }
  const current = await repository.getWebsiteCurrentArtifact(session.website_id)
  if (!isExactSessionArtifact(session, current)) {
    throw new SiteForgeReviewError(
      'Cannot issue access for a stale review artifact',
      409,
      'stale_artifact'
    )
  }
  if (!ACTIVE_SESSION_STATUSES.has(session.status)) {
    throw new SiteForgeReviewError(
      'Review session no longer accepts new reviewers',
      409,
      'session_inactive'
    )
  }

  const expiresAt = Date.parse(input.expiresAt)
  const latestExpiry = Math.min(
    Date.now() + MAX_TOKEN_LIFETIME_MS,
    session.closes_at ? Date.parse(session.closes_at) : Number.POSITIVE_INFINITY
  )
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > latestExpiry
  ) {
    throw new SiteForgeReviewError(
      'Review token expiry is outside the permitted window',
      400,
      'invalid_expiry'
    )
  }

  const rawToken = generateReviewToken()
  const token = await repository.createToken({
    review_session_id: session.id,
    org_id: session.org_id,
    property_id: session.property_id,
    website_id: session.website_id,
    token_hash: hashReviewToken(rawToken),
    reviewer_name: input.reviewerName || null,
    reviewer_email: input.reviewerEmail || null,
    permissions: input.permissions as Json,
    expires_at: input.expiresAt,
    created_by: createdBy,
  })

  return {
    rawToken,
    token: {
      id: token.id,
      reviewSessionId: token.review_session_id,
      permissions: input.permissions,
      expiresAt: token.expires_at,
      reviewerName: token.reviewer_name,
      reviewerEmail: token.reviewer_email,
    },
  }
}

export type ValidatedReviewCredential = {
  token: ReviewTokenRow
  session: ReviewSessionRow
  currentArtifact: ReviewArtifact | null
  permissions: ReviewPermission[]
  stale: boolean
}

type CredentialRepository = Pick<
  ReviewRepository,
  | 'getSession'
  | 'getWebsiteCurrentArtifact'
  | 'updateToken'
  | 'updateSession'
>

async function validateResolvedReviewToken(
  token: ReviewTokenRow | null,
  requiredPermission: ReviewPermission,
  repository: CredentialRepository,
  touchToken = true,
  rateLimit?: PublicReviewRateLimitContext
): Promise<ValidatedReviewCredential> {
  if (!token) {
    throw new SiteForgeReviewError(
      'Review link is invalid',
      401,
      'invalid_token'
    )
  }
  if (token.revoked_at) {
    throw new SiteForgeReviewError(
      'Review link has been revoked',
      410,
      'revoked_token'
    )
  }
  if (Date.parse(token.expires_at) <= Date.now()) {
    throw new SiteForgeReviewError(
      'Review link has expired',
      410,
      'expired_token'
    )
  }

  const session = await repository.getSession(token.review_session_id)
  if (!session) {
    throw new SiteForgeReviewError(
      'Review session is unavailable',
      410,
      'session_unavailable'
    )
  }
  assertTenantIdentity(session, token)
  if (
    session.closes_at &&
    Date.parse(session.closes_at) <= Date.now()
  ) {
    throw new SiteForgeReviewError(
      'Review session has expired',
      410,
      'session_expired'
    )
  }
  if (['closed', 'expired'].includes(session.status)) {
    throw new SiteForgeReviewError(
      'Review session is closed',
      410,
      'session_closed'
    )
  }
  if (rateLimit) {
    await enforcePublicReviewRateLimit(token, session, rateLimit)
  }

  const permissions = parsePermissions(token.permissions)
  if (!permissions.includes(requiredPermission)) {
    throw new SiteForgeReviewError(
      'Review link does not permit this action',
      403,
      'permission_denied'
    )
  }

  const currentArtifact = await repository.getWebsiteCurrentArtifact(
    session.website_id
  )
  const stale = !isExactSessionArtifact(session, currentArtifact)
  if (stale && session.status !== 'superseded') {
    const closedAt = new Date().toISOString()
    await repository.updateSession(session.id, {
      status: 'superseded',
      closed_at: closedAt,
    })
    session.status = 'superseded'
    session.closed_at = closedAt
  }
  if (stale && requiredPermission !== 'view') {
    throw new SiteForgeReviewError(
      'This review belongs to an older artifact',
      409,
      'stale_artifact'
    )
  }
  if (
    requiredPermission !== 'view' &&
    !ACTIVE_SESSION_STATUSES.has(session.status) &&
    !(requiredPermission === 'decide' && session.status === 'approved')
  ) {
    throw new SiteForgeReviewError(
      'Review session no longer accepts changes',
      409,
      'session_inactive'
    )
  }

  if (touchToken) {
    await repository.updateToken(token.id, {
      last_used_at: new Date().toISOString(),
    })
  }
  return { token, session, currentArtifact, permissions, stale }
}

export async function validateReviewCredential(
  rawToken: string,
  requiredPermission: ReviewPermission,
  repository: Pick<
    ReviewRepository,
    | 'getTokenByHash'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'updateToken'
    | 'updateSession'
  > = reviewRepository
): Promise<ValidatedReviewCredential> {
  if (!isReviewToken(rawToken)) {
    throw new SiteForgeReviewError(
      'Review link is invalid',
      401,
      'invalid_token'
    )
  }
  const token = await repository.getTokenByHash(hashReviewToken(rawToken))
  return validateResolvedReviewToken(token, requiredPermission, repository)
}

export async function validateReviewCredentialForExchange(
  rawToken: string,
  repository: Pick<
    ReviewRepository,
    | 'getTokenByHash'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'updateToken'
    | 'updateSession'
  > = reviewRepository,
  rateLimit?: PublicReviewRateLimitContext
): Promise<ValidatedReviewCredential> {
  if (!isReviewToken(rawToken)) {
    throw new SiteForgeReviewError(
      'Review link is invalid',
      401,
      'invalid_token'
    )
  }
  const token = await repository.getTokenByHash(hashReviewToken(rawToken))
  return validateResolvedReviewToken(token, 'view', repository, false, rateLimit)
}

export async function validateReviewCredentialByTokenId(
  tokenId: string,
  requiredPermission: ReviewPermission,
  repository: Pick<
    ReviewRepository,
    | 'getToken'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'updateToken'
    | 'updateSession'
  > = reviewRepository,
  rateLimit?: PublicReviewRateLimitContext
): Promise<ValidatedReviewCredential> {
  const token = await repository.getToken(tokenId)
  return validateResolvedReviewToken(
    token,
    requiredPermission,
    repository,
    true,
    rateLimit
  )
}

type ReviewCredentialInput = string | ValidatedReviewCredential

async function resolveReviewCredential(
  input: ReviewCredentialInput,
  requiredPermission: ReviewPermission,
  repository: Pick<
    ReviewRepository,
    | 'getTokenByHash'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'updateToken'
    | 'updateSession'
  >
): Promise<ValidatedReviewCredential> {
  if (typeof input === 'string') {
    return validateReviewCredential(input, requiredPermission, repository)
  }
  if (!input.permissions.includes(requiredPermission)) {
    throw new SiteForgeReviewError(
      'Review link does not permit this action',
      403,
      'permission_denied'
    )
  }
  return input
}

export async function revokeReviewToken(
  sessionId: string,
  tokenId: string,
  repository: Pick<
    ReviewRepository,
    'getSession' | 'listTokens' | 'updateToken'
  > = reviewRepository
) {
  const session = await repository.getSession(sessionId)
  if (!session) {
    throw new SiteForgeReviewError(
      'Review session not found',
      404,
      'session_not_found'
    )
  }
  const token = (await repository.listTokens(sessionId)).find(
    item => item.id === tokenId
  )
  if (!token) {
    throw new SiteForgeReviewError(
      'Review token not found',
      404,
      'token_not_found'
    )
  }
  assertTenantIdentity(session, token)
  return repository.updateToken(token.id, {
    revoked_at: token.revoked_at || new Date().toISOString(),
  })
}

function stableReviewUuid(...parts: string[]): string {
  const bytes = createHash('sha256').update(parts.join('\u0000')).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function nextRevisionRound(
  session: ReviewSessionRow,
  requester: {
    name?: string | null
    email?: string | null
    assignedTo?: string | null
    dueAt?: string | null
  },
  stableId: string | null,
  repository: Pick<
    ReviewRepository,
    'listRounds' | 'createRound' | 'getRound' | 'getProfileOrg'
  >
) {
  if (requester.assignedTo) {
    const assigneeOrg = await repository.getProfileOrg(requester.assignedTo)
    if (assigneeOrg !== session.org_id) {
      throw new SiteForgeReviewError(
        'Revision assignee is outside this tenant',
        403,
        'assignee_scope_mismatch'
      )
    }
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (stableId) {
      const existing = await repository.getRound(stableId)
      if (existing) {
        assertTenantIdentity(session, existing)
        return existing
      }
    }
    const rounds = await repository.listRounds(session.id)
    const roundNumber =
      rounds.reduce(
        (highest, round) => Math.max(highest, round.round_number),
        0
      ) + 1
    try {
      return await repository.createRound({
        ...(stableId ? { id: stableId } : {}),
        review_session_id: session.id,
        org_id: session.org_id,
        property_id: session.property_id,
        website_id: session.website_id,
        round_number: roundNumber,
        requested_by_name: requester.name || null,
        requested_by_email: requester.email || null,
        assigned_to: requester.assignedTo || null,
        due_at: requester.dueAt || null,
      })
    } catch (error) {
      if (!(error instanceof ReviewRepositoryConflictError)) throw error
      if (stableId) {
        const existing = await repository.getRound(stableId)
        if (existing) {
          assertTenantIdentity(session, existing)
          return existing
        }
      }
    }
  }
  throw new SiteForgeReviewError(
    'Revision round could not be allocated',
    409,
    'round_conflict'
  )
}

export async function createRevisionRound(
  sessionId: string,
  rawInput: unknown,
  repository: Pick<
    ReviewRepository,
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'listRounds'
    | 'createRound'
    | 'getRound'
    | 'getProfileOrg'
    | 'assignUnscopedCommentsToRound'
  > = reviewRepository
) {
  const input = createRevisionRoundSchema.parse(rawInput)
  const session = await repository.getSession(sessionId)
  if (!session) {
    throw new SiteForgeReviewError(
      'Review session not found',
      404,
      'session_not_found'
    )
  }
  const current = await repository.getWebsiteCurrentArtifact(session.website_id)
  if (!isExactSessionArtifact(session, current)) {
    throw new SiteForgeReviewError(
      'Cannot create a revision round for a stale artifact',
      409,
      'stale_artifact'
    )
  }
  const round = await nextRevisionRound(
    session,
    {
      name: input.requestedByName,
      email: input.requestedByEmail,
      assignedTo: input.assignedTo,
      dueAt: input.dueAt,
    },
    null,
    repository
  )
  await repository.assignUnscopedCommentsToRound(
    session.id,
    session.artifact_id,
    round.id
  )
  return round
}

export async function updateRevisionRound(
  sessionId: string,
  roundId: string,
  rawInput: unknown,
  repository: Pick<
    ReviewRepository,
    | 'getSession'
    | 'getRound'
    | 'getProfileOrg'
    | 'getWebsiteCurrentArtifact'
    | 'updateRound'
  > = reviewRepository
) {
  const input = updateRevisionRoundSchema.parse(rawInput)
  const [session, round] = await Promise.all([
    repository.getSession(sessionId),
    repository.getRound(roundId),
  ])
  if (!session || !round || round.review_session_id !== session.id) {
    throw new SiteForgeReviewError(
      'Revision round not found',
      404,
      'round_not_found'
    )
  }
  assertTenantIdentity(session, round)
  if (input.assignedTo) {
    const assigneeOrg = await repository.getProfileOrg(input.assignedTo)
    if (assigneeOrg !== session.org_id) {
      throw new SiteForgeReviewError(
        'Revision assignee is outside this tenant',
        403,
        'assignee_scope_mismatch'
      )
    }
  }

  let resultingArtifact: ReviewArtifact | null = null
  if (input.resultingArtifactId || input.resultingContentHash) {
    resultingArtifact = await repository.getWebsiteCurrentArtifact(
      session.website_id
    )
    if (
      !resultingArtifact ||
      resultingArtifact.id !== input.resultingArtifactId ||
      resultingArtifact.contentHash !== input.resultingContentHash
    ) {
      throw new SiteForgeReviewError(
        'Resulting artifact must be the exact current artifact',
        409,
        'stale_result'
      )
    }
  }
  if (
    input.status === 'verified' &&
    (!resultingArtifact ||
      !input.resultingArtifactId ||
      !input.resultingContentHash)
  ) {
    throw new SiteForgeReviewError(
      'Verified rounds require an exact resulting artifact',
      400,
      'incomplete_trace'
    )
  }

  return repository.updateRound(round.id, {
    status: input.status,
    assigned_to: input.assignedTo,
    due_at: input.dueAt,
    resulting_artifact_id: input.resultingArtifactId,
    resulting_content_hash: input.resultingContentHash,
  })
}

export async function addClientComment(
  credentialInput: ReviewCredentialInput,
  rawInput: unknown,
  repository: Pick<
    ReviewRepository,
    | 'getTokenByHash'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'getArtifact'
    | 'updateToken'
    | 'updateSession'
    | 'getComment'
    | 'getRound'
    | 'createComment'
  > = reviewRepository
) {
  const input = createReviewCommentSchema.parse(rawInput)
  const credential = await resolveReviewCredential(
    credentialInput,
    'comment',
    repository
  )
  const artifact = await repository.getArtifact(
    credential.session.artifact_id,
    credential.session.website_id
  )
  const preview = buildClientSafePreview(artifact?.blueprint)
  if (!previewContainsScope(preview, input.pagePath, input.sectionId)) {
    throw new SiteForgeReviewError(
      'Comment scope is not part of this artifact',
      400,
      'invalid_comment_scope'
    )
  }

  if (input.parentCommentId) {
    const parent = await repository.getComment(input.parentCommentId)
    if (
      !parent ||
      parent.review_session_id !== credential.session.id ||
      parent.artifact_id !== credential.session.artifact_id
    ) {
      throw new SiteForgeReviewError(
        'Comment thread is outside this review',
        400,
        'invalid_comment_thread'
      )
    }
  }
  if (input.revisionRoundId) {
    const round = await repository.getRound(input.revisionRoundId)
    if (
      !round ||
      round.review_session_id !== credential.session.id ||
      round.website_id !== credential.session.website_id
    ) {
      throw new SiteForgeReviewError(
        'Revision round is outside this review',
        400,
        'invalid_revision_round'
      )
    }
  }

  return repository.createComment({
    review_session_id: credential.session.id,
    revision_round_id: input.revisionRoundId || null,
    org_id: credential.session.org_id,
    property_id: credential.session.property_id,
    website_id: credential.session.website_id,
    artifact_id: credential.session.artifact_id,
    parent_comment_id: input.parentCommentId || null,
    author_type: 'client',
    author_name: credential.token.reviewer_name || 'Client reviewer',
    author_email: credential.token.reviewer_email,
    page_path: input.pagePath,
    section_id: input.sectionId || null,
    viewport: input.viewport || null,
    anchor: input.anchor as Json,
    body: input.body,
    category: input.category,
  })
}

export async function recordClientDecision(
  credentialInput: ReviewCredentialInput,
  rawInput: unknown,
  repository: Pick<
    ReviewRepository,
    | 'getTokenByHash'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'getCanonicalReviewRelease'
    | 'updateToken'
    | 'updateSession'
    | 'listRounds'
    | 'createRound'
    | 'getRound'
    | 'getProfileOrg'
    | 'createDecision'
    | 'getDecision'
    | 'listDecisions'
    | 'updateRound'
    | 'assignUnscopedCommentsToRound'
  > = reviewRepository
) {
  const input = createClientDecisionSchema.parse(rawInput)
  const credential = await resolveReviewCredential(
    credentialInput,
    'decide',
    repository
  )
  const canonicalRelease = await repository.getCanonicalReviewRelease(
    credential.session.website_id,
    credential.session.artifact_id
  )
  if (
    !canonicalRelease ||
    canonicalRelease.artifactId !== credential.session.artifact_id ||
    canonicalRelease.contentHash !== credential.session.artifact_content_hash ||
    canonicalRelease.artifactId !== input.artifactId ||
    canonicalRelease.contentHash !== input.contentHash ||
    canonicalRelease.certificationId !== input.certificationId ||
    canonicalRelease.url !== input.canonicalUrl
  ) {
    throw new SiteForgeReviewError(
      'Decision must reference the exact certified canonical WordPress artifact',
      409,
      'canonical_release_mismatch'
    )
  }
  const decisionId = stableReviewUuid(
    'siteforge-client-decision',
    credential.session.id,
    credential.token.id,
    credential.session.artifact_id,
    credential.session.artifact_content_hash,
    input.decision,
    input.rationale,
    input.certificationId,
    input.canonicalUrl
  )
  let decision = await repository.getDecision(decisionId)
  if (credential.session.status === 'approved' && !decision) {
    throw new SiteForgeReviewError(
      'Review session no longer accepts changes',
      409,
      'session_inactive'
    )
  }
  if (!decision) {
    try {
      decision = await repository.createDecision({
        id: decisionId,
        review_session_id: credential.session.id,
        review_token_id: credential.token.id,
        org_id: credential.session.org_id,
        property_id: credential.session.property_id,
        website_id: credential.session.website_id,
        artifact_id: credential.session.artifact_id,
        artifact_content_hash: credential.session.artifact_content_hash,
        certification_evidence_id: canonicalRelease.certificationId,
        certification_report_hash: canonicalRelease.certificationReportHash,
        canonical_url: canonicalRelease.url,
        certified_at: canonicalRelease.certifiedAt,
        decision: input.decision,
        rationale: input.rationale,
        reviewer_name: credential.token.reviewer_name,
        reviewer_email: credential.token.reviewer_email,
      })
    } catch (error) {
      if (!(error instanceof ReviewRepositoryConflictError)) throw error
      decision = await repository.getDecision(decisionId)
      if (!decision) throw error
    }
  }
  assertTenantIdentity(credential.session, decision)

  let round = null
  if (input.decision === 'changes_requested') {
    const roundId = stableReviewUuid(
      'siteforge-client-decision-round',
      decision.id
    )
    round = await nextRevisionRound(
      credential.session,
      {
        name: credential.token.reviewer_name,
        email: credential.token.reviewer_email,
      },
      roundId,
      repository
    )
    await repository.assignUnscopedCommentsToRound(
      credential.session.id,
      credential.session.artifact_id,
      round.id
    )
  }
  const [decisions, rounds] = await Promise.all([
    repository.listDecisions(credential.session.id),
    repository.listRounds(credential.session.id),
  ])
  const latest = decisions.toSorted(
    (left, right) =>
      right.created_at.localeCompare(left.created_at) ||
      right.id.localeCompare(left.id)
  )[0]
  const nextStatus =
    latest?.decision === 'changes_requested' ? 'changes_requested' : 'approved'
  const latestRoundId =
    latest?.decision === 'changes_requested'
      ? stableReviewUuid('siteforge-client-decision-round', latest.id)
      : null
  await Promise.all(
    rounds
      .filter(
        item =>
          item.id !== latestRoundId &&
          !['closed', 'verified'].includes(item.status)
      )
      .map(item => repository.updateRound(item.id, { status: 'closed' }))
  )
  await repository.updateSession(credential.session.id, {
    status: nextStatus,
    closed_at: null,
  })
  return { decision, round }
}

export async function updateCommentTrace(
  sessionId: string,
  commentId: string,
  rawInput: unknown,
  repository: Pick<
    ReviewRepository,
    | 'getSession'
    | 'getComment'
    | 'getWebsiteCurrentArtifact'
    | 'updateComment'
    | 'updateRound'
  > = reviewRepository
) {
  const input = updateCommentTraceSchema.parse(rawInput)
  const [session, comment] = await Promise.all([
    repository.getSession(sessionId),
    repository.getComment(commentId),
  ])
  if (!session || !comment || comment.review_session_id !== session.id) {
    throw new SiteForgeReviewError(
      'Review comment not found',
      404,
      'comment_not_found'
    )
  }
  assertTenantIdentity(session, comment)

  let resultingArtifact: ReviewArtifact | null = null
  if (input.resultingArtifactId || input.resultingContentHash) {
    resultingArtifact = await repository.getWebsiteCurrentArtifact(
      session.website_id
    )
    if (
      !resultingArtifact ||
      resultingArtifact.id !== input.resultingArtifactId ||
      resultingArtifact.contentHash !== input.resultingContentHash
    ) {
      throw new SiteForgeReviewError(
        'Trace result must be the exact current artifact',
        409,
        'stale_result'
      )
    }
  }

  const updated = await repository.updateComment(comment.id, {
    status: input.status,
    disposition_reason: input.interpretation,
    semantic_operations: input.semanticOperations as Json,
    resulting_artifact_id: input.resultingArtifactId || null,
  })
  if (
    comment.revision_round_id &&
    resultingArtifact &&
    input.resultingContentHash
  ) {
    await repository.updateRound(comment.revision_round_id, {
      resulting_artifact_id: resultingArtifact.id,
      resulting_content_hash: input.resultingContentHash,
      status:
        input.status === 'verified'
          ? 'ready_for_verification'
          : 'in_progress',
    })
  }
  return updated
}

function dispositionForRound(
  roundId: string,
  comments: ReviewCommentRow[]
) {
  const scoped = comments.filter(comment => comment.revision_round_id === roundId)
  return {
    open: scoped.filter(comment =>
      ['open', 'clarification_needed'].includes(comment.status)
    ).length,
    accepted: scoped.filter(comment =>
      ['accepted', 'resolved'].includes(comment.status)
    ).length,
    rejected: scoped.filter(comment => comment.status === 'rejected').length,
    verified: scoped.filter(comment => comment.status === 'verified').length,
  }
}

export async function getPublicReviewData(
  credentialInput: ReviewCredentialInput,
  repository: Pick<
    ReviewRepository,
    | 'getTokenByHash'
    | 'getSession'
    | 'getWebsiteCurrentArtifact'
    | 'getArtifact'
    | 'getCanonicalReviewRelease'
    | 'updateToken'
    | 'updateSession'
    | 'listRounds'
    | 'listComments'
    | 'listDecisions'
  > = reviewRepository
): Promise<PublicReviewData> {
  const credential = await resolveReviewCredential(
    credentialInput,
    'view',
    repository
  )
  const [artifact, canonicalRelease, rounds, comments, decisions] = await Promise.all([
    repository.getArtifact(
      credential.session.artifact_id,
      credential.session.website_id
    ),
    repository.getCanonicalReviewRelease(
      credential.session.website_id,
      credential.session.artifact_id
    ),
    repository.listRounds(credential.session.id),
    repository.listComments(credential.session.id),
    repository.listDecisions(credential.session.id),
  ])
  if (!artifact || !isExactSessionArtifact(credential.session, artifact)) {
    throw new SiteForgeReviewError(
      'Reviewed artifact is unavailable',
      410,
      'artifact_unavailable'
    )
  }

  const publicDecisions = decisions.map(decision => ({
    id: decision.id,
    decision: decision.decision as ReviewDecision,
    rationale: decision.rationale,
    reviewerName: decision.reviewer_name,
    createdAt: decision.created_at,
    artifactId: decision.artifact_id,
    contentHash: decision.artifact_content_hash,
    certificationId: decision.certification_evidence_id,
    certificationReportHash: decision.certification_report_hash,
    canonicalUrl: decision.canonical_url,
    certifiedAt: decision.certified_at,
    isCurrentArtifact:
      !credential.stale &&
      decision.artifact_id === artifact.id &&
      decision.artifact_content_hash === artifact.contentHash,
  }))
  const latestDecision = publicDecisions[0] || null

  return {
    session: {
      id: credential.session.id,
      title: redactInternalReviewText(credential.session.title),
      instructions: credential.session.instructions
        ? redactInternalReviewText(credential.session.instructions)
        : null,
      status: credential.session.status,
      openedAt: credential.session.opened_at,
      closesAt: credential.session.closes_at,
      summary: asRecord(credential.session.client_safe_summary),
    },
    artifact: {
      id: artifact.id,
      version: artifact.version,
      contentHash: artifact.contentHash,
      isCurrent: !credential.stale,
    },
    canonicalRelease: canonicalRelease
      ? {
          artifactId: canonicalRelease.artifactId,
          contentHash: canonicalRelease.contentHash,
          certificationId: canonicalRelease.certificationId,
          certificationPolicy: canonicalRelease.certificationPolicy,
          certificationReportHash: canonicalRelease.certificationReportHash,
          certifiedAt: canonicalRelease.certifiedAt,
          url: canonicalRelease.url,
          exact:
            !credential.stale &&
            canonicalRelease.artifactId === artifact.id &&
            canonicalRelease.contentHash === artifact.contentHash,
        }
      : null,
    permissions: credential.permissions,
    reviewer: {
      name: credential.token.reviewer_name,
    },
    preview: buildClientSafePreview(artifact.blueprint),
    rounds: rounds.map(round => ({
      id: round.id,
      number: round.round_number,
      status: round.status,
      requestedByName: round.requested_by_name,
      dueAt: round.due_at,
      resultingArtifactId: round.resulting_artifact_id,
      disposition: dispositionForRound(round.id, comments),
    })),
    comments: comments.map(comment => ({
      id: comment.id,
      parentCommentId: comment.parent_comment_id,
      revisionRoundId: comment.revision_round_id,
      authorType: comment.author_type as 'client' | 'operator' | 'system',
      authorName:
        comment.author_name ||
        (comment.author_type === 'client' ? 'Client reviewer' : 'SiteForge team'),
      pagePath: comment.page_path,
      sectionId: comment.section_id,
      viewport: comment.viewport,
      body: comment.body,
      category: comment.category,
      status: comment.status,
      createdAt: comment.created_at,
      trace: {
        interpretation: comment.disposition_reason
          ? redactInternalReviewText(comment.disposition_reason)
          : null,
        semanticOperations: sanitizeSemanticOperations(
          comment.semantic_operations
        ),
        resultingArtifactId: comment.resulting_artifact_id,
        verificationStatus: comment.status,
      },
    })),
    decisions: publicDecisions,
    clientApproval: latestDecision
      ? {
          decision: latestDecision.decision,
          rationale: latestDecision.rationale,
          recordedAt: latestDecision.createdAt,
          artifactId: latestDecision.artifactId,
          contentHash: latestDecision.contentHash,
          certificationId: latestDecision.certificationId || '',
          canonicalUrl: latestDecision.canonicalUrl || '',
          validForCurrentArtifact:
            latestDecision.isCurrentArtifact &&
            Boolean(canonicalRelease) &&
            canonicalRelease?.artifactId === latestDecision.artifactId &&
            canonicalRelease?.contentHash === latestDecision.contentHash &&
            canonicalRelease?.certificationId === latestDecision.certificationId &&
            canonicalRelease?.certificationReportHash ===
              latestDecision.certificationReportHash &&
            canonicalRelease?.url === latestDecision.canonicalUrl &&
            canonicalRelease?.certifiedAt === latestDecision.certifiedAt &&
            ['approved', 'approved_with_notes'].includes(
              latestDecision.decision
            ),
        }
      : null,
    notice: credential.stale
      ? 'A newer website revision exists. This review is read-only and any prior approval is no longer current.'
      : null,
  }
}

export async function getInternalReviewState(
  websiteId: string,
  repository: Pick<
    ReviewRepository,
    | 'getWebsiteCurrentArtifact'
    | 'listSessions'
    | 'updateSession'
    | 'listRounds'
    | 'listComments'
    | 'listDecisions'
    | 'listTokens'
  > = reviewRepository
) {
  const currentArtifact = await repository.getWebsiteCurrentArtifact(websiteId)
  const sessions = await repository.listSessions(websiteId)
  const enriched = await Promise.all(
    sessions.map(async sourceSession => {
      let session = sourceSession
      const stale = !isExactSessionArtifact(session, currentArtifact)
      if (
        stale &&
        !['superseded', 'closed', 'expired'].includes(session.status)
      ) {
        session = await repository.updateSession(session.id, {
          status: 'superseded',
          closed_at: new Date().toISOString(),
        })
      }
      const [rounds, comments, decisions, tokens] = await Promise.all([
        repository.listRounds(session.id),
        repository.listComments(session.id),
        repository.listDecisions(session.id),
        repository.listTokens(session.id),
      ])
      return {
        session,
        stale,
        rounds: rounds.map(round => ({
          ...round,
          disposition: dispositionForRound(round.id, comments),
        })),
        comments,
        decisions: decisions.map(decision => ({
          ...decision,
          approvalValid:
            !stale &&
            decision.artifact_id === currentArtifact?.id &&
            decision.artifact_content_hash === currentArtifact?.contentHash &&
            ['approved', 'approved_with_notes'].includes(decision.decision),
        })),
        tokens: tokens.map(token => ({
          id: token.id,
          reviewer_name: token.reviewer_name,
          reviewer_email: token.reviewer_email,
          permissions: parsePermissions(token.permissions),
          expires_at: token.expires_at,
          revoked_at: token.revoked_at,
          last_used_at: token.last_used_at,
          created_at: token.created_at,
        })),
      }
    })
  )
  return {
    currentArtifact: currentArtifact
      ? {
          id: currentArtifact.id,
          version: currentArtifact.version,
          contentHash: currentArtifact.contentHash,
        }
      : null,
    sessions: enriched,
  }
}
