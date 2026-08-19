/**
 * Meta adapters: Instagram (Graph media containers with processing polling)
 * and Facebook Pages (text / photo / video).
 */

import { assertSafeMediaUrl } from '@/utils/forgestudio/safe-media-fetch'
import {
  AdapterError,
  adapterErrorFromResponse,
  composeCaption,
  sleep,
  toAdapterError,
  type AdapterConnection,
  type EngagementMetrics,
  type PublishOutcome,
  type SocialAdapter,
} from './types'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'
const CONTAINER_POLL_INTERVAL_MS = 3_000
const CONTAINER_POLL_MAX_ATTEMPTS = 20

type GraphError = { error?: { message?: string; code?: number; is_transient?: boolean } }
type InsightResponse = {
  data?: Array<{ name: string; values?: Array<{ value?: number }> }>
}

function insightValue(response: InsightResponse, name: string): number | undefined {
  const value = response.data?.find((item) => item.name === name)?.values?.[0]?.value
  return typeof value === 'number' ? value : undefined
}

async function graphRequest<T>(
  path: string,
  init: RequestInit & { searchParams?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`)
  for (const [key, value] of Object.entries(init.searchParams ?? {})) {
    url.searchParams.set(key, value)
  }
  let response: Response
  try {
    response = await fetch(url.toString(), init)
  } catch (error) {
    throw toAdapterError(error, init.method === 'POST' ? 'after_send' : 'before_send')
  }

  const data = (await response.json().catch(() => ({}))) as T & GraphError
  if (!response.ok || data.error) {
    const message = data.error?.message || `Meta API error (${response.status})`
    if (data.error?.is_transient) {
      throw new AdapterError(message, 'retryable', { providerStatus: response.status })
    }
    throw adapterErrorFromResponse(response.status, message, String(data.error?.code ?? ''))
  }
  return data
}

async function waitForContainer(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < CONTAINER_POLL_MAX_ATTEMPTS; attempt++) {
    const status = await graphRequest<{ status_code?: string }>(`/${containerId}`, {
      searchParams: { fields: 'status_code', access_token: accessToken },
    })
    if (status.status_code === 'FINISHED') return
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new AdapterError(
        `Instagram media container ${status.status_code.toLowerCase()}`,
        'permanent'
      )
    }
    await sleep(CONTAINER_POLL_INTERVAL_MS)
  }
  throw new AdapterError('Instagram media container processing timed out', 'retryable')
}

function requireInstagramCredentials(connection: AdapterConnection): {
  accountId: string
  token: string
} {
  const token = connection.pageAccessToken || connection.accessToken
  if (!connection.accountId || !token) {
    throw new AdapterError('Instagram connection is missing credentials', 'permanent')
  }
  return { accountId: connection.accountId, token }
}

export const instagramAdapter: SocialAdapter = {
  platform: 'instagram',

  preflight(connection, variant) {
    requireInstagramCredentials(connection)
    if (variant.mediaUrls.length === 0) {
      throw new AdapterError('Instagram requires an image or video', 'permanent')
    }
    for (const url of variant.mediaUrls) assertSafeMediaUrl(url)
    if (composeCaption(variant).length > 2200) {
      throw new AdapterError('Instagram caption exceeds 2,200 characters', 'permanent')
    }
  },

  async publish(connection, variant): Promise<PublishOutcome> {
    const { accountId, token } = requireInstagramCredentials(connection)
    const caption = composeCaption(variant)
    const isVideo = ['video', 'reel'].includes(variant.contentFormat)
    const isCarousel = variant.contentFormat === 'carousel' && variant.mediaUrls.length > 1

    let containerId: string

    if (isCarousel) {
      // 1. Child containers for each image.
      const childIds: string[] = []
      for (const mediaUrl of variant.mediaUrls.slice(0, 10)) {
        const child = await graphRequest<{ id: string }>(`/${accountId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: mediaUrl,
            is_carousel_item: true,
            access_token: token,
          }),
        })
        childIds.push(child.id)
      }
      for (const childId of childIds) await waitForContainer(childId, token)

      const carousel = await graphRequest<{ id: string }>(`/${accountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: childIds,
          caption,
          access_token: token,
        }),
      })
      containerId = carousel.id
    } else {
      const body: Record<string, unknown> = { caption, access_token: token }
      if (isVideo) {
        body.media_type = 'REELS'
        body.video_url = variant.mediaUrls[0]
      } else {
        body.image_url = variant.mediaUrls[0]
      }
      const container = await graphRequest<{ id: string }>(`/${accountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      containerId = container.id
    }

    // Videos (and sometimes images) process asynchronously.
    await waitForContainer(containerId, token)

    const published = await graphRequest<{ id: string }>(`/${accountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: containerId, access_token: token }),
    })

    // Resolve the canonical permalink instead of guessing the URL shape.
    let permalink: string | null = null
    try {
      const detail = await graphRequest<{ permalink?: string }>(`/${published.id}`, {
        searchParams: { fields: 'permalink', access_token: token },
      })
      permalink = detail.permalink ?? null
    } catch {
      permalink = null
    }

    return { providerPostId: published.id, providerPostUrl: permalink }
  },

  async reconcile(connection, variant): Promise<PublishOutcome | null> {
    const { accountId, token } = requireInstagramCredentials(connection)
    const caption = composeCaption(variant)
    try {
      const recent = await graphRequest<{
        data?: Array<{ id: string; caption?: string; permalink?: string; timestamp?: string }>
      }>(`/${accountId}/media`, {
        searchParams: { fields: 'id,caption,permalink,timestamp', limit: '10', access_token: token },
      })
      const cutoff = Date.now() - 60 * 60 * 1000
      const match = (recent.data ?? []).find(
        (post) =>
          post.caption === caption &&
          (!post.timestamp || Date.parse(post.timestamp) >= cutoff)
      )
      return match
        ? { providerPostId: match.id, providerPostUrl: match.permalink ?? null }
        : null
    } catch {
      return null
    }
  },

  async fetchMetrics(connection, providerPostId): Promise<EngagementMetrics> {
    const { token } = requireInstagramCredentials(connection)
    const [detail, insights] = await Promise.all([
      graphRequest<{ like_count?: number; comments_count?: number }>(`/${providerPostId}`, {
        searchParams: { fields: 'like_count,comments_count', access_token: token },
      }),
      graphRequest<InsightResponse>(`/${providerPostId}/insights`, {
        searchParams: {
          metric: 'reach,saved,shares,views,total_interactions',
          access_token: token,
        },
      }).catch(() => ({ data: [] })),
    ])
    return {
      reach: insightValue(insights, 'reach'),
      reactions: detail.like_count,
      comments: detail.comments_count,
      shares: insightValue(insights, 'shares'),
      saves: insightValue(insights, 'saved'),
      videoViews: insightValue(insights, 'views'),
      providerPayload: { detail, insights },
    }
  },
}

function requireFacebookCredentials(connection: AdapterConnection): {
  pageId: string
  token: string
} {
  if (!connection.pageId || !connection.pageAccessToken) {
    throw new AdapterError('Facebook connection is missing page credentials', 'permanent')
  }
  return { pageId: connection.pageId, token: connection.pageAccessToken }
}

export const facebookAdapter: SocialAdapter = {
  platform: 'facebook',

  preflight(connection, variant) {
    requireFacebookCredentials(connection)
    for (const url of variant.mediaUrls) assertSafeMediaUrl(url)
  },

  async publish(connection, variant): Promise<PublishOutcome> {
    const { pageId, token } = requireFacebookCredentials(connection)
    const message = composeCaption(variant)
    const isVideo = ['video', 'reel'].includes(variant.contentFormat) && variant.mediaUrls.length > 0
    const isPhoto = !isVideo && variant.mediaUrls.length > 0

    let endpoint: string
    const body: Record<string, unknown> = { access_token: token }

    if (isVideo) {
      endpoint = `/${pageId}/videos`
      body.file_url = variant.mediaUrls[0]
      body.description = message
    } else if (isPhoto) {
      endpoint = `/${pageId}/photos`
      body.url = variant.mediaUrls[0]
      body.message = message
    } else {
      endpoint = `/${pageId}/feed`
      body.message = message
      if (variant.linkUrl) body.link = variant.linkUrl
    }

    const data = await graphRequest<{ id?: string; post_id?: string }>(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const postId = data.post_id || data.id
    if (!postId) {
      throw new AdapterError('Facebook did not return a post id', 'ambiguous')
    }
    return {
      providerPostId: postId,
      providerPostUrl: `https://www.facebook.com/${postId}`,
    }
  },

  async reconcile(connection, variant): Promise<PublishOutcome | null> {
    const { pageId, token } = requireFacebookCredentials(connection)
    const message = composeCaption(variant)
    try {
      const recent = await graphRequest<{
        data?: Array<{ id: string; message?: string; permalink_url?: string; created_time?: string }>
      }>(`/${pageId}/posts`, {
        searchParams: {
          fields: 'id,message,permalink_url,created_time',
          limit: '10',
          access_token: token,
        },
      })
      const cutoff = Date.now() - 60 * 60 * 1000
      const match = (recent.data ?? []).find(
        (post) =>
          post.message === message &&
          (!post.created_time || Date.parse(post.created_time) >= cutoff)
      )
      return match
        ? { providerPostId: match.id, providerPostUrl: match.permalink_url ?? null }
        : null
    } catch {
      return null
    }
  },

  async fetchMetrics(connection, providerPostId): Promise<EngagementMetrics> {
    const { token } = requireFacebookCredentials(connection)
    const [detail, insights] = await Promise.all([
      graphRequest<{
        shares?: { count?: number }
        comments?: { summary?: { total_count?: number } }
        reactions?: { summary?: { total_count?: number } }
      }>(`/${providerPostId}`, {
        searchParams: {
          fields: 'shares,comments.summary(true),reactions.summary(true)',
          access_token: token,
        },
      }),
      graphRequest<InsightResponse>(`/${providerPostId}/insights`, {
        searchParams: {
          metric: 'post_impressions,post_clicks,post_video_views',
          access_token: token,
        },
      }).catch(() => ({ data: [] })),
    ])
    return {
      impressions: insightValue(insights, 'post_impressions'),
      clicks: insightValue(insights, 'post_clicks'),
      videoViews: insightValue(insights, 'post_video_views'),
      reactions: detail.reactions?.summary?.total_count,
      comments: detail.comments?.summary?.total_count,
      shares: detail.shares?.count,
      providerPayload: { detail, insights },
    }
  },
}
