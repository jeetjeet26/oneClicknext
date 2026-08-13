import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { getAssetUsability } from '@/utils/siteforge/assets/curation'
import type { Json, Tables } from '@/types/supabase'

type ServiceClient = ReturnType<typeof createServiceClient>
type DomainState = 'missing' | 'conflicted' | 'needs_review' | 'ready' | 'stale'
type DomainReport = {
  state: DomainState
  blocking: boolean
  reasons: string[]
  sourceIds: string[]
}

const PROPERTY_PHOTO_ROLES = new Set([
  'hero',
  'amenity',
  'gallery',
  'interior',
  'exterior',
  'lifestyle',
])

export type OnboardingSnapshotPayload = {
  property: Tables<'properties'>
  contacts: Tables<'property_contacts'>[]
  brand: Record<string, unknown>
  assets: Tables<'content_assets'>[]
  units: Tables<'property_units'>[]
  pointsOfInterest: Tables<'property_points_of_interest'>[]
  legal: Tables<'property_legal_configs'> | null
  integrations: Tables<'integration_credentials'>[]
  analyticsDestinations: Array<{
    id: string
    websiteId: string | null
    type: string
    identity: string
    consentMode: string
  }>
  chatbotContext: Tables<'property_chatbot_contexts'> | null
  enabledCapabilities: string[]
}

export function evaluateCapabilityReadiness(input: {
  enabledCapabilities: string[]
  integrations: Array<{
    id: string
    platform: string
    status: string | null
    verified_at: string | null
  }>
  analyticsDestinations: Array<{
    destination_type: string
    destination_identity: string
    consent_mode: string
    enabled: boolean
  }>
  hasChatbotContext: boolean
}) {
  const enabledProviders = new Set(
    input.integrations
      .filter(integration => integration.status === 'active' && integration.verified_at)
      .map(integration => integration.platform),
  )
  const hasValidatedAnalyticsDestination = input.analyticsDestinations.some(
    destination =>
      destination.enabled
      && ['required', 'not_required'].includes(destination.consent_mode)
      && (
        (destination.destination_type === 'ga4'
          && /^G-[A-Z0-9]{6,20}$/.test(destination.destination_identity))
        || (destination.destination_type === 'gtm'
          && /^GTM-[A-Z0-9]{4,20}$/.test(destination.destination_identity))
      ),
  )
  const capabilityProvider: Record<string, string[]> = {
    crm: ['hubspot', 'salesforce', 'entrata', 'yardi', 'realpage', 'lasso'],
    tours: ['luma', 'lumaleasing', 'google_calendar'],
    analytics: ['google_analytics', 'google_tag_manager'],
  }

  return input.enabledCapabilities.flatMap(capability => {
    if (capability === 'chatbot') {
      return input.hasChatbotContext ? [] : ['chatbot context is missing']
    }
    if (capability === 'analytics' && hasValidatedAnalyticsDestination) return []
    const providers = capabilityProvider[capability]
    if (!providers) return []
    return providers.some(provider => enabledProviders.has(provider))
      ? []
      : [`${capability} is enabled but no active provider is configured`]
  })
}

function report(
  ready: boolean,
  blocking: boolean,
  reasons: string[],
  sourceIds: string[],
  stateWhenNotReady: DomainState = 'missing',
): DomainReport {
  return {
    state: ready ? 'ready' : stateWhenNotReady,
    blocking: !ready && blocking,
    reasons: ready ? [] : reasons,
    sourceIds,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function evaluateRequiredAssetReadiness<
  T extends {
    id: string
    asset_role: string | null
    asset_type: string
    approval_status: string
    curation_status: string
    rights_status: string
    expires_at: string | null
    duplicate_of?: string | null
  },
>(
  assets: T[],
  now = new Date(),
) {
  const approvedRightsCleared = assets.filter(
    asset => getAssetUsability(asset, now).usable,
  )
  const primaryLogo = approvedRightsCleared.find(
    asset => asset.asset_role === 'primary_logo',
  )
  const propertyPhotography = approvedRightsCleared.filter(
    asset =>
      asset.asset_type === 'image'
      && Boolean(asset.asset_role && PROPERTY_PHOTO_ROLES.has(asset.asset_role)),
  )
  const reasons = [
    ...(!primaryLogo
      ? ['An approved, curated, rights-cleared primary logo is required']
      : []),
  ]

  return {
    approvedRightsCleared,
    primaryLogo,
    propertyPhotography,
    ready: reasons.length === 0,
    reasons,
  }
}

export async function buildOnboardingSnapshot(
  input: {
    orgId: string
    propertyId: string
    userId: string
    enabledCapabilities?: string[]
  },
  client: ServiceClient = createServiceClient(),
) {
  const enabledCapabilities = [...new Set(input.enabledCapabilities || [])].sort()
  const [
    propertyResult,
    contactsResult,
    brandResult,
    assetsResult,
    unitsResult,
    poisResult,
    legalResult,
    integrationsResult,
    analyticsDestinationsResult,
    chatbotResult,
  ] = await Promise.all([
    client.from('properties').select('*').eq('id', input.propertyId).eq('org_id', input.orgId).single(),
    client.from('property_contacts').select('*').eq('property_id', input.propertyId),
    client.from('property_brand_assets').select('*').eq('property_id', input.propertyId).maybeSingle(),
    client.from('content_assets').select('*').eq('property_id', input.propertyId),
    client.from('property_units').select('*').eq('property_id', input.propertyId),
    client.from('property_points_of_interest').select('*').eq('property_id', input.propertyId),
    client.from('property_legal_configs').select('*').eq('property_id', input.propertyId).eq('status', 'approved').order('version', { ascending: false }).limit(1).maybeSingle(),
    client.from('integration_credentials').select('*').eq('property_id', input.propertyId),
    client
      .from('siteforge_analytics_destinations')
      .select('id, website_id, destination_type, destination_identity, consent_mode, enabled')
      .eq('property_id', input.propertyId)
      .eq('enabled', true),
    client.from('property_chatbot_contexts').select('*').eq('property_id', input.propertyId).maybeSingle(),
  ])

  const queryError = [
    propertyResult.error,
    contactsResult.error,
    brandResult.error,
    assetsResult.error,
    unitsResult.error,
    poisResult.error,
    legalResult.error,
    integrationsResult.error,
    analyticsDestinationsResult.error,
    chatbotResult.error,
  ].find(Boolean)
  if (queryError || !propertyResult.data) {
    throw new Error(`Failed to build onboarding readiness: ${queryError?.message || 'property not found'}`)
  }

  const property = propertyResult.data
  const contacts = contactsResult.data || []
  const brand = brandResult.data
  const assets = assetsResult.data || []
  const units = unitsResult.data || []
  const pointsOfInterest = poisResult.data || []
  const legal = legalResult.data
  const integrations = integrationsResult.data || []
  const analyticsDestinations = analyticsDestinationsResult.data || []
  const chatbotContext = chatbotResult.data
  const propertySettings = asRecord(property.settings)
  const additionalUrls = Array.isArray(propertySettings.additionalUrls)
    ? propertySettings.additionalUrls.filter(value => typeof value === 'string')
    : []

  const assetReadiness = evaluateRequiredAssetReadiness(assets)
  const approvedAssets = assetReadiness.approvedRightsCleared
  const approvedPois = pointsOfInterest.filter(poi => poi.approval_status === 'approved')
  const approvedUnits = units.filter(unit => unit.active && unit.review_status === 'approved')
  const integrationFailures = evaluateCapabilityReadiness({
    enabledCapabilities,
    integrations,
    analyticsDestinations,
    hasChatbotContext: Boolean(chatbotContext),
  })

  const primaryContact = contacts.find(contact => contact.is_primary)
  const contactReady = Boolean(primaryContact?.phone && primaryContact.email)
  const propertyAddress = asRecord(property.address)
  const addressReady = Boolean(
    propertyAddress.street || propertyAddress.address1 || propertyAddress.line1,
  ) && Boolean(propertyAddress.city && propertyAddress.state)
  const brandReady = Boolean(
    brand
    && (brand.approval_status === 'approved' || brand.generation_status === 'complete')
    && brand.contract_hash,
  )
  const domains: Record<string, DomainReport> = {
    identityContact: report(
      contactReady && Boolean(property.name && addressReady),
      true,
      ['Property identity, address, primary leasing phone, and email are required'],
      [property.id, ...contacts.map(contact => contact.id)],
    ),
    brand: report(
      brandReady,
      true,
      ['An approved, hashed BrandForge contract is required'],
      brand ? [brand.id] : [],
      brand && brand.approval_status === 'reviewing' ? 'needs_review' : 'missing',
    ),
    assets: report(
      assetReadiness.ready,
      true,
      assetReadiness.reasons,
      approvedAssets.map(asset => asset.id),
      assets.length ? 'needs_review' : 'missing',
    ),
    propertyFacts: report(
      Array.isArray(property.amenities) && property.amenities.length > 0,
      true,
      ['Approved property amenities/facts are required'],
      [property.id],
    ),
    units: report(
      approvedUnits.length > 0,
      true,
      ['At least one active, approved floor plan or unit source is required'],
      approvedUnits.map(unit => unit.id),
      units.length ? 'needs_review' : 'missing',
    ),
    // Neighborhood data is optional: many properties have no curated points
    // of interest, and the generated site simply omits that section. The
    // domain is still reported so operators can see it is missing.
    neighborhood: report(
      approvedPois.length > 0,
      false,
      ['No sourced and approved points of interest; the neighborhood section will be omitted'],
      approvedPois.map(poi => poi.id),
      pointsOfInterest.length ? 'needs_review' : 'missing',
    ),
    legal: report(
      Boolean(legal?.approved_at && legal.effective_at),
      true,
      ['Approved legal, consent, jurisdiction, reviewer, and effective date are required'],
      legal ? [legal.id] : [],
      legal ? 'needs_review' : 'missing',
    ),
    integrations: report(
      integrationFailures.length === 0,
      enabledCapabilities.length > 0,
      integrationFailures,
      [
        ...integrations.map(integration => integration.id),
        ...analyticsDestinations.map(destination => destination.id),
      ],
      'needs_review',
    ),
  }

  const unresolvedConflicts = Object.entries(domains)
    .filter(([, domain]) => domain.blocking)
    .map(([domain, value]) => ({
      domain,
      reasons: value.reasons,
      sourceIds: value.sourceIds,
    }))
  const sourceReferences = Object.entries(domains).flatMap(([domain, value]) =>
    value.sourceIds.map(sourceId => ({ domain, sourceId })),
  )
  const payload: OnboardingSnapshotPayload = {
    property,
    contacts,
    brand: brand ? asRecord(brand) : {},
    assets: approvedAssets,
    units: approvedUnits,
    pointsOfInterest: approvedPois,
    legal,
    integrations,
    analyticsDestinations: analyticsDestinations.map(destination => ({
      id: destination.id,
      websiteId: destination.website_id,
      type: destination.destination_type,
      identity: destination.destination_identity,
      consentMode: destination.consent_mode,
    })),
    chatbotContext,
    enabledCapabilities,
  }
  const contentHash = hashSiteForgeContent(payload)
  const status = unresolvedConflicts.length ? 'needs_review' : 'ready'

  const { data: existing, error: existingError } = await client
    .from('property_onboarding_snapshots')
    .select('*')
    .eq('property_id', input.propertyId)
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (existingError) {
    throw new Error(
      `Failed to inspect onboarding snapshot: ${existingError.message}`,
    )
  }
  if (existing) return existing

  const { data: snapshot, error } = await client
    .from('property_onboarding_snapshots')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      status,
      schema_version: 1,
      domain_reports: domains,
      source_references: sourceReferences,
      unresolved_conflicts: unresolvedConflicts,
      snapshot_payload: {
        ...payload,
        additionalUrls,
      } as unknown as Json,
      content_hash: contentHash,
      brand_asset_id: brand?.id || null,
      brand_contract_version: brand?.contract_version || null,
      brand_contract_hash: brand?.contract_hash || null,
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (error?.code === '23505') {
    const { data: racedSnapshot, error: racedSnapshotError } = await client
      .from('property_onboarding_snapshots')
      .select('*')
      .eq('property_id', input.propertyId)
      .eq('content_hash', contentHash)
      .single()
    if (racedSnapshotError || !racedSnapshot) {
      throw new Error(
        `Failed to load concurrently persisted onboarding snapshot: ${racedSnapshotError?.message || 'snapshot not found'}`,
      )
    }
    return racedSnapshot
  }
  if (error || !snapshot) {
    throw new Error(`Failed to persist onboarding snapshot: ${error?.message}`)
  }

  await client
    .from('property_onboarding_snapshots')
    .update({ status: 'stale' })
    .eq('property_id', input.propertyId)
    .eq('status', 'approved')
    .neq('id', snapshot.id)

  return snapshot
}

export async function approveOnboardingSnapshot(
  input: {
    orgId: string
    propertyId: string
    snapshotId: string
    userId: string
    rationale: string
  },
  client: ServiceClient = createServiceClient(),
) {
  const { data: snapshot, error } = await client
    .from('property_onboarding_snapshots')
    .select('*')
    .eq('id', input.snapshotId)
    .eq('property_id', input.propertyId)
    .eq('org_id', input.orgId)
    .single()
  if (error || !snapshot) throw new Error('Onboarding snapshot not found')
  if (snapshot.status !== 'ready') {
    throw new Error('Only a fully ready onboarding snapshot can be approved')
  }
  if (Array.isArray(snapshot.unresolved_conflicts) && snapshot.unresolved_conflicts.length) {
    throw new Error('Resolve onboarding conflicts before approval')
  }

  const { data: job, error: jobError } = await client
    .from('shared_jobs')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      domain: 'onboarding',
      subject_type: 'property_onboarding_snapshot',
      subject_id: snapshot.id,
      lifecycle_status: 'succeeded',
      dedupe_key: `approve:${snapshot.id}`,
      payload: { snapshotHash: snapshot.content_hash },
      attempt_count: 1,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (jobError || !job) throw new Error(`Failed to create onboarding approval job: ${jobError?.message}`)

  const { data: action, error: actionError } = await client
    .from('shared_action_attempts')
    .insert({
      job_id: job.id,
      org_id: input.orgId,
      property_id: input.propertyId,
      action_type: 'approve_onboarding_snapshot',
      lifecycle_status: 'succeeded',
      proposal_decision_status: 'approved',
      execution_status: 'executed',
      requested_by: input.userId,
      reviewed_by: input.userId,
      request_payload: { snapshotId: snapshot.id },
      execution_payload: { snapshotHash: snapshot.content_hash },
      execution_result: { approved: true },
      policy_reason: input.rationale,
      decided_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (actionError || !action) throw new Error(`Failed to create onboarding approval action: ${actionError?.message}`)

  const { error: approvalError } = await client.from('shared_approvals').insert({
    action_attempt_id: action.id,
    org_id: input.orgId,
    property_id: input.propertyId,
    decision_status: 'approved',
    decision_reason: input.rationale,
    reviewer_profile_id: input.userId,
    decision_payload: { snapshotId: snapshot.id, contentHash: snapshot.content_hash },
  })
  if (approvalError) throw new Error(`Failed to record onboarding approval: ${approvalError.message}`)

  const approvedAt = new Date().toISOString()
  const { data: approved, error: updateError } = await client
    .from('property_onboarding_snapshots')
    .update({
      status: 'approved',
      approval_action_attempt_id: action.id,
      approved_by: input.userId,
      approved_at: approvedAt,
    })
    .eq('id', snapshot.id)
    .eq('status', 'ready')
    .select('*')
    .single()
  if (updateError || !approved) throw new Error(`Failed to approve onboarding snapshot: ${updateError?.message}`)
  return approved
}

export async function getLatestApprovedOnboardingSnapshot(
  propertyId: string,
  client: ServiceClient = createServiceClient(),
) {
  const { data, error } = await client
    .from('property_onboarding_snapshots')
    .select('*')
    .eq('property_id', propertyId)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load onboarding snapshot: ${error.message}`)
  return data
}
