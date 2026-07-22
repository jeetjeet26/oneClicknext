/**
 * ForgeStudio social app credential resolution — single source of truth.
 *
 * Credentials live in `social_auth_configs` (app secret encrypted with
 * ENCRYPTION_KEY via utils/forgestudio/crypto). Environment variables remain
 * a deployment-level fallback. The legacy plaintext `social_app_credentials`
 * table has been dropped.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import { decryptSecret } from '@/utils/forgestudio/crypto'

export type SocialConfigPlatform = 'meta' | 'linkedin' | 'tiktok' | 'x'

export interface SocialCredentials {
  appId: string
  appSecret: string
  redirectUri: string | null
  source: 'database' | 'environment'
}

const ENV_FALLBACKS: Record<SocialConfigPlatform, { id: string[]; secret: string[] }> = {
  meta: {
    id: ['META_APP_ID', 'FACEBOOK_APP_ID'],
    secret: ['META_APP_SECRET', 'FACEBOOK_APP_SECRET'],
  },
  linkedin: {
    id: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_APP_ID'],
    secret: ['LINKEDIN_CLIENT_SECRET', 'LINKEDIN_APP_SECRET'],
  },
  tiktok: {
    id: ['TIKTOK_CLIENT_KEY'],
    secret: ['TIKTOK_CLIENT_SECRET'],
  },
  x: {
    id: ['X_CLIENT_ID', 'TWITTER_CLIENT_ID'],
    secret: ['X_CLIENT_SECRET', 'TWITTER_CLIENT_SECRET'],
  },
}

function readEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]
    if (value && value.trim().length > 0) return value
  }
  return null
}

/**
 * Resolve app credentials for a property + platform.
 * Database rows win over environment variables.
 */
export async function getSocialAppCredentials(
  propertyId: string,
  platform: SocialConfigPlatform
): Promise<SocialCredentials | null> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('social_auth_configs')
      .select('app_id, app_secret_encrypted, redirect_uri')
      .eq('property_id', propertyId)
      .eq('platform', platform)
      .maybeSingle()

    if (error) {
      console.error('[social-config] failed to load social_auth_configs row', {
        propertyId,
        platform,
        error,
      })
    } else if (data) {
      return {
        appId: data.app_id,
        appSecret: decryptSecret(data.app_secret_encrypted),
        redirectUri: data.redirect_uri,
        source: 'database',
      }
    }
  } catch (error) {
    console.error('[social-config] credential lookup failed', { propertyId, platform, error })
  }

  const fallback = ENV_FALLBACKS[platform]
  const appId = readEnv(fallback.id)
  const appSecret = readEnv(fallback.secret)
  if (appId && appSecret) {
    return { appId, appSecret, redirectUri: null, source: 'environment' }
  }

  return null
}

export async function getMetaCredentials(propertyId: string): Promise<SocialCredentials | null> {
  return getSocialAppCredentials(propertyId, 'meta')
}

export async function getLinkedInCredentials(
  propertyId: string
): Promise<SocialCredentials | null> {
  return getSocialAppCredentials(propertyId, 'linkedin')
}

export async function getTikTokCredentials(propertyId: string): Promise<SocialCredentials | null> {
  return getSocialAppCredentials(propertyId, 'tiktok')
}

export async function getXCredentials(propertyId: string): Promise<SocialCredentials | null> {
  return getSocialAppCredentials(propertyId, 'x')
}
