/**
 * X (Twitter) adapter: OAuth 2.0 user-context tokens with refresh, weighted
 * tweet-length validation, chunked media upload, and POST /2/tweets.
 *
 * Posting requires a paid API tier; capability problems surface as permanent
 * errors with the provider's message.
 */

import { fetchMediaSafely, assertSafeMediaUrl } from '@/utils/forgestudio/safe-media-fetch'
import {
  AdapterError,
  adapterErrorFromResponse,
  composeCaption,
  sleep,
  toAdapterError,
  type PublishOutcome,
  type SocialAdapter,
} from './types'

const X_API_BASE = 'https://api.x.com'
const MAX_WEIGHTED_LENGTH = 280
const URL_WEIGHT = 23

/**
 * Weighted tweet length per X's counting rules (simplified): URLs count as 23
 * regardless of length; most CJK/emoji ranges count as 2; everything else 1.
 */
export function weightedTweetLength(text: string): number {
  const urlPattern = /https?:\/\/\S+/g
  let length = 0
  let rest = text

  const urls = text.match(urlPattern) ?? []
  for (const url of urls) {
    length += URL_WEIGHT
    rest = rest.replace(url, '')
  }

  for (const char of rest) {
    const codePoint = char.codePointAt(0) ?? 0
    const isLightweight =
      (codePoint >= 0x0000 && codePoint <= 0x10ff) ||
      (codePoint >= 0x2000 && codePoint <= 0x200d) ||
      (codePoint >= 0x2010 && codePoint <= 0x201f) ||
      (codePoint >= 0x2032 && codePoint <= 0x2037)
    length += isLightweight ? 1 : 2
  }
  return length
}

type XErrorPayload = {
  detail?: string
  title?: string
  errors?: Array<{ message?: string }>
}

async function xRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${X_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    throw toAdapterError(error, init.method === 'POST' ? 'after_send' : 'before_send')
  }

  const data = (await response.json().catch(() => ({}))) as T & XErrorPayload
  if (!response.ok) {
    const message =
      data.detail || data.title || data.errors?.[0]?.message || `X API error (${response.status})`
    throw adapterErrorFromResponse(response.status, message)
  }
  return data
}

async function uploadMedia(
  accessToken: string,
  mediaUrl: string,
  isVideo: boolean
): Promise<string> {
  const media = await fetchMediaSafely(mediaUrl)
  const totalBytes = media.data.length
  const mediaType = media.contentType || (isVideo ? 'video/mp4' : 'image/jpeg')
  const mediaCategory = isVideo ? 'tweet_video' : 'tweet_image'

  // INIT
  const init = await xRequest<{ data?: { id?: string }; media_id_string?: string }>(
    '/2/media/upload/initialize',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total_bytes: totalBytes,
        media_type: mediaType,
        media_category: mediaCategory,
      }),
    }
  )
  const mediaId = init.data?.id || init.media_id_string
  if (!mediaId) throw new AdapterError('X media upload initialization failed', 'retryable')

  // APPEND in 4MB chunks
  const chunkSize = 4 * 1024 * 1024
  for (let offset = 0, segment = 0; offset < totalBytes; offset += chunkSize, segment++) {
    const chunk = media.data.subarray(offset, Math.min(offset + chunkSize, totalBytes))
    const form = new FormData()
    form.set('segment_index', String(segment))
    form.set('media', new Blob([new Uint8Array(chunk)], { type: mediaType }))
    const response = await fetch(`${X_API_BASE}/2/media/upload/${mediaId}/append`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    })
    if (!response.ok) {
      throw adapterErrorFromResponse(response.status, 'X media chunk upload failed')
    }
  }

  // FINALIZE (+ processing wait for video)
  const finalize = await xRequest<{
    data?: { id?: string; processing_info?: { state?: string; check_after_secs?: number } }
  }>(`/2/media/upload/${mediaId}/finalize`, accessToken, { method: 'POST' })

  let processing = finalize.data?.processing_info
  let waited = 0
  while (processing && ['pending', 'in_progress'].includes(processing.state ?? '')) {
    if (waited > 120_000) {
      throw new AdapterError('X media processing timed out', 'retryable')
    }
    const waitMs = (processing.check_after_secs ?? 3) * 1000
    await sleep(waitMs)
    waited += waitMs
    const status = await xRequest<{
      data?: { processing_info?: { state?: string; check_after_secs?: number } }
    }>(`/2/media/upload?media_id=${mediaId}&command=STATUS`, accessToken)
    processing = status.data?.processing_info
  }
  if (processing?.state === 'failed') {
    throw new AdapterError('X media processing failed', 'permanent')
  }

  return mediaId
}

export const xAdapter: SocialAdapter = {
  platform: 'x',

  preflight(connection, variant) {
    if (!connection.accessToken) {
      throw new AdapterError('X connection is missing an access token', 'permanent')
    }
    for (const url of variant.mediaUrls) assertSafeMediaUrl(url)
    const weighted = weightedTweetLength(composeCaption(variant))
    if (weighted > MAX_WEIGHTED_LENGTH) {
      throw new AdapterError(
        `Post is ${weighted} weighted characters; X allows ${MAX_WEIGHTED_LENGTH}`,
        'permanent'
      )
    }
  },

  async publish(connection, variant): Promise<PublishOutcome> {
    const accessToken = connection.accessToken as string
    const text = composeCaption(variant)

    const body: Record<string, unknown> = { text }
    if (variant.mediaUrls.length > 0 && variant.contentFormat !== 'text') {
      const isVideo = ['video', 'reel'].includes(variant.contentFormat)
      const mediaIds: string[] = []
      for (const mediaUrl of variant.mediaUrls.slice(0, isVideo ? 1 : 4)) {
        mediaIds.push(await uploadMedia(accessToken, mediaUrl, isVideo))
      }
      body.media = { media_ids: mediaIds }
    }

    const created = await xRequest<{ data?: { id?: string } }>('/2/tweets', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const tweetId = created.data?.id
    if (!tweetId) {
      throw new AdapterError('X did not return a tweet id', 'ambiguous')
    }
    return {
      providerPostId: tweetId,
      providerPostUrl: `https://x.com/i/status/${tweetId}`,
    }
  },

  async refreshToken(connection, appCredentials) {
    if (!connection.refreshToken) return null
    try {
      const basic = Buffer.from(`${appCredentials.appId}:${appCredentials.appSecret}`).toString(
        'base64'
      )
      const response = await fetch(`${X_API_BASE}/2/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refreshToken,
        }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
      }
      if (!response.ok || !data.access_token) return null
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? connection.refreshToken,
        tokenExpiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : null,
      }
    } catch {
      return null
    }
  },

  async reconcile(connection, variant): Promise<PublishOutcome | null> {
    const accessToken = connection.accessToken as string
    const text = composeCaption(variant)
    try {
      const timeline = await xRequest<{
        data?: Array<{ id: string; text: string; created_at?: string }>
      }>(
        `/2/users/${connection.accountId}/tweets?max_results=10&tweet.fields=created_at`,
        accessToken
      )
      const cutoff = Date.now() - 60 * 60 * 1000
      // X truncates t.co links in returned text, so compare a prefix.
      const prefix = text.slice(0, 80)
      const match = (timeline.data ?? []).find(
        (tweet) =>
          tweet.text.startsWith(prefix.slice(0, Math.min(prefix.length, tweet.text.length))) &&
          (!tweet.created_at || Date.parse(tweet.created_at) >= cutoff)
      )
      return match
        ? { providerPostId: match.id, providerPostUrl: `https://x.com/i/status/${match.id}` }
        : null
    } catch {
      return null
    }
  },
}
