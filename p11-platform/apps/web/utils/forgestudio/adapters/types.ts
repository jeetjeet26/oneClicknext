/**
 * Common contract for ForgeStudio social channel adapters.
 *
 * Adapters are deterministic: they validate, upload, publish, verify, and
 * classify failures. They never generate content and never touch the database
 * — the publication worker owns all persistence.
 */

import type { SocialPlatform } from '@/utils/forgestudio/content-contract'

export type ErrorClassification = 'retryable' | 'permanent' | 'ambiguous'

export class AdapterError extends Error {
  classification: ErrorClassification
  providerStatus?: number
  providerCode?: string

  constructor(
    message: string,
    classification: ErrorClassification,
    options: { providerStatus?: number; providerCode?: string } = {}
  ) {
    super(message)
    this.name = 'AdapterError'
    this.classification = classification
    this.providerStatus = options.providerStatus
    this.providerCode = options.providerCode
  }
}

/** Map an HTTP status to a default classification. */
export function classifyHttpStatus(status: number): ErrorClassification {
  if (status === 429 || status >= 500) return 'retryable'
  if (status === 408) return 'ambiguous'
  return 'permanent'
}

export function adapterErrorFromResponse(
  status: number,
  message: string,
  providerCode?: string
): AdapterError {
  return new AdapterError(message, classifyHttpStatus(status), {
    providerStatus: status,
    providerCode,
  })
}

/** Wrap unknown errors; network-level failures after send are ambiguous. */
export function toAdapterError(error: unknown, phase: 'before_send' | 'after_send'): AdapterError {
  if (error instanceof AdapterError) return error
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  const looksLikeNetwork =
    normalized.includes('timeout') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network') ||
    normalized.includes('socket') ||
    normalized.includes('aborted') ||
    normalized.includes('econnreset')

  if (looksLikeNetwork) {
    // A timeout after the publish call was sent may still have created the
    // post; that must reconcile, not blindly retry.
    return new AdapterError(message, phase === 'after_send' ? 'ambiguous' : 'retryable')
  }
  return new AdapterError(message, 'permanent')
}

/** Decrypted connection credentials as loaded by the worker. */
export type AdapterConnection = {
  id: string
  propertyId: string
  platform: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: string | null
  pageId: string | null
  pageAccessToken: string | null
}

/** Channel payload for one publish. */
export type AdapterVariant = {
  caption: string
  hashtags: string[]
  callToAction: string | null
  linkUrl: string | null
  mediaUrls: string[]
  altText: string | null
  contentFormat: string
  platformOptions: Record<string, unknown>
}

export type PublishOutcome = {
  providerPostId: string
  providerPostUrl: string | null
}

export type TokenRefreshOutcome = {
  accessToken: string
  refreshToken?: string | null
  tokenExpiresAt?: string | null
}

export interface SocialAdapter {
  platform: SocialPlatform

  /**
   * Cheap checks before attempting a publish: required credentials, media
   * requirements, caption limits. Throws AdapterError('permanent') on
   * unmet requirements.
   */
  preflight(connection: AdapterConnection, variant: AdapterVariant): Promise<void> | void

  /** Publish the variant. Must throw AdapterError on failure. */
  publish(
    connection: AdapterConnection,
    variant: AdapterVariant,
    context: { idempotencyKey: string }
  ): Promise<PublishOutcome>

  /** Refresh an expiring token, when the provider supports it. */
  refreshToken?(
    connection: AdapterConnection,
    appCredentials: { appId: string; appSecret: string }
  ): Promise<TokenRefreshOutcome | null>

  /**
   * After an ambiguous failure (e.g. timeout after send), look for a recent
   * post that matches this variant so retries never double-post.
   * Returns the existing post if found, null when it is safe to retry.
   */
  reconcile?(
    connection: AdapterConnection,
    variant: AdapterVariant
  ): Promise<PublishOutcome | null>
}

export function composeCaption(variant: AdapterVariant): string {
  const hashtags = variant.hashtags.length
    ? `\n\n${variant.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}`
    : ''
  return `${variant.caption}${hashtags}`
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
