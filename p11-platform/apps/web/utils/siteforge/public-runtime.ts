import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

export interface SiteForgePublicRuntimeConfig {
  enabled: boolean
  apiKey: string
  apiBaseUrl: string
  websiteId: string
  conversionEndpoint: string
  conversionKey: string
  telemetryEndpoint: string
}

export async function loadSiteForgePublicRuntimeConfig(
  websiteId: string,
  propertyId: string,
  client: SupabaseClient<Database> = createServiceClient()
): Promise<SiteForgePublicRuntimeConfig> {
  const [{ data: website, error: websiteError }, { data: luma, error: lumaError }] =
    await Promise.all([
      client
        .from('property_websites')
        .select('id, property_id, siteforge_public_key')
        .eq('id', websiteId)
        .eq('property_id', propertyId)
        .single(),
      client
        .from('lumaleasing_config')
        .select('api_key, is_active')
        .eq('property_id', propertyId)
        .maybeSingle(),
    ])

  if (websiteError || !website?.siteforge_public_key) {
    throw new Error(
      `SiteForge public runtime identity is unavailable: ${
        websiteError?.message || websiteId
      }`
    )
  }
  if (lumaError) {
    throw new Error(`Failed to load LumaLeasing runtime configuration: ${lumaError.message}`)
  }

  const apiBaseUrl =
    process.env.SITEFORGE_PUBLIC_RUNTIME_BASE_URL?.trim() || getAppBaseUrl()
  return {
    enabled: Boolean(luma?.is_active && luma.api_key),
    apiKey: luma?.api_key || '',
    apiBaseUrl,
    websiteId,
    conversionEndpoint: `${apiBaseUrl}/api/siteforge/public/conversions/${websiteId}`,
    conversionKey: website.siteforge_public_key,
    telemetryEndpoint: `${apiBaseUrl}/api/siteforge/public/telemetry/${websiteId}`,
  }
}
