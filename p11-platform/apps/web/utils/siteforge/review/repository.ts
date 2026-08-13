import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'

export type ReviewSessionRow =
  Database['public']['Tables']['siteforge_review_sessions']['Row']
export type ReviewTokenRow =
  Database['public']['Tables']['siteforge_review_tokens']['Row']
export type ReviewCommentRow =
  Database['public']['Tables']['siteforge_review_comments']['Row']
export type RevisionRoundRow =
  Database['public']['Tables']['siteforge_revision_rounds']['Row']
export type ClientDecisionRow =
  Database['public']['Tables']['siteforge_client_decisions']['Row']

type ReviewSessionInsert =
  Database['public']['Tables']['siteforge_review_sessions']['Insert']
type ReviewSessionUpdate =
  Database['public']['Tables']['siteforge_review_sessions']['Update']
type ReviewTokenInsert =
  Database['public']['Tables']['siteforge_review_tokens']['Insert']
type ReviewTokenUpdate =
  Database['public']['Tables']['siteforge_review_tokens']['Update']
type ReviewCommentInsert =
  Database['public']['Tables']['siteforge_review_comments']['Insert']
type ReviewCommentUpdate =
  Database['public']['Tables']['siteforge_review_comments']['Update']
type RevisionRoundInsert =
  Database['public']['Tables']['siteforge_revision_rounds']['Insert']
type RevisionRoundUpdate =
  Database['public']['Tables']['siteforge_revision_rounds']['Update']
type ClientDecisionInsert =
  Database['public']['Tables']['siteforge_client_decisions']['Insert']

export type ReviewArtifact = {
  id: string
  websiteId: string
  propertyId: string
  orgId: string
  version: number
  contentHash: string
  blueprint: Json
}

export type ReviewWebsite = {
  id: string
  propertyId: string
  orgId: string
  currentArtifactId: string | null
}

export type CanonicalReviewRelease = {
  artifactId: string
  contentHash: string
  url: string
  previewedAt: string
  certificationId: string
  certificationPolicy: string
  certificationReportHash: string
  certifiedAt: string
}

export interface ReviewRepository {
  getWebsite(websiteId: string): Promise<ReviewWebsite | null>
  getWebsiteCurrentArtifact(websiteId: string): Promise<ReviewArtifact | null>
  getArtifact(
    artifactId: string,
    websiteId: string
  ): Promise<ReviewArtifact | null>
  getCanonicalReviewRelease(
    websiteId: string,
    artifactId: string
  ): Promise<CanonicalReviewRelease | null>
  getProfileOrg(profileId: string): Promise<string | null>
  createSession(input: ReviewSessionInsert): Promise<ReviewSessionRow>
  getSession(sessionId: string): Promise<ReviewSessionRow | null>
  listSessions(websiteId: string): Promise<ReviewSessionRow[]>
  updateSession(
    sessionId: string,
    input: ReviewSessionUpdate
  ): Promise<ReviewSessionRow>
  createToken(input: ReviewTokenInsert): Promise<ReviewTokenRow>
  getToken(tokenId: string): Promise<ReviewTokenRow | null>
  getTokenByHash(tokenHash: string): Promise<ReviewTokenRow | null>
  claimToken(tokenId: string, claimedAt: string): Promise<ReviewTokenRow | null>
  listTokens(sessionId: string): Promise<ReviewTokenRow[]>
  updateToken(
    tokenId: string,
    input: ReviewTokenUpdate
  ): Promise<ReviewTokenRow>
  createComment(input: ReviewCommentInsert): Promise<ReviewCommentRow>
  getComment(commentId: string): Promise<ReviewCommentRow | null>
  listComments(sessionId: string): Promise<ReviewCommentRow[]>
  updateComment(
    commentId: string,
    input: ReviewCommentUpdate
  ): Promise<ReviewCommentRow>
  assignUnscopedCommentsToRound(
    sessionId: string,
    artifactId: string,
    roundId: string
  ): Promise<void>
  createRound(input: RevisionRoundInsert): Promise<RevisionRoundRow>
  getRound(roundId: string): Promise<RevisionRoundRow | null>
  listRounds(sessionId: string): Promise<RevisionRoundRow[]>
  updateRound(
    roundId: string,
    input: RevisionRoundUpdate
  ): Promise<RevisionRoundRow>
  createDecision(input: ClientDecisionInsert): Promise<ClientDecisionRow>
  getDecision(decisionId: string): Promise<ClientDecisionRow | null>
  listDecisions(sessionId: string): Promise<ClientDecisionRow[]>
}

export class ReviewRepositoryConflictError extends Error {
  constructor(readonly operation: string) {
    super(`${operation}: conflicting review write`)
    this.name = 'ReviewRepositoryConflictError'
  }
}

function throwQueryError(operation: string, error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    String((error as { code: unknown }).code) === '23505'
  ) {
    throw new ReviewRepositoryConflictError(operation)
  }
  const detail =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'unknown database error'
  throw new Error(`${operation}: ${detail}`)
}

export function createReviewRepository(
  client?: ReturnType<typeof createServiceClient>
): ReviewRepository {
  let resolvedClient = client
  const database = () => {
    resolvedClient ||= createServiceClient()
    return resolvedClient
  }

  return {
    async getWebsite(websiteId) {
      const { data, error } = await database()
        .from('property_websites')
        .select('id, property_id, org_id, current_artifact_version_id')
        .eq('id', websiteId)
        .maybeSingle()
      if (error) throwQueryError('Load review website', error)
      return data
        ? {
            id: data.id,
            propertyId: data.property_id,
            orgId: data.org_id,
            currentArtifactId: data.current_artifact_version_id,
          }
        : null
    },

    async getWebsiteCurrentArtifact(websiteId) {
      const website = await this.getWebsite(websiteId)
      if (!website?.currentArtifactId) return null
      return this.getArtifact(website.currentArtifactId, website.id)
    },

    async getArtifact(artifactId, websiteId) {
      const { data, error } = await database()
        .from('siteforge_blueprint_versions')
        .select('id, website_id, property_id, org_id, version, content_hash, blueprint')
        .eq('id', artifactId)
        .eq('website_id', websiteId)
        .maybeSingle()
      if (error) throwQueryError('Load review artifact', error)
      return data
        ? {
            id: data.id,
            websiteId: data.website_id,
            propertyId: data.property_id,
            orgId: data.org_id,
            version: data.version,
            contentHash: data.content_hash,
            blueprint: data.blueprint,
          }
        : null
    },

    async getCanonicalReviewRelease(websiteId, artifactId) {
      const { data: website, error: websiteError } = await database()
        .from('property_websites')
        .select(
          'org_id, property_id, canonical_preview_artifact_id, canonical_preview_content_hash, canonical_preview_url, canonical_previewed_at'
        )
        .eq('id', websiteId)
        .maybeSingle()
      if (websiteError) throwQueryError('Load canonical review release', websiteError)
      if (
        !website ||
        website.canonical_preview_artifact_id !== artifactId ||
        !website.canonical_preview_content_hash ||
        !website.canonical_preview_url ||
        !website.canonical_previewed_at
      ) {
        return null
      }
      const { data: certification, error: certificationError } = await database()
        .from('siteforge_certification_evidence')
        .select('id, policy_version, report_hash, created_at')
        .eq('org_id', website.org_id)
        .eq('property_id', website.property_id)
        .eq('website_id', websiteId)
        .eq('artifact_id', artifactId)
        .eq('environment', 'preview')
        .eq('status', 'passed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (certificationError) {
        throwQueryError('Load canonical review certification', certificationError)
      }
      return certification
        ? {
            artifactId,
            contentHash: website.canonical_preview_content_hash,
            url: website.canonical_preview_url,
            previewedAt: website.canonical_previewed_at,
            certificationId: certification.id,
            certificationPolicy: certification.policy_version,
            certificationReportHash: certification.report_hash,
            certifiedAt: certification.created_at,
          }
        : null
    },

    async getProfileOrg(profileId) {
      const { data, error } = await database()
        .from('profiles')
        .select('org_id')
        .eq('id', profileId)
        .maybeSingle()
      if (error) throwQueryError('Load review assignee', error)
      return data?.org_id || null
    },

    async createSession(input) {
      const { data, error } = await database()
        .from('siteforge_review_sessions')
        .insert(input)
        .select('*')
        .single()
      if (error) throwQueryError('Create review session', error)
      return data
    },

    async getSession(sessionId) {
      const { data, error } = await database()
        .from('siteforge_review_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()
      if (error) throwQueryError('Load review session', error)
      return data
    },

    async listSessions(websiteId) {
      const { data, error } = await database()
        .from('siteforge_review_sessions')
        .select('*')
        .eq('website_id', websiteId)
        .order('opened_at', { ascending: false })
      if (error) throwQueryError('List review sessions', error)
      return data || []
    },

    async updateSession(sessionId, input) {
      const { data, error } = await database()
        .from('siteforge_review_sessions')
        .update(input)
        .eq('id', sessionId)
        .select('*')
        .single()
      if (error) throwQueryError('Update review session', error)
      return data
    },

    async createToken(input) {
      const { data, error } = await database()
        .from('siteforge_review_tokens')
        .insert(input)
        .select('*')
        .single()
      if (error) throwQueryError('Create review token', error)
      return data
    },

    async getToken(tokenId) {
      const { data, error } = await database()
        .from('siteforge_review_tokens')
        .select('*')
        .eq('id', tokenId)
        .maybeSingle()
      if (error) throwQueryError('Load review token', error)
      return data
    },

    async getTokenByHash(tokenHash) {
      const { data, error } = await database()
        .from('siteforge_review_tokens')
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (error) throwQueryError('Validate review token', error)
      return data
    },

    async claimToken(tokenId, claimedAt) {
      const { data, error } = await database()
        .from('siteforge_review_tokens')
        .update({ last_used_at: claimedAt })
        .eq('id', tokenId)
        .is('last_used_at', null)
        .select('*')
        .maybeSingle()
      if (error) throwQueryError('Claim review token exchange', error)
      return data
    },

    async listTokens(sessionId) {
      const { data, error } = await database()
        .from('siteforge_review_tokens')
        .select('*')
        .eq('review_session_id', sessionId)
        .order('created_at', { ascending: false })
      if (error) throwQueryError('List review tokens', error)
      return data || []
    },

    async updateToken(tokenId, input) {
      const { data, error } = await database()
        .from('siteforge_review_tokens')
        .update(input)
        .eq('id', tokenId)
        .select('*')
        .single()
      if (error) throwQueryError('Update review token', error)
      return data
    },

    async createComment(input) {
      const { data, error } = await database()
        .from('siteforge_review_comments')
        .insert(input)
        .select('*')
        .single()
      if (error) throwQueryError('Create review comment', error)
      return data
    },

    async getComment(commentId) {
      const { data, error } = await database()
        .from('siteforge_review_comments')
        .select('*')
        .eq('id', commentId)
        .maybeSingle()
      if (error) throwQueryError('Load review comment', error)
      return data
    },

    async listComments(sessionId) {
      const { data, error } = await database()
        .from('siteforge_review_comments')
        .select('*')
        .eq('review_session_id', sessionId)
        .order('created_at', { ascending: true })
      if (error) throwQueryError('List review comments', error)
      return data || []
    },

    async updateComment(commentId, input) {
      const { data, error } = await database()
        .from('siteforge_review_comments')
        .update(input)
        .eq('id', commentId)
        .select('*')
        .single()
      if (error) throwQueryError('Update review comment', error)
      return data
    },

    async assignUnscopedCommentsToRound(sessionId, artifactId, roundId) {
      const { error } = await database()
        .from('siteforge_review_comments')
        .update({ revision_round_id: roundId })
        .eq('review_session_id', sessionId)
        .eq('artifact_id', artifactId)
        .is('revision_round_id', null)
      if (error) throwQueryError('Assign comments to revision round', error)
    },

    async createRound(input) {
      const { data, error } = await database()
        .from('siteforge_revision_rounds')
        .insert(input)
        .select('*')
        .single()
      if (error) throwQueryError('Create revision round', error)
      return data
    },

    async getRound(roundId) {
      const { data, error } = await database()
        .from('siteforge_revision_rounds')
        .select('*')
        .eq('id', roundId)
        .maybeSingle()
      if (error) throwQueryError('Load revision round', error)
      return data
    },

    async listRounds(sessionId) {
      const { data, error } = await database()
        .from('siteforge_revision_rounds')
        .select('*')
        .eq('review_session_id', sessionId)
        .order('round_number', { ascending: true })
      if (error) throwQueryError('List revision rounds', error)
      return data || []
    },

    async updateRound(roundId, input) {
      const { data, error } = await database()
        .from('siteforge_revision_rounds')
        .update(input)
        .eq('id', roundId)
        .select('*')
        .single()
      if (error) throwQueryError('Update revision round', error)
      return data
    },

    async createDecision(input) {
      const { data, error } = await database()
        .from('siteforge_client_decisions')
        .insert(input)
        .select('*')
        .single()
      if (error) throwQueryError('Create client review decision', error)
      return data
    },

    async getDecision(decisionId) {
      const { data, error } = await database()
        .from('siteforge_client_decisions')
        .select('*')
        .eq('id', decisionId)
        .maybeSingle()
      if (error) throwQueryError('Load client review decision', error)
      return data
    },

    async listDecisions(sessionId) {
      const { data, error } = await database()
        .from('siteforge_client_decisions')
        .select('*')
        .eq('review_session_id', sessionId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (error) throwQueryError('List client review decisions', error)
      return data || []
    },
  }
}

export const reviewRepository = createReviewRepository()
