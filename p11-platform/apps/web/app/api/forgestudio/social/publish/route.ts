import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { evaluateForgeStudioDraftReadiness } from '@/utils/services/forgestudio-draft-readiness'
import { decryptSecret } from '@/utils/forgestudio/crypto'
import { assertSafeMediaUrl, UnsafeMediaUrlError } from '@/utils/forgestudio/safe-media-fetch'
import {
  runSharedExecutorJob,
  SharedExecutorApprovalRequiredError,
  SharedExecutorDuplicateJobError,
} from '@/utils/services/shared-executor'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

class PublishProviderError extends Error {
  retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'PublishProviderError'
    this.retryable = retryable
  }
}

type PublishConnectionResult = {
  connectionId: string
  platform: string
  success: boolean
  retryable?: boolean
  skipped?: boolean
  postId?: string
  postUrl?: string
  error?: string
}

type PublishRunResult = {
  success: boolean
  retryableFailureCount: number
  permanentFailureCount: number
  results: PublishConnectionResult[]
}

/**
 * Thrown from inside the shared-executor execute() when at least one
 * connection failed, so the shared job is recorded as failed/retryable
 * instead of silently succeeding on partial failure.
 */
class ForgeStudioPublishFailureError extends Error {
  result: PublishRunResult

  constructor(result: PublishRunResult) {
    super(
      `Publishing failed for ${result.retryableFailureCount + result.permanentFailureCount} of ${result.results.length} connections`
    )
    this.name = 'ForgeStudioPublishFailureError'
    this.result = result
  }
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function inferRetryableError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('timeout') ||
    normalized.includes('temporar') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    normalized.includes('connection reset') ||
    normalized.includes('service unavailable')
  )
}

function toPublishProviderError(error: unknown, fallback: string): PublishProviderError {
  if (error instanceof PublishProviderError) {
    return error
  }

  if (error instanceof UnsafeMediaUrlError) {
    return new PublishProviderError(error.message, false)
  }

  if (error instanceof Error) {
    return new PublishProviderError(error.message, inferRetryableError(error.message))
  }

  return new PublishProviderError(fallback, true)
}

function buildProviderError(status: number, message: string): PublishProviderError {
  return new PublishProviderError(message, isRetryableProviderStatus(status))
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

const publishRequestSchema = z.object({
  draftId: z.string().uuid(),
  connectionIds: z.array(z.string().uuid()).min(1).max(20),
  requireApproval: z.boolean().optional(),
  sharedJobId: z.string().uuid().nullish(),
  sharedActionAttemptId: z.string().uuid().nullish(),
})

const PUBLISHABLE_DRAFT_STATUSES = ['approved', 'scheduled', 'publishing']

// POST - Publish content to connected social accounts
export async function POST(request: NextRequest) {
  try {
    const isCronRequest = hasValidCronAuth(request)
    let userId: string | null = null
    const requestId = request.headers.get('x-request-id')

    if (!isCronRequest) {
      const authClient = await createServerClient()
      const {
        data: { user },
        error: authError,
      } = await authClient.auth.getUser()

      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      userId = user.id
    }

    const rawBody = await request.json().catch(() => null)
    const parsedBody = publishRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid publish request', details: parsedBody.error.issues },
        { status: 400 }
      )
    }
    const body = parsedBody.data
    const { draftId } = body
    const uniqueConnectionIds = [...new Set(body.connectionIds)]

    // Get the draft
    const { data: draft, error: draftError } = await supabase
      .from('content_drafts')
      .select('*')
      .eq('id', draftId)
      .single()

    if (draftError || !draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      )
    }

    if (!draft.property_id) {
      return NextResponse.json(
        { error: 'Draft is missing property association' },
        { status: 400 }
      )
    }

    if (userId) {
      const access = await validatePropertyAccess(userId, draft.property_id)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (!body.sharedJobId) {
      if (!PUBLISHABLE_DRAFT_STATUSES.includes(draft.status || '')) {
        return NextResponse.json(
          { error: 'Only approved or scheduled drafts can be published' },
          { status: 409 }
        )
      }

      const readiness = evaluateForgeStudioDraftReadiness({
        caption: draft.caption,
        platform: draft.platform,
        contentType: draft.content_type,
        mediaType: draft.media_type,
        mediaUrls: draft.media_urls,
      })
      if (!readiness.isReady) {
        return NextResponse.json(
          {
            error: 'Draft is not ready to publish',
            blockers: readiness.blockers,
          },
          { status: 409 }
        )
      }

      if (!isCronRequest && draft.status === 'scheduled' && draft.scheduled_for) {
        const scheduledForMs = Date.parse(draft.scheduled_for)
        if (!Number.isNaN(scheduledForMs) && scheduledForMs > Date.now()) {
          return NextResponse.json(
            { error: 'Scheduled drafts cannot be published before their scheduled time' },
            { status: 409 }
          )
        }
      }

      const { data: connections, error: connError } = await supabase
        .from('social_connections')
        .select('id')
        .in('id', uniqueConnectionIds)
        .eq('is_active', true)
        .eq('property_id', draft.property_id)

      if (connError || !connections?.length || connections.length !== uniqueConnectionIds.length) {
        return NextResponse.json(
          { error: 'Some requested connections are invalid, inactive, or belong to another property' },
          { status: 400 }
        )
      }
    }

    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .select('org_id')
      .eq('id', draft.property_id)
      .single()

    if (propertyError || !property?.org_id) {
      return NextResponse.json({ error: 'Draft property is missing organization context' }, { status: 409 })
    }

    const executePublish = async () => {
      const result = await runForgeStudioPublish({
        draftId,
        connectionIds: uniqueConnectionIds,
        isCronRequest,
        userId,
        requestId,
      })
      if (!result.success) {
        // Partial or total failure is a job failure, not a success.
        throw new ForgeStudioPublishFailureError(result)
      }
      return result
    }

    const toFailureResponse = (result: PublishRunResult) =>
      NextResponse.json(result, { status: 502 })

    if (body.sharedJobId) {
      try {
        return NextResponse.json(await executePublish())
      } catch (error) {
        if (error instanceof ForgeStudioPublishFailureError) {
          return toFailureResponse(error.result)
        }
        throw error
      }
    }

    try {
      const result = await runSharedExecutorJob({
        orgId: property.org_id,
        propertyId: draft.property_id,
        domain: 'forgestudio.publish',
        subjectType: 'content_draft',
        subjectId: draftId,
        dedupeKey: `${draftId}:${uniqueConnectionIds.sort().join(',')}`,
        requestedBy: userId,
        capturedBy: userId,
        payload: {
          draftId,
          connectionIds: uniqueConnectionIds,
          initiatedVia: isCronRequest ? 'cron' : 'operator',
        },
        action: {
          actionType: 'publish_social_content',
          proposalDecisionStatus: body.requireApproval ? 'proposed' : 'approved',
          requestPayload: {
            draftId,
            connectionIds: uniqueConnectionIds,
          },
          executionPayload: {
            draftId,
            connectionIds: uniqueConnectionIds,
            initiatedVia: isCronRequest ? 'cron' : 'operator',
          },
          policyReason: body.requireApproval ? 'operator_requested_publish_review' : 'operator_requested_publish',
        },
        execute: executePublish,
      })

      return NextResponse.json(result)
    } catch (error) {
      if (error instanceof SharedExecutorApprovalRequiredError) {
        return NextResponse.json(
          {
            success: false,
            approvalRequired: true,
            sharedJobId: error.sharedJobId,
            sharedActionAttemptId: error.sharedActionAttemptId,
            message: error.message,
          },
          { status: 202 }
        )
      }
      if (error instanceof SharedExecutorDuplicateJobError) {
        return NextResponse.json(
          {
            success: false,
            duplicate: true,
            sharedJobId: error.sharedJobId,
            lifecycleStatus: error.lifecycleStatus,
            error: 'A publish job for this draft and destination set already exists',
          },
          { status: 409 }
        )
      }
      if (error instanceof ForgeStudioPublishFailureError) {
        return toFailureResponse(error.result)
      }
      throw error
    }

  } catch (error) {
    console.error('Publishing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publishing failed' },
      { status: 500 }
    )
  }
}

type ConnectionRow = {
  id: string
  platform: string
  account_id: string
  access_token: string | null
  page_id: string | null
  page_access_token: string | null
  error_count: number | null
}

type DraftContent = {
  caption: string
  hashtags: string[]
  media_urls: string[]
  media_type: string
}

async function runForgeStudioPublish(input: {
  draftId: string
  connectionIds: string[]
  isCronRequest: boolean
  userId: string | null
  requestId: string | null
}): Promise<PublishRunResult> {
  const { draftId, connectionIds, isCronRequest, userId, requestId } = input
  const { data: draft, error: draftError } = await supabase
    .from('content_drafts')
    .select('*')
    .eq('id', draftId)
    .single()

  if (draftError || !draft) {
    throw new Error('Draft not found')
  }

  if (!draft.property_id) {
    throw new Error('Draft is missing property association')
  }

  if (!PUBLISHABLE_DRAFT_STATUSES.includes(draft.status || '')) {
    throw new PublishProviderError('Only approved or scheduled drafts can be published', false)
  }

  const readiness = evaluateForgeStudioDraftReadiness({
    caption: draft.caption,
    platform: draft.platform,
    contentType: draft.content_type,
    mediaType: draft.media_type,
    mediaUrls: draft.media_urls,
  })
  if (!readiness.isReady) {
    throw new PublishProviderError(
      `Draft is not ready to publish: ${readiness.blockers.join(', ')}`,
      false
    )
  }

  if (!isCronRequest && draft.status === 'scheduled' && draft.scheduled_for) {
    const scheduledForMs = Date.parse(draft.scheduled_for)
    if (!Number.isNaN(scheduledForMs) && scheduledForMs > Date.now()) {
      throw new PublishProviderError('Scheduled drafts cannot be published before their scheduled time', false)
    }
  }

  // Every attached media URL must be a public https URL before we hand it to a provider.
  for (const mediaUrl of draft.media_urls || []) {
    assertSafeMediaUrl(mediaUrl)
  }

  const { data: connections, error: connError } = await supabase
    .from('social_connections')
    .select('*')
    .in('id', connectionIds)
    .eq('is_active', true)
    .eq('property_id', draft.property_id)

  if (connError || !connections?.length || connections.length !== connectionIds.length) {
    throw new PublishProviderError(
      'Some requested connections are invalid, inactive, or belong to another property',
      false
    )
  }

  const results: PublishConnectionResult[] = []
  const initiatedVia = isCronRequest ? 'cron' : 'operator'

  for (const connection of connections as ConnectionRow[]) {
    const actionTimestamp = new Date().toISOString()
    const auditContext = {
      action: 'publish',
      initiated_via: initiatedVia,
      initiated_by: userId,
      request_id: requestId,
      attempted_at: actionTimestamp,
    }

    // Reserve the (draft, connection) pair before calling the provider.
    // The partial unique index on active statuses makes double publishes
    // impossible even under concurrent workers.
    const { data: reservation, error: reservationError } = await supabase
      .from('published_posts')
      .insert({
        content_draft_id: draftId,
        social_connection_id: connection.id,
        status: 'publishing',
        engagement_metrics: { ...auditContext, result: 'publishing' },
      })
      .select('id')
      .single()

    if (reservationError || !reservation?.id) {
      if (isUniqueViolation(reservationError)) {
        const { data: existing } = await supabase
          .from('published_posts')
          .select('status, platform_post_id, platform_post_url')
          .eq('content_draft_id', draftId)
          .eq('social_connection_id', connection.id)
          .in('status', ['publishing', 'reconciling', 'published'])
          .limit(1)
          .maybeSingle()

        results.push({
          connectionId: connection.id,
          platform: connection.platform,
          success: true,
          skipped: true,
          postId: existing?.platform_post_id || undefined,
          postUrl: existing?.platform_post_url || undefined,
        })
        continue
      }

      // Ledger write failed: do NOT call the provider without a reservation.
      results.push({
        connectionId: connection.id,
        platform: connection.platform,
        success: false,
        retryable: true,
        error: `Failed to record publish reservation: ${reservationError?.message || 'unknown error'}`,
      })
      continue
    }

    try {
      const draftContent: DraftContent = {
        caption: draft.caption || '',
        hashtags: draft.hashtags || [],
        media_urls: draft.media_urls || [],
        media_type: draft.media_type || 'none',
      }

      let result: { postId: string; postUrl: string }

      switch (connection.platform) {
        case 'instagram':
          result = await publishToInstagram(connection, draftContent)
          break
        case 'facebook':
          result = await publishToFacebook(connection, draftContent)
          break
        case 'linkedin':
          result = await publishToLinkedIn(connection, draftContent)
          break
        default:
          throw new PublishProviderError(`Unsupported platform: ${connection.platform}`, false)
      }

      const { error: successUpdateError } = await supabase
        .from('published_posts')
        .update({
          platform_post_id: result.postId,
          platform_post_url: result.postUrl,
          status: 'published',
          published_at: actionTimestamp,
          engagement_metrics: { ...auditContext, result: 'published' },
        })
        .eq('id', reservation.id)

      if (successUpdateError) {
        // The provider accepted the post but our ledger update failed.
        // Keep the reservation row (still blocks duplicates) and surface it.
        console.error('[forgestudio.publish] provider succeeded but ledger update failed', {
          draftId,
          connectionId: connection.id,
          reservationId: reservation.id,
          error: successUpdateError,
        })
        await supabase
          .from('published_posts')
          .update({ status: 'reconciling', error_message: 'Ledger update failed after provider success' })
          .eq('id', reservation.id)
      }

      await supabase
        .from('social_connections')
        .update({ last_used_at: new Date().toISOString(), error_count: 0, last_error: null })
        .eq('id', connection.id)

      results.push({
        connectionId: connection.id,
        platform: connection.platform,
        success: true,
        postId: result.postId,
        postUrl: result.postUrl,
      })
    } catch (error) {
      const publishError = toPublishProviderError(error, 'Publishing failed')
      const errorMessage = publishError.message

      await supabase
        .from('social_connections')
        .update({
          error_count: (connection.error_count || 0) + 1,
          last_error: errorMessage,
        })
        .eq('id', connection.id)

      const { error: failureUpdateError } = await supabase
        .from('published_posts')
        .update({
          status: 'failed',
          error_message: errorMessage,
          engagement_metrics: {
            ...auditContext,
            result: 'failed',
            retryable: publishError.retryable,
          },
        })
        .eq('id', reservation.id)

      if (failureUpdateError) {
        console.error('[forgestudio.publish] failed to record publish failure', {
          draftId,
          connectionId: connection.id,
          reservationId: reservation.id,
          error: failureUpdateError,
        })
      }

      results.push({
        connectionId: connection.id,
        platform: connection.platform,
        success: false,
        retryable: publishError.retryable,
        error: errorMessage,
      })
    }
  }

  const allSuccess = results.every(result => result.success)
  const retryableFailures = results.filter(result => !result.success && result.retryable)
  const permanentFailures = results.filter(result => !result.success && !result.retryable)
  if (allSuccess) {
    const { error: draftUpdateError } = await supabase
      .from('content_drafts')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .eq('id', draftId)
    if (draftUpdateError) {
      console.error('[forgestudio.publish] failed to mark draft published', {
        draftId,
        error: draftUpdateError,
      })
    }
  }

  return {
    success: allSuccess,
    retryableFailureCount: retryableFailures.length,
    permanentFailureCount: permanentFailures.length,
    results,
  }
}

function requireDecryptedToken(token: string | null, label: string): string {
  if (!token) {
    throw new PublishProviderError(`${label} is missing`, false)
  }
  return decryptSecret(token)
}

// Publish to Instagram via Facebook Graph API
async function publishToInstagram(
  connection: ConnectionRow,
  draft: DraftContent
): Promise<{ postId: string; postUrl: string }> {
  const accountId = connection.account_id
  if (!accountId || !connection.page_access_token) {
    throw new PublishProviderError('Instagram connection is missing required credentials', false)
  }
  const pageAccessToken = requireDecryptedToken(
    connection.page_access_token,
    'Instagram page access token'
  )
  const fullCaption = `${draft.caption}\n\n${draft.hashtags.map(h => `#${h}`).join(' ')}`

  // Instagram requires media to be hosted at a public URL
  if (!draft.media_urls?.length) {
    throw new PublishProviderError('Instagram requires an image or video', false)
  }

  const mediaUrl = draft.media_urls[0]

  // Step 1: Create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v21.0/${accountId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: mediaUrl,
        caption: fullCaption,
        access_token: pageAccessToken
      })
    }
  )

  const containerData = await containerRes.json()

  if (!containerRes.ok || containerData.error) {
    throw buildProviderError(
      containerRes.status,
      containerData.error?.message || 'Failed to create media container'
    )
  }

  const containerId = containerData.id

  // Step 2: Publish the container
  const publishRes = await fetch(
    `https://graph.facebook.com/v21.0/${accountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: pageAccessToken
      })
    }
  )

  const publishData = await publishRes.json()

  if (!publishRes.ok || publishData.error) {
    throw buildProviderError(
      publishRes.status,
      publishData.error?.message || 'Failed to publish to Instagram'
    )
  }

  return {
    postId: publishData.id,
    postUrl: `https://www.instagram.com/p/${publishData.id}/` // Approximate URL
  }
}

// Publish to Facebook Page
async function publishToFacebook(
  connection: ConnectionRow,
  draft: DraftContent
): Promise<{ postId: string; postUrl: string }> {
  const pageId = connection.page_id
  if (!pageId || !connection.page_access_token) {
    throw new PublishProviderError('Facebook connection is missing required credentials', false)
  }
  const pageAccessToken = requireDecryptedToken(
    connection.page_access_token,
    'Facebook page access token'
  )
  const message = `${draft.caption}\n\n${draft.hashtags.map(h => `#${h}`).join(' ')}`

  let endpoint = `https://graph.facebook.com/v21.0/${pageId}/feed`
  const body: Record<string, string> = {
    message,
    access_token: pageAccessToken
  }

  // If there's an image, post as photo
  if (draft.media_urls?.length && draft.media_type === 'image') {
    endpoint = `https://graph.facebook.com/v21.0/${pageId}/photos`
    body.url = draft.media_urls[0]
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const data = await res.json()

  if (!res.ok || data.error) {
    throw buildProviderError(
      res.status,
      data.error?.message || 'Failed to publish to Facebook'
    )
  }

  return {
    postId: data.id || data.post_id,
    postUrl: `https://www.facebook.com/${data.id || data.post_id}`
  }
}

// Publish to LinkedIn
async function publishToLinkedIn(
  connection: ConnectionRow,
  draft: DraftContent
): Promise<{ postId: string; postUrl: string }> {
  const accountId = connection.account_id
  if (!accountId || !connection.access_token) {
    throw new PublishProviderError('LinkedIn connection is missing required credentials', false)
  }
  const accessToken = requireDecryptedToken(connection.access_token, 'LinkedIn access token')
  const text = `${draft.caption}\n\n${draft.hashtags.map(h => `#${h}`).join(' ')}`

  type LinkedInPostData = {
    author: string
    lifecycleState: 'PUBLISHED'
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: string }
        shareMediaCategory: 'IMAGE' | 'NONE'
        media?: Array<{ status: 'READY'; originalUrl: string }>
      }
    }
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  }

  // LinkedIn v2 API - UGC Posts
  const postData: LinkedInPostData = {
    author: `urn:li:person:${accountId}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text
        },
        shareMediaCategory: draft.media_urls?.length && draft.media_type === 'image' ? 'IMAGE' : 'NONE'
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  }

  if (draft.media_urls?.length && draft.media_type === 'image') {
    postData.specificContent['com.linkedin.ugc.ShareContent'].media = [{
      status: 'READY',
      originalUrl: draft.media_urls[0]
    }]
  }

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify(postData)
  })

  const data = await res.json()

  if (!res.ok || data.error) {
    throw buildProviderError(
      res.status,
      data.message || data.error || 'Failed to publish to LinkedIn'
    )
  }

  const postId = data.id
  return {
    postId,
    postUrl: `https://www.linkedin.com/feed/update/${postId}/`
  }
}
