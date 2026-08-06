import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import type { Json, Tables } from '@/types/supabase'

type ServiceClient = ReturnType<typeof createServiceClient>
type DomainState = 'missing' | 'conflicted' | 'needs_review' | 'ready' | 'stale'
type DomainReport = {
  state: DomainState
  blocking: boolean
  reasons: string[]
  sourceIds: string[]
}

export type OnboardingSnapshotPayload = {
  property: Tables<'properties'>
  contacts: Tables<'property_contacts'>[]
  brand: Record<string, unknown>
  assets: Tables<'content_assets'>[]
  units: Tables<'property_units'>[]
  pointsOfInterest: Tables<'property_points_of_interest'>[]
  legal: Tables<'property_legal_configs'> | null
  integrations: Tables<'integration_credentials'>[]
  chatbotContext: Tables<'property_chatbot_contexts'> | null
  enabledCapabilities: string[]
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
  const chatbotContext = chatbotResult.data
  const propertySettings = asRecord(property.settings)
  const additionalUrls = Array.isArray(propertySettings.additionalUrls)
    ? propertySettings.additionalUrls.filter(value => typeof value === 'string')
    : []

  const approvedAssets = assets.filter(asset =>
    asset.approval_status === 'approved'
    && ['owned', 'licensed', 'generated'].includes(asset.rights_status)
    && (!asset.expires_at || new Date(asset.expires_at) > new Date()),
  )
  const primaryLogo = approvedAssets.find(asset => asset.asset_role === 'primary_logo')
  const approvedPois = pointsOfInterest.filter(poi => poi.approval_status === 'approved')
  const approvedUnits = units.filter(unit => unit.active && unit.review_status === 'approved')
  const enabledProviders = new Set(
    integrations
      .filter(integration => integration.status === 'active' && integration.verified_at)
      .map(integration => integration.platform),
  )
  const capabilityProvider: Record<string, string[]> = {
    crm: ['hubspot', 'salesforce', 'entrata', 'yardi', 'realpage', 'lasso'],
    tours: ['luma', 'lumaleasing', 'google_calendar'],
    analytics: ['google_analytics', 'google_tag_manager'],
  }
  const integrationFailures = enabledCapabilities.flatMap(capability => {
    if (capability === 'chatbot') return chatbotContext ? [] : ['chatbot context is missing']
    const providers = capabilityProvider[capability]
    if (!providers) return []
    return providers.some(provider => enabledProviders.has(provider))
      ? []
      : [`${capability} is enabled but no active provider is configured`]
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
      Boolean(primaryLogo),
      true,
      ['An approved, rights-cleared primary logo is required'],
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
      integrations.map(integration => integration.id),
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
    chatbotContext,
    enabledCapabilities,
  }
  const contentHash = hashSiteForgeContent(payload)
  const status = unresolvedConflicts.length ? 'needs_review' : 'ready'

  const { data: existing } = await client
    .from('property_onboarding_snapshots')
    .select('*')
    .eq('property_id', input.propertyId)
    .eq('content_hash', contentHash)
    .maybeSingle()
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
