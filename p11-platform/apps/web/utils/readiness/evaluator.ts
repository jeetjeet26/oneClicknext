import {hashBrandForgeContract,normalizeBrandAssetRow} from '@/utils/brandforge/normalize'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { getAssetUsability } from '@/utils/siteforge/assets/curation'
import { isSyntheticInventorySource } from '@/utils/siteforge/providers/inventory-policy'
import { normalizePublicWebsiteUrl } from '@/utils/services/public-url'
import type { Tables } from '@/types/supabase'
import {
  readinessApprovalPolicyForDomain,
  type ReadinessApprovalPolicy,
} from '@/utils/onboarding/readiness-policy'

type DomainState = 'missing' | 'conflicted' | 'needs_review' | 'ready' | 'stale'
type DomainReport = {
  state: DomainState
  blocking: boolean
  approvalPolicy: ReadinessApprovalPolicy
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
  property: SafeProperty
  contacts: SafeContact[]
  brand: Record<string, unknown>
  assets: SafeAsset[]
  units: Tables<'property_units'>[]
  pointsOfInterest: Tables<'property_points_of_interest'>[]
  legal: Tables<'property_legal_configs'> | null
  integrations: SafeIntegration[]
  analyticsDestinations: Array<{
    id: string
    websiteId: string | null
    type: string
    identity: string
    consentMode: string
  }>
  chatbotContext: SafeChatbot | null
  requestedCapabilities: string[]
  enabledCapabilities: string[]
  additionalUrls: string[]
  readinessEvidence:{sourceHash:string;policyVersion:'readiness.review.v1'}
}

export function evaluateCapabilityReadiness(input: {
  enabledCapabilities: string[]
  integrations: Array<{
    id: string
    platform: string
    status: string | null
    verified_at: string | null
    crm_approved_review_id?:string|null
    crm_validation_receipt_id?:string|null
    mapping_validated?:boolean|null
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
      .filter(integration => ['connected','verified'].includes(integration.status||'') && (['hubspot','salesforce','entrata','yardi','realpage','lasso'].includes(integration.platform) ? Boolean(integration.mapping_validated&&integration.crm_approved_review_id&&integration.crm_validation_receipt_id) : Boolean(integration.verified_at)))
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
  approvalPolicy: ReadinessApprovalPolicy,
  reasons: string[],
  sourceIds: string[],
  stateWhenNotReady: DomainState = 'missing',
): DomainReport {
  return {
    state: ready ? 'ready' : stateWhenNotReady,
    blocking: !ready && approvalPolicy !== 'advisory',
    approvalPolicy,
    reasons: ready ? [] : reasons,
    sourceIds,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function includeAdditionalUrlsInOnboardingPayload<
  T extends Record<string, unknown>,
>(payload: T, additionalUrls: string[]): T & { additionalUrls: string[] } {
  return {
    ...payload,
    additionalUrls: normalizeOnboardingAdditionalUrls(additionalUrls),
  }
}

export function normalizeOnboardingAdditionalUrls(additionalUrls: string[]): string[] {
  const normalized = additionalUrls.flatMap(value => {
    const publicUrl = normalizePublicWebsiteUrl(value)
    if (!publicUrl) return []
    const url = new URL(publicUrl)
    url.searchParams.sort()
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    return [url.toString()]
  })
  return [...new Set(normalized)].sort()
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
      ? ['An approved primary logo is required']
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

type SafeProperty=Pick<Tables<'properties'>,'id'|'org_id'|'name'|'address'|'amenities'|'brand_voice'|'current_vertical_profile_version_id'|'office_hours'|'parking_info'|'pet_policy'|'property_type'|'social_media'|'special_features'|'subject_kind'|'target_audience'|'unit_count'|'website_url'|'year_built'|'settings'>
type SafeContact=Pick<Tables<'property_contacts'>,'id'|'property_id'|'contact_type'|'email'|'is_primary'|'name'|'phone'|'role'>
type SafeAsset=Pick<Tables<'content_assets'>,'id'|'org_id'|'property_id'|'name'|'asset_role'|'asset_type'|'file_url'|'thumbnail_url'|'description'|'width'|'height'|'duration_seconds'|'file_size_bytes'|'format'|'alt_text'|'dimensions'|'crop_suggestion'|'focal_point'|'approval_status'|'approved_at'|'approved_by'|'archived_at'|'duplicate_of'|'replacement_asset_id'|'content_hash'|'curation_status'|'rights_status'|'expires_at'|'storage_bucket'|'storage_path'|'governance_revision'>
type SafeIntegration=Pick<Tables<'integration_credentials'>,'id'|'property_id'|'platform'|'status'|'verified_at'|'verification_method'|'crm_revision'|'crm_approved_review_id'|'crm_validation_receipt_id'|'mapping_validated'|'mapping_validated_at'>
type SafeChatbot=Pick<Tables<'property_chatbot_contexts'>,'id'|'property_id'|'version'|'status'|'requires_review'|'stale_at'|'last_generated_at'>&{contentHash:string}
export type ReadinessSources={property:SafeProperty;contacts:SafeContact[];brand:Record<string,unknown>|null;assets:SafeAsset[];units:Tables<'property_units'>[];pointsOfInterest:Tables<'property_points_of_interest'>[];neighborhoodTotal:number;legal:Tables<'property_legal_configs'>|null;integrations:SafeIntegration[];analyticsDestinations:Array<Pick<Tables<'siteforge_analytics_destinations'>,'id'|'property_id'|'website_id'|'destination_type'|'destination_identity'|'consent_mode'|'enabled'>>;chatbotContext:SafeChatbot|null;chatbotEligibility:{state:string;reason?:string};eligibleUnitIds:string[];unexpiredAssetIds:string[]}
export function evaluateReadinessSources(sources:ReadinessSources,enabledCapabilities:string[],sourceHash:string,now=new Date()){
  const property = sources.property
  const contacts = sources.contacts
  const brand = sources.brand
  const assets = sources.assets
  const units = sources.units
  const pointsOfInterest = sources.pointsOfInterest
  const legal = sources.legal
  const integrations = sources.integrations
  const analyticsDestinations = sources.analyticsDestinations
  const chatbotContext = sources.chatbotContext
  const propertySettings = asRecord(property.settings)
  const additionalUrls = Array.isArray(propertySettings.additionalUrls)
    ? propertySettings.additionalUrls.filter(value => typeof value === 'string')
    : []

  const assetReadiness = evaluateRequiredAssetReadiness(assets,now)
  const approvedAssets = assetReadiness.approvedRightsCleared
  const approvedPois = pointsOfInterest.filter(poi => poi.approval_status === 'approved')
  const approvedUnits = units.filter(
    unit =>
      unit.active &&
      unit.review_status === 'approved' &&
      (!unit.effective_at||Date.parse(unit.effective_at)<=now.getTime())&&(!unit.expires_at||Date.parse(unit.expires_at)>now.getTime())&&
      !isSyntheticInventorySource(unit),
  )
  const integrationFailures = evaluateCapabilityReadiness({
    enabledCapabilities,
    integrations,
    analyticsDestinations,
    hasChatbotContext: Boolean(sources.chatbotEligibility.state==='ready'&&chatbotContext?.status==='current'&&!chatbotContext.requires_review),
  })
  const availableCapabilities = enabledCapabilities.filter(
    capability =>
      evaluateCapabilityReadiness({
        enabledCapabilities: [capability],
        integrations,
        analyticsDestinations,
        hasChatbotContext: Boolean(sources.chatbotEligibility.state==='ready'&&chatbotContext?.status==='current'&&!chatbotContext.requires_review),
      }).length === 0,
  )

  const primaryContact = contacts.find(contact => contact.is_primary)
  const contactReady = Boolean(primaryContact?.phone && primaryContact.email)
  const propertyAddress = asRecord(property.address)
  const addressReady = Boolean(
    propertyAddress.street || propertyAddress.address1 || propertyAddress.line1,
  ) && Boolean(propertyAddress.city && propertyAddress.state)
  const brandReady = Boolean(
    brand
    && brand.approval_status === 'approved'
    && brand.contract_hash===hashBrandForgeContract(normalizeBrandAssetRow(brand)),
  )
  const domains: Record<string, DomainReport> = {
    identityContact: report(
      contactReady && Boolean(property.name && addressReady),
      readinessApprovalPolicyForDomain('identityContact'),
      ['Property identity, address, primary leasing phone, and email are required'],
      [property.id, ...contacts.map(contact => contact.id)],
    ),
    brand: report(
      brandReady,
      readinessApprovalPolicyForDomain('brand'),
      ['An approved, hashed BrandForge contract is required'],
      brand&&typeof brand.id==='string' ? [brand.id] : [],
      brand && brand.approval_status === 'reviewing' ? 'needs_review' : 'missing',
    ),
    assets: report(
      assetReadiness.ready,
      'advisory',
      assetReadiness.reasons,
      approvedAssets.map(asset => asset.id),
      assets.length ? 'needs_review' : 'missing',
    ),
    propertyFacts: report(
      Array.isArray(property.amenities) && property.amenities.length > 0,
      readinessApprovalPolicyForDomain('propertyFacts'),
      ['Approved property amenities/facts are required'],
      [property.id],
    ),
    units: report(
      approvedUnits.length > 0,
      'advisory',
      [
        'No active approved floor-plan inventory is available; plans that include a Floor Plans page will remain blocked',
      ],
      approvedUnits.map(unit => unit.id),
      units.length ? 'needs_review' : 'missing',
    ),
    // Neighborhood data is optional: many properties have no curated points
    // of interest, and the generated site simply omits that section. The
    // domain is still reported so operators can see it is missing.
    neighborhood: report(
      approvedPois.length > 0,
      readinessApprovalPolicyForDomain('neighborhood'),
      ['No sourced and approved points of interest; the neighborhood section will be omitted'],
      approvedPois.map(poi => poi.id),
      sources.neighborhoodTotal ? 'needs_review' : 'missing',
    ),
    legal: report(
      Boolean(legal?.approved_at&&legal.status==='approved'&&legal.effective_at&&Date.parse(legal.effective_at)<=now.getTime()&&legal.jurisdiction?.trim()&&legal.legal_entity_name?.trim()&&['privacy_policy','terms','accessibility','fair_housing','pricing_disclaimer','analytics_consent','communications_consent'].every(key=>typeof asRecord((legal as unknown as Record<string,unknown>)[key]).text==='string'&&String(asRecord((legal as unknown as Record<string,unknown>)[key]).text).trim())),
      readinessApprovalPolicyForDomain('legal'),
      ['Approved legal, consent, jurisdiction, reviewer, and effective date are required'],
      legal ? [legal.id] : [],
      legal ? 'needs_review' : 'missing',
    ),
    integrations: report(
      integrationFailures.length === 0,
      enabledCapabilities.length > 0
        ? readinessApprovalPolicyForDomain('integrations')
        : 'advisory',
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
      approvalPolicy: value.approvalPolicy,
    }))
  const sourceReferences = Object.entries(domains).flatMap(([domain, value]) =>
    value.sourceIds.map(sourceId => ({ domain, sourceId })),
  )
  const payload: OnboardingSnapshotPayload =
    includeAdditionalUrlsInOnboardingPayload({
      readinessEvidence:{sourceHash,policyVersion:'readiness.review.v1' as const},
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
      requestedCapabilities: enabledCapabilities,
      enabledCapabilities: availableCapabilities,
    }, additionalUrls)
  const contentHash = hashSiteForgeContent(payload)
  const status = unresolvedConflicts.length ? 'needs_review' : 'ready'

  return{payload,contentHash,domains,unresolvedConflicts,sourceReferences,status}
}
