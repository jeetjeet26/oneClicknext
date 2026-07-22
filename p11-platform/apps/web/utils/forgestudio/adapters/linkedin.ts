/**
 * LinkedIn adapter using the versioned Posts API (not the legacy UGC
 * endpoint): explicit member/organization authors and registered image
 * uploads via the Images API.
 */

import { fetchMediaSafely, assertSafeMediaUrl } from '@/utils/forgestudio/safe-media-fetch'
import {
  AdapterError,
  adapterErrorFromResponse,
  composeCaption,
  toAdapterError,
  type AdapterConnection,
  type PublishOutcome,
  type SocialAdapter,
} from './types'

const LINKEDIN_BASE = 'https://api.linkedin.com'
const LINKEDIN_VERSION = '202411'

function authorUrn(connection: AdapterConnection): string {
  // Organization pages store their URN id in pageId; members use accountId.
  if (connection.pageId) {
    return connection.pageId.startsWith('urn:')
      ? connection.pageId
      : `urn:li:organization:${connection.pageId}`
  }
  return connection.accountId.startsWith('urn:')
    ? connection.accountId
    : `urn:li:person:${connection.accountId}`
}

async function linkedInRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<Response> {
  try {
    return await fetch(`${LINKEDIN_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    throw toAdapterError(error, init.method === 'POST' ? 'after_send' : 'before_send')
  }
}

async function uploadImage(
  connection: AdapterConnection,
  accessToken: string,
  mediaUrl: string
): Promise<string> {
  // 1. Register the upload.
  const initResponse = await linkedInRequest('/rest/images?action=initializeUpload', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      initializeUploadRequest: { owner: authorUrn(connection) },
    }),
  })
  const initData = (await initResponse.json().catch(() => ({}))) as {
    value?: { uploadUrl?: string; image?: string }
    message?: string
  }
  if (!initResponse.ok || !initData.value?.uploadUrl || !initData.value.image) {
    throw adapterErrorFromResponse(
      initResponse.status,
      initData.message || 'LinkedIn image upload initialization failed'
    )
  }

  // 2. Fetch the media (SSRF-safe) and PUT the bytes.
  const media = await fetchMediaSafely(mediaUrl)
  const uploadResponse = await fetch(initData.value.uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': media.contentType || 'application/octet-stream',
    },
    body: new Uint8Array(media.data),
  })
  if (!uploadResponse.ok) {
    throw adapterErrorFromResponse(uploadResponse.status, 'LinkedIn image byte upload failed')
  }

  return initData.value.image
}

export const linkedinAdapter: SocialAdapter = {
  platform: 'linkedin',

  preflight(connection, variant) {
    if (!connection.accessToken) {
      throw new AdapterError('LinkedIn connection is missing an access token', 'permanent')
    }
    if (!connection.accountId && !connection.pageId) {
      throw new AdapterError('LinkedIn connection has no author (member or organization)', 'permanent')
    }
    for (const url of variant.mediaUrls) assertSafeMediaUrl(url)
    if (composeCaption(variant).length > 3000) {
      throw new AdapterError('LinkedIn post exceeds 3,000 characters', 'permanent')
    }
  },

  async publish(connection, variant): Promise<PublishOutcome> {
    const accessToken = connection.accessToken as string
    const commentary = composeCaption(variant)

    const post: Record<string, unknown> = {
      author: authorUrn(connection),
      commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }

    if (variant.mediaUrls.length > 0 && variant.contentFormat !== 'text') {
      const imageUrn = await uploadImage(connection, accessToken, variant.mediaUrls[0])
      post.content = {
        media: { id: imageUrn, ...(variant.altText ? { altText: variant.altText } : {}) },
      }
    } else if (variant.linkUrl) {
      post.content = { article: { source: variant.linkUrl } }
    }

    const response = await linkedInRequest('/rest/posts', accessToken, {
      method: 'POST',
      body: JSON.stringify(post),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string; code?: string }
      throw adapterErrorFromResponse(
        response.status,
        data.message || `LinkedIn post creation failed (${response.status})`,
        data.code
      )
    }

    // The Posts API returns the post URN in the x-restli-id header.
    const postUrn = response.headers.get('x-restli-id')
    if (!postUrn) {
      throw new AdapterError('LinkedIn did not return a post id', 'ambiguous')
    }

    return {
      providerPostId: postUrn,
      providerPostUrl: `https://www.linkedin.com/feed/update/${postUrn}/`,
    }
  },

  async refreshToken(connection, appCredentials) {
    if (!connection.refreshToken) return null
    try {
      const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refreshToken,
          client_id: appCredentials.appId,
          client_secret: appCredentials.appSecret,
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
