/**
 * ReviewFlow provider adapters.
 *
 * One typed capability contract per review source so unsupported behavior is
 * explicit instead of implied. Direct reply execution is currently supported
 * only for Google Business Profile owner accounts (OAuth access token +
 * account/location mapping + GBP review resource name). Everything else is
 * manual-confirmation mode with a provider deep link.
 */

export type ProviderCapabilities = {
  ingest: boolean
  deepLink: boolean
  reply: boolean
  verifyReply: boolean
  deleteReply: boolean
  limitation: string | null
}

export type ConnectionForCapabilities = {
  platform: string
  place_id?: string | null
  google_maps_url?: string | null
  yelp_business_url?: string | null
  yelp_business_id?: string | null
  access_token?: string | null
  account_id?: string | null
  is_active?: boolean | null
}

export class ProviderExecutionError extends Error {
  readonly retryable: boolean
  readonly statusCode: number | null

  constructor(message: string, options: { retryable: boolean; statusCode?: number | null }) {
    super(message)
    this.name = 'ProviderExecutionError'
    this.retryable = options.retryable
    this.statusCode = options.statusCode ?? null
  }
}

const GBP_API_BASE = process.env.GOOGLE_BUSINESS_PROFILE_API_BASE || 'https://mybusiness.googleapis.com/v4'

/** A GBP review resource name looks like accounts/{a}/locations/{l}/reviews/{r}. */
export function resolveGbpReviewName(review: {
  platform_review_id?: string | null
  raw_data?: unknown
}): string | null {
  if (
    typeof review.platform_review_id === 'string' &&
    review.platform_review_id.startsWith('accounts/') &&
    review.platform_review_id.includes('/reviews/')
  ) {
    return review.platform_review_id
  }
  const raw = review.raw_data
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const name = (raw as Record<string, unknown>).gbp_review_name
    if (typeof name === 'string' && name.startsWith('accounts/') && name.includes('/reviews/')) {
      return name
    }
  }
  return null
}

export function getProviderCapabilities(
  connection: ConnectionForCapabilities | null,
  review?: { platform_review_id?: string | null; raw_data?: unknown }
): ProviderCapabilities {
  if (!connection) {
    return {
      ingest: false,
      deepLink: false,
      reply: false,
      verifyReply: false,
      deleteReply: false,
      limitation: 'No active connection for this source; manual handling only.',
    }
  }

  switch (connection.platform) {
    case 'google': {
      const hasOwnerAuth = Boolean(connection.access_token && connection.account_id)
      const hasReviewName = review ? resolveGbpReviewName(review) !== null : false
      const canReply = hasOwnerAuth && (review ? hasReviewName : true)
      return {
        ingest: Boolean(connection.place_id || connection.google_maps_url),
        deepLink: Boolean(connection.place_id || connection.google_maps_url),
        reply: canReply,
        verifyReply: canReply,
        deleteReply: canReply,
        limitation: hasOwnerAuth
          ? review && !hasReviewName
            ? 'Review lacks a Business Profile review ID; owner-API reply unavailable for this review.'
            : null
          : 'Google owner account is not connected; replies require manual posting with confirmation.',
      }
    }
    case 'yelp':
      return {
        ingest: Boolean(connection.yelp_business_id || connection.yelp_business_url),
        deepLink: Boolean(connection.yelp_business_url || connection.yelp_business_id),
        reply: false,
        verifyReply: false,
        deleteReply: false,
        limitation:
          'Yelp reply APIs require verified partner access; replies are manual with confirmation. Yelp API returns only the 3 most recent reviews.',
      }
    default:
      return {
        ingest: false,
        deepLink: false,
        reply: false,
        verifyReply: false,
        deleteReply: false,
        limitation: `${connection.platform} has no automated integration; manual handling only.`,
      }
  }
}

export function getProviderDeepLink(
  platform: string,
  connection: ConnectionForCapabilities | null
): string | null {
  if (!connection) return null
  if (platform === 'google') {
    if (connection.place_id) {
      return `https://search.google.com/local/reviews?placeid=${encodeURIComponent(connection.place_id)}`
    }
    return connection.google_maps_url || null
  }
  if (platform === 'yelp') {
    if (connection.yelp_business_url) return connection.yelp_business_url
    if (connection.yelp_business_id) {
      return `https://www.yelp.com/biz/${encodeURIComponent(connection.yelp_business_id)}`
    }
  }
  return null
}

export type ProviderReplyResult = {
  providerPostId: string
  providerPostUrl: string | null
  verified: boolean
  raw: unknown
}

/**
 * Post (create or update) the owner reply on a Google Business Profile
 * review, then read it back for verification.
 */
export async function postGoogleReply(input: {
  accessToken: string
  reviewName: string
  responseText: string
}): Promise<ProviderReplyResult> {
  const url = `${GBP_API_BASE}/${input.reviewName}/reply`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment: input.responseText }),
      signal: AbortSignal.timeout(30000),
    })
  } catch (error) {
    throw new ProviderExecutionError(
      `Google Business Profile unreachable: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { retryable: true }
    )
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && payload !== null
        ? String((payload as { error?: { message?: string } }).error?.message || `GBP error ${response.status}`)
        : `GBP error ${response.status}`
    throw new ProviderExecutionError(message, {
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status,
    })
  }

  // Verify by reading the review back.
  let verified = false
  try {
    const verifyResponse = await fetch(`${GBP_API_BASE}/${input.reviewName}`, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(15000),
    })
    if (verifyResponse.ok) {
      const review = (await verifyResponse.json()) as { reviewReply?: { comment?: string } }
      verified = Boolean(
        review.reviewReply?.comment && review.reviewReply.comment.trim() === input.responseText.trim()
      )
    }
  } catch {
    verified = false
  }

  return {
    providerPostId: `${input.reviewName}/reply`,
    providerPostUrl: null,
    verified,
    raw: payload,
  }
}
