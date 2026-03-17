import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { evaluateForgeStudioDraftReadiness } from '@/utils/services/forgestudio-draft-readiness'

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

    const body = await request.json()
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

    // Get the connections
    const { data: connections, error: connError } = await supabase
      .from('social_connections')
      .select('*')
      .in('id', uniqueConnectionIds)
      .eq('is_active', true)
      .eq('property_id', draft.property_id)

    if (connError || !connections?.length || connections.length !== uniqueConnectionIds.length) {
      return NextResponse.json(
        { error: 'Some requested connections are invalid, inactive, or belong to another property' },
        { status: 400 }
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

    // Publish to each connection
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
          // Keep an explicit audit trail for no-op idempotent publish calls.
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

        // Save published post record
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

        // Update last used
        await supabase
          .from('social_connections')
          .update({ last_used_at: new Date().toISOString(), error_count: 0, last_error: null })
          .eq('id', connection.id)

        results.push({
          connectionId: connection.id,
          platform: connection.platform,
          success: true,
          postId: result.postId,
          postUrl: result.postUrl
        })

      } catch (error) {
        const publishError = toPublishProviderError(error, 'Publishing failed')
        const errorMessage = publishError.message
        
        // Update error count
        await supabase
          .from('social_connections')
          .update({ 
            error_count: (connection.error_count || 0) + 1,
            last_error: errorMessage
          })
          .eq('id', connection.id)

        // Save failed attempt
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
          error: errorMessage
        })
      }
    }

    // Update draft status if all published successfully
    const allSuccess = results.every(r => r.success)
    const retryableFailures = results.filter(r => !r.success && r.retryable)
    const permanentFailures = results.filter(r => !r.success && !r.retryable)
    if (allSuccess) {
      await supabase
        .from('content_drafts')
        .update({ 
          status: 'published',
          published_at: new Date().toISOString()
        })
        .eq('id', draftId)
    }

    return NextResponse.json({
      success: allSuccess,
      retryableFailureCount: retryableFailures.length,
      permanentFailureCount: permanentFailures.length,
      results
    })

  } catch (error) {
    console.error('Publishing error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Publishing failed' },
      { status: 500 }
    )
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

