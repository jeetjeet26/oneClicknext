/**
 * Adapter registry + per-channel launch gates.
 *
 * A channel is only publishable when its launch gate is enabled. Instagram,
 * Facebook, and LinkedIn default to enabled (existing integrations); TikTok
 * and X stay dark until their app review / paid-tier gates pass and the env
 * flag is set.
 */

import type { SocialPlatform } from '@/utils/forgestudio/content-contract'
import { instagramAdapter, facebookAdapter } from './meta'
import { linkedinAdapter } from './linkedin'
import { tiktokAdapter } from './tiktok'
import { xAdapter } from './x'
import type { SocialAdapter } from './types'

export * from './types'
export { instagramAdapter, facebookAdapter, linkedinAdapter, tiktokAdapter, xAdapter }

const ADAPTERS: Record<SocialPlatform, SocialAdapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  linkedin: linkedinAdapter,
  tiktok: tiktokAdapter,
  x: xAdapter,
}

const DEFAULT_ENABLED: Record<SocialPlatform, boolean> = {
  instagram: true,
  facebook: true,
  linkedin: true,
  tiktok: false,
  x: false,
}

const ENV_FLAGS: Record<SocialPlatform, string> = {
  instagram: 'FORGESTUDIO_CHANNEL_INSTAGRAM_ENABLED',
  facebook: 'FORGESTUDIO_CHANNEL_FACEBOOK_ENABLED',
  linkedin: 'FORGESTUDIO_CHANNEL_LINKEDIN_ENABLED',
  tiktok: 'FORGESTUDIO_CHANNEL_TIKTOK_ENABLED',
  x: 'FORGESTUDIO_CHANNEL_X_ENABLED',
}

export function normalizePlatform(platform: string): SocialPlatform | null {
  const normalized = platform === 'twitter' ? 'x' : platform
  return normalized in ADAPTERS ? (normalized as SocialPlatform) : null
}

export function isChannelEnabled(platform: string): boolean {
  const normalized = normalizePlatform(platform)
  if (!normalized) return false
  const flag = process.env[ENV_FLAGS[normalized]]
  if (flag === 'true' || flag === '1') return true
  if (flag === 'false' || flag === '0') return false
  return DEFAULT_ENABLED[normalized]
}

export function getAdapter(platform: string): SocialAdapter | null {
  const normalized = normalizePlatform(platform)
  return normalized ? ADAPTERS[normalized] : null
}
