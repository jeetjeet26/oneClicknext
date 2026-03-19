import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { evaluateForgeStudioDraftReadiness } from '@/utils/services/forgestudio-draft-readiness'
import {
  runSharedExecutorJob,
  SharedExecutorApprovalRequiredError,
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

  if (error instanceof Error) {
    return new PublishProviderError(error.message, inferRetryableError(error.message))
  }

  return new PublishProviderError(fallback, true)
}

function buildProviderError(status: number, message: string): PublishProviderError {
  return new PublishProviderError(message, isRetryableProviderStatus(status))
}

type PublishRequestBody = {
  draftId?: string
  connectionIds?: string[]
  requireApproval?: boolean
  sharedJobId?: string | null
  sharedActionAttemptId?: string | null
}

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

    const body = (await request.json()) as PublishRequestBody
    const { draftId, connectionIds } = body
    const uniqueConnectionIds = Array.isArray(connectionIds)
      ? [...new Set(connectionIds.filter((value): value is string => typeof value === 'string' && value.length > 0))]
      : []

    if (!draftId || uniqueConnectionIds.length === 0) {
      return NextResponse.json(
        { error: 'Draft ID and connection IDs required' },
        { status: 400 }
      )
    }

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
      if (draft.status !== 'approved' && draft.status !== 'scheduled') {
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

    const executePublish = () =>
      runForgeStudioPublish({
        draftId,
        connectionIds: uniqueConnectionIds,
        isCronRequest,
        userId,
        requestId,
      })

    if (body.sharedJobId) {
      return NextResponse.json(await executePublish())
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

async function runForgeStudioPublish(input: {
  draftId: string
  connectionIds: string[]
  isCronRequest: boolean
  userId: string | null
  requestId: string | null
}) {
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

  if (draft.status !== 'approved' && draft.status !== 'scheduled') {
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

  const results: Array<{
    connectionId: string
    platform: string
    success: boolean
    retryable?: boolean
    skipped?: boolean
    postId?: string
    postUrl?: string
    error?: string
  }> = []
  const initiatedVia = isCronRequest ? 'cron' : 'operator'

  for (const connection of connections) {
    const actionTimestamp = new Date().toISOString()
    try {
      const { data: existingPublished } = await supabase
        .from('published_posts')
        .select('platform_post_id, platform_post_url')
        .eq('content_draft_id', draftId)
        .eq('social_connection_id', connection.id)
        .eq('status', 'published')
        .limit(1)
        .maybeSingle()

      if (existingPublished) {
        await supabase
          .from('published_posts')
          .insert({
            content_draft_id: draftId,
            social_connection_id: connection.id,
            platform_post_id: existingPublished.platform_post_id,
            platform_post_url: existingPublished.platform_post_url,
            status: 'skipped',
            engagement_metrics: {
              action: 'publish',
              result: 'skipped_existing_post',
              initiated_via: initiatedVia,
              initiated_by: userId,
              request_id: requestId,
              attempted_at: actionTimestamp,
            },
          })

        results.push({
          connectionId: connection.id,
          platform: connection.platform,
          success: true,
          skipped: true,
          postId: existingPublished.platform_post_id || undefined,
          postUrl: existingPublished.platform_post_url || undefined,
        })
        continue
      }

      let result: { postId: string; postUrl: string }

      switch (connection.platform) {
        case 'instagram':
          result = await publishToInstagram(connection, draft)
          break
        case 'facebook':
          result = await publishToFacebook(connection, draft)
          break
        case 'linkedin':
          result = await publishToLinkedIn(connection, draft)
          break
        default:
          throw new PublishProviderError(`Unsupported platform: ${connection.platform}`, false)
      }

      await supabase
        .from('published_posts')
        .insert({
          content_draft_id: draftId,
          social_connection_id: connection.id,
          platform_post_id: result.postId,
          platform_post_url: result.postUrl,
          status: 'published',
          published_at: actionTimestamp,
          engagement_metrics: {
            action: 'publish',
            result: 'published',
            initiated_via: initiatedVia,
            initiated_by: userId,
            request_id: requestId,
            attempted_at: actionTimestamp,
          },
        })

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

      await supabase
        .from('published_posts')
        .insert({
          content_draft_id: draftId,
          social_connection_id: connection.id,
          status: 'failed',
          error_message: errorMessage,
          engagement_metrics: {
            action: 'publish',
            result: 'failed',
            retryable: publishError.retryable,
            initiated_via: initiatedVia,
            initiated_by: userId,
            request_id: requestId,
            attempted_at: actionTimestamp,
          },
        })

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
    await supabase
      .from('content_drafts')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .eq('id', draftId)
  }

  return {
    success: allSuccess,
    retryableFailureCount: retryableFailures.length,
    permanentFailureCount: permanentFailures.length,
    results,
  }
}

// Publish to Instagram via Facebook Graph API
async function publishToInstagram(
  connection: {
    account_id: string
    page_access_token: string
  },
  draft: {
    caption: string
    hashtags: string[]
    media_urls: string[]
    media_type: string
  }
): Promise<{ postId: string; postUrl: string }> {
  const { account_id, page_access_token } = connection
  if (!account_id || !page_access_token) {
    throw new PublishProviderError('Instagram connection is missing required credentials', false)
  }
  const fullCaption = `${draft.caption}\n\n${draft.hashtags.map(h => `#${h}`).join(' ')}`

  // Instagram requires media to be hosted at a public URL
  // For now, we'll handle image posts only
  if (!draft.media_urls?.length) {
    throw new Error('Instagram requires an image or video')
  }

  const mediaUrl = draft.media_urls[0]

  // Step 1: Create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v18.0/${account_id}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: mediaUrl,
        caption: fullCaption,
        access_token: page_access_token
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
    `https://graph.facebook.com/v18.0/${account_id}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: page_access_token
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
  connection: {
    page_id: string
    page_access_token: string
  },
  draft: {
    caption: string
    hashtags: string[]
    media_urls: string[]
    media_type: string
  }
): Promise<{ postId: string; postUrl: string }> {
  const { page_id, page_access_token } = connection
  if (!page_id || !page_access_token) {
    throw new PublishProviderError('Facebook connection is missing required credentials', false)
  }
  const message = `${draft.caption}\n\n${draft.hashtags.map(h => `#${h}`).join(' ')}`

  let endpoint = `https://graph.facebook.com/v18.0/${page_id}/feed`
  const body: Record<string, string> = {
    message,
    access_token: page_access_token
  }

  // If there's an image, post as photo
  if (draft.media_urls?.length && draft.media_type === 'image') {
    endpoint = `https://graph.facebook.com/v18.0/${page_id}/photos`
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
  connection: {
    account_id: string
    access_token: string
  },
  draft: {
    caption: string
    hashtags: string[]
    media_urls: string[]
    media_type: string
  }
): Promise<{ postId: string; postUrl: string }> {
  const { account_id, access_token } = connection
  if (!account_id || !access_token) {
    throw new PublishProviderError('LinkedIn connection is missing required credentials', false)
  }
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
    author: `urn:li:person:${account_id}`,
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

  // If there's an image, add it (LinkedIn requires image to be uploaded first for proper support)
  // For MVP, we'll use external image URL (works for most cases)
  if (draft.media_urls?.length && draft.media_type === 'image') {
    postData.specificContent['com.linkedin.ugc.ShareContent'].media = [{
      status: 'READY',
      originalUrl: draft.media_urls[0]
    }]
  }

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${access_token}`,
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

