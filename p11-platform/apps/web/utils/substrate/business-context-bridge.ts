import { subDays, format } from 'date-fns'
import type { Database } from '@/types/supabase'
import { deriveSharedLifecycleStatus } from '@/utils/substrate/shared-vocabulary'
import { deriveImportJobState } from '@/utils/marketvision/import-job-state'

type ServiceClient = {
  from: ReturnType<import('@/utils/supabase/admin').createServiceClient>['from']
}

type IntegrationCredential = Database['public']['Tables']['integration_credentials']['Row']
type AdConnection = Database['public']['Tables']['ad_account_connections']['Row']
type PropertyRow = Database['public']['Tables']['properties']['Row']

export type BusinessContextBridgePayload = {
  propertyId: string
  asOf: string
  readOnly: true
  setup: {
    onboardingCompleted: boolean
    missingCoreFields: string[]
    profile: {
      name: string
      propertyType: string | null
      websiteUrl: string | null
      unitCount: number | null
      targetAudience: string | null
      brandVoice: string | null
    }
  }
  knowledge: {
    sourceCount: number
    completedSources: number
    failedSources: number
    documentCount: number
    latestSyncedAt: string | null
  }
  brand: {
    brandBookCount: number
    latestGeneratedAt: string | null
  }
  bi: {
    lastImportState: 'pending' | 'running' | 'complete' | 'partial' | 'failed' | 'unknown'
    hasImportWarnings: boolean
    lastImportAt: string | null
    marketing30d: {
      spend: number
      clicks: number
      conversions: number
      impressions: number
    }
  }
  integrations: {
    configuredCount: number
    verifiedCount: number
    errorCount: number
    crmReady: boolean
    emailReady: boolean
    calendarReady: boolean
    adPlatformsReady: Record<string, boolean>
  }
  substrate: {
    sharedJobCount: number
    latestJobAt: string | null
    lifecycleCounts: Record<string, number>
  }
  citations: Array<{
    domain: 'setup' | 'knowledge' | 'brand' | 'bi' | 'integrations' | 'substrate'
    tables: string[]
  }>
}

function getMissingCoreFields(property: PropertyRow): string[] {
  const missing: string[] = []
  if (!property.name || property.name.trim().length === 0) missing.push('name')
  if (!property.address || property.address.trim().length === 0) missing.push('address')
  if (!property.property_type) missing.push('property_type')
  if (!property.website_url) missing.push('website_url')
  if (!property.unit_count || property.unit_count <= 0) missing.push('unit_count')
  return missing
}

function summarizeIntegrations(
  integrations: IntegrationCredential[],
  emailConfig: { token_status: string | null; sync_enabled: boolean | null } | null,
  calendarConfig: { token_status: string | null; sync_enabled: boolean | null; calendar_id: string | null } | null,
  adConnections: AdConnection[]
) {
  const configuredCount = integrations.length
  const verifiedCount = integrations.filter(i => i.status === 'verified' || i.status === 'connected').length
  const errorCount = integrations.filter(i => i.status === 'error').length
  const crmIntegration = integrations.find(i => i.platform === 'crm')
  const crmReady = Boolean(
    crmIntegration && (crmIntegration.status === 'verified' || crmIntegration.status === 'connected')
  )
  const emailReady = Boolean(emailConfig?.sync_enabled && emailConfig.token_status === 'healthy')
  const calendarReady = Boolean(
    calendarConfig?.sync_enabled &&
      calendarConfig.token_status === 'healthy' &&
      typeof calendarConfig.calendar_id === 'string' &&
      calendarConfig.calendar_id.length > 0
  )

  const adPlatformsReady: Record<string, boolean> = {}
  for (const connection of adConnections) {
    adPlatformsReady[connection.platform] = Boolean(
      connection.is_active && (connection.error_count ?? 0) === 0 && !connection.last_error
    )
  }

  return {
    configuredCount,
    verifiedCount,
    errorCount,
    crmReady,
    emailReady,
    calendarReady,
    adPlatformsReady,
  }
}

export async function buildBusinessContextBridge(
  supabase: ServiceClient,
  propertyId: string
): Promise<BusinessContextBridgePayload> {
  const asOf = new Date().toISOString()
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const today = format(new Date(), 'yyyy-MM-dd')

  const [
    propertyResult,
    knowledgeSourcesResult,
    documentsCountResult,
    brandBooksResult,
    integrationsResult,
    emailConfigResult,
    calendarConfigResult,
    adConnectionsResult,
    latestImportResult,
    marketingResult,
    sharedJobsResult,
  ] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, property_type, website_url, unit_count, target_audience, brand_voice, address, onboarding_completed_at')
      .eq('id', propertyId)
      .single(),
    supabase
      .from('knowledge_sources')
      .select('status, last_synced_at')
      .eq('property_id', propertyId),
    supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId),
    supabase
      .from('brand_books')
      .select('created_at')
      .eq('property_id', propertyId),
    supabase
      .from('integration_credentials')
      .select('*')
      .eq('property_id', propertyId),
    supabase
      .from('email_configurations')
      .select('token_status, sync_enabled')
      .eq('property_id', propertyId)
      .maybeSingle(),
    supabase
      .from('agent_calendars')
      .select('token_status, sync_enabled, calendar_id')
      .eq('property_id', propertyId)
      .maybeSingle(),
    supabase
      .from('ad_account_connections')
      .select('*')
      .eq('property_id', propertyId),
    supabase
      .from('import_jobs')
      .select('status, error_message, created_at, completed_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('fact_marketing_performance')
      .select('spend, clicks, conversions, impressions')
      .eq('property_id', propertyId)
      .gte('date', thirtyDaysAgo)
      .lte('date', today),
    supabase
      .from('shared_jobs')
      .select('lifecycle_status, created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  if (propertyResult.error || !propertyResult.data) {
    throw new Error(propertyResult.error?.message || 'Property not found')
  }
  if (knowledgeSourcesResult.error) throw new Error(knowledgeSourcesResult.error.message)
  if (documentsCountResult.error) throw new Error(documentsCountResult.error.message)
  if (brandBooksResult.error) throw new Error(brandBooksResult.error.message)
  if (integrationsResult.error) throw new Error(integrationsResult.error.message)
  if (emailConfigResult.error) throw new Error(emailConfigResult.error.message)
  if (calendarConfigResult.error) throw new Error(calendarConfigResult.error.message)
  if (adConnectionsResult.error) throw new Error(adConnectionsResult.error.message)
  if (latestImportResult.error) throw new Error(latestImportResult.error.message)
  if (marketingResult.error) throw new Error(marketingResult.error.message)
  if (sharedJobsResult.error) throw new Error(sharedJobsResult.error.message)

  const property = propertyResult.data as PropertyRow
  const knowledgeSources = knowledgeSourcesResult.data || []
  const latestSyncedAt = knowledgeSources
    .map(source => source.last_synced_at)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1) || null
  const brandBookRows = brandBooksResult.data || []
  const latestGeneratedAt = brandBookRows
    .map(row => row.created_at)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1) || null
  const marketing30d = (marketingResult.data || []).reduce(
    (acc, row) => ({
      spend: acc.spend + Number(row.spend || 0),
      clicks: acc.clicks + Number(row.clicks || 0),
      conversions: acc.conversions + Number(row.conversions || 0),
      impressions: acc.impressions + Number(row.impressions || 0),
    }),
    { spend: 0, clicks: 0, conversions: 0, impressions: 0 }
  )

  const lastImportState = latestImportResult.data
    ? deriveImportJobState({
        status: latestImportResult.data.status,
        error_message: latestImportResult.data.error_message,
      })
    : 'unknown'
  const hasImportWarnings =
    lastImportState === 'partial' || Boolean(latestImportResult.data?.error_message)

  const substrateLifecycleCounts: Record<string, number> = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    cancelled: 0,
  }
  for (const job of sharedJobsResult.data || []) {
    const normalized = deriveSharedLifecycleStatus(job.lifecycle_status).status
    substrateLifecycleCounts[normalized] = (substrateLifecycleCounts[normalized] || 0) + 1
  }

  return {
    propertyId,
    asOf,
    readOnly: true,
    setup: {
      onboardingCompleted: Boolean(property.onboarding_completed_at),
      missingCoreFields: getMissingCoreFields(property),
      profile: {
        name: property.name,
        propertyType: property.property_type,
        websiteUrl: property.website_url,
        unitCount: property.unit_count,
        targetAudience: property.target_audience,
        brandVoice: property.brand_voice,
      },
    },
    knowledge: {
      sourceCount: knowledgeSources.length,
      completedSources: knowledgeSources.filter(source => source.status === 'completed').length,
      failedSources: knowledgeSources.filter(source => source.status === 'failed').length,
      documentCount: documentsCountResult.count || 0,
      latestSyncedAt,
    },
    brand: {
      brandBookCount: brandBookRows.length,
      latestGeneratedAt,
    },
    bi: {
      lastImportState,
      hasImportWarnings,
      lastImportAt: latestImportResult.data?.completed_at || latestImportResult.data?.created_at || null,
      marketing30d,
    },
    integrations: summarizeIntegrations(
      integrationsResult.data || [],
      emailConfigResult.data,
      calendarConfigResult.data,
      adConnectionsResult.data || []
    ),
    substrate: {
      sharedJobCount: (sharedJobsResult.data || []).length,
      latestJobAt: (sharedJobsResult.data || [])[0]?.created_at || null,
      lifecycleCounts: substrateLifecycleCounts,
    },
    citations: [
      { domain: 'setup', tables: ['properties'] },
      { domain: 'knowledge', tables: ['knowledge_sources', 'documents'] },
      { domain: 'brand', tables: ['brand_books'] },
      { domain: 'bi', tables: ['import_jobs', 'fact_marketing_performance'] },
      {
        domain: 'integrations',
        tables: ['integration_credentials', 'email_configurations', 'agent_calendars', 'ad_account_connections'],
      },
      { domain: 'substrate', tables: ['shared_jobs'] },
    ],
  }
}

