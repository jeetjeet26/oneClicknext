/**
 * TikTok adapter: creator-info preflight, direct post via PULL_FROM_URL,
 * and publish-status polling. Until the app passes TikTok's audit, posts
 * should go out as SELF_ONLY (private) — controlled by platformOptions or the
 * FORGESTUDIO_TIKTOK_PRIVACY env default.
 */

import { assertSafeMediaUrl } from '@/utils/forgestudio/safe-media-fetch'
import {
  AdapterError,
  adapterErrorFromResponse,
  composeCaption,
  sleep,
  toAdapterError,
  type AdapterVariant,
  type PublishOutcome,
  type SocialAdapter,
} from './types'

const TIKTOK_BASE = 'https://open.tiktokapis.com'
const STATUS_POLL_INTERVAL_MS = 5_000
const STATUS_POLL_MAX_ATTEMPTS = 24

type TikTokEnvelope<T> = {
  data?: T
  error?: { code?: string; message?: string }
}

async function tiktokRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${TIKTOK_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    throw toAdapterError(error, init.method === 'POST' ? 'after_send' : 'before_send')
  }

  const payload = (await response.json().catch(() => ({}))) as TikTokEnvelope<T>
  const errorCode = payload.error?.code
  if (!response.ok || (errorCode && errorCode !== 'ok')) {
    const message = payload.error?.message || `TikTok API error (${response.status})`
    if (errorCode === 'rate_limit_exceeded') {
      throw new AdapterError(message, 'retryable', { providerCode: errorCode })
    }
    throw adapterErrorFromResponse(response.status, message, errorCode)
  }
  if (!payload.data) {
    throw new AdapterError('TikTok returned an empty response', 'ambiguous')
  }
  return payload.data
}

function defaultPrivacyLevel(variant: AdapterVariant): string {
  const fromOptions = variant.platformOptions?.privacyLevel
  if (typeof fromOptions === 'string' && fromOptions) return fromOptions
  return process.env.FORGESTUDIO_TIKTOK_PRIVACY || 'SELF_ONLY'
}

export const tiktokAdapter: SocialAdapter = {
  platform: 'tiktok',

  async preflight(connection, variant) {
    if (!connection.accessToken) {
      throw new AdapterError('TikTok connection is missing an access token', 'permanent')
    }
    if (variant.mediaUrls.length === 0) {
      throw new AdapterError('TikTok requires a video (or images for photo posts)', 'permanent')
    }
    for (const url of variant.mediaUrls) assertSafeMediaUrl(url)

    // Creator-info preflight: confirms posting capability and allowed privacy levels.
    const creator = await tiktokRequest<{
      privacy_level_options?: string[]
      max_video_post_duration_sec?: number
    }>('/v2/post/publish/creator_info/query/', connection.accessToken, { method: 'POST' })

    const privacy = defaultPrivacyLevel(variant)
    if (
      creator.privacy_level_options?.length &&
      !creator.privacy_level_options.includes(privacy)
    ) {
      throw new AdapterError(
        `TikTok privacy level ${privacy} is not allowed for this creator (allowed: ${creator.privacy_level_options.join(', ')})`,
        'permanent'
      )
    }
  },

  async publish(connection, variant): Promise<PublishOutcome> {
    const accessToken = connection.accessToken as string
    const title = composeCaption(variant).slice(0, 2200)
    const privacy = defaultPrivacyLevel(variant)
    const isVideo = ['video', 'reel'].includes(variant.contentFormat)

    let publishId: string

    if (isVideo) {
      const init = await tiktokRequest<{ publish_id?: string }>(
        '/v2/post/publish/video/init/',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            post_info: {
              title,
              privacy_level: privacy,
              disable_comment: false,
              disable_duet: false,
              disable_stitch: false,
            },
            source_info: {
              source: 'PULL_FROM_URL',
              video_url: variant.mediaUrls[0],
            },
          }),
        }
      )
      if (!init.publish_id) throw new AdapterError('TikTok did not return a publish id', 'ambiguous')
      publishId = init.publish_id
    } else {
      const init = await tiktokRequest<{ publish_id?: string }>(
        '/v2/post/publish/content/init/',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            post_info: {
              title,
              privacy_level: privacy,
            },
            source_info: {
              source: 'PULL_FROM_URL',
              photo_cover_index: 0,
              photo_images: variant.mediaUrls.slice(0, 10),
            },
            post_mode: 'DIRECT_POST',
            media_type: 'PHOTO',
          }),
        }
      )
      if (!init.publish_id) throw new AdapterError('TikTok did not return a publish id', 'ambiguous')
      publishId = init.publish_id
    }

    // Poll processing status until the post is live or fails.
    for (let attempt = 0; attempt < STATUS_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(STATUS_POLL_INTERVAL_MS)
      const status = await tiktokRequest<{
        status?: string
        publicaly_available_post_id?: string[]
        publicly_available_post_id?: string[]
        fail_reason?: string
      }>('/v2/post/publish/status/fetch/', accessToken, {
        method: 'POST',
        body: JSON.stringify({ publish_id: publishId }),
      })

      if (status.status === 'PUBLISH_COMPLETE') {
        const postIds =
          status.publicly_available_post_id || status.publicaly_available_post_id || []
        return {
          providerPostId: postIds[0] ? String(postIds[0]) : publishId,
          providerPostUrl: postIds[0] ? `https://www.tiktok.com/@_/video/${postIds[0]}` : null,
        }
      }
      if (status.status === 'FAILED') {
        throw new AdapterError(
          `TikTok publish failed: ${status.fail_reason || 'unknown reason'}`,
          'permanent'
        )
      }
      // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / SEND_TO_USER_INBOX → keep polling.
    }

    // Still processing after the poll budget — ambiguous, reconcile later.
    throw new AdapterError(
      `TikTok publish ${publishId} still processing after poll timeout`,
      'ambiguous'
    )
  },

  async refreshToken(connection, appCredentials) {
    if (!connection.refreshToken) return null
    try {
      const response = await fetch(`${TIKTOK_BASE}/v2/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: appCredentials.appId,
          client_secret: appCredentials.appSecret,
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
}
