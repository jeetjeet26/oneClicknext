import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  createPropertyVerticalProfileSchema,
  forSaleOfferingGraphSchema,
  forSalePublicationPolicySchema,
  hashPropertyVerticalProfileVersion,
  hashVerticalPackIdentity,
  jsonValueSchema,
  propertyVerticalProfileSchema,
  verticalContextIdentitySchema,
  type CreatePropertyVerticalProfile,
  type ForSaleOfferingGraph,
  type ForSalePublicationPolicy,
  type PropertyVerticalProfile,
  type VerticalContextIdentity,
} from './contracts'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { composeVerticalPacks } from '@/utils/siteforge/verticals/composition'
import {
  verticalCompositionRequestSchema,
  type VerticalCompositionRequest,
} from '@/utils/siteforge/verticals/contracts'
import { legacyPropertyTypeToPackSelection } from '@/utils/siteforge/verticals/legacy-adapter'
import type {
  AdaptiveEvidenceEntry,
  AdaptiveVerticalContext,
} from '@/utils/siteforge/guided/adaptive-discovery'
import {
  PROPERTY_TYPE_VALUES,
  type PropertyType,
} from '@/utils/property-types'
import { normalizeLegacyPropertyVerticalProfile } from './legacy-adapter'

type ExistingPropertiesTable = Database['public']['Tables']['properties']
type VerticalProfileRow = {
  id: string
  org_id: string
  property_id: string
  version: number
  subject_kind: string
  vertical_key: string
  mapping_status: string
  mapping_reason: string | null
  vertical_pack_key: string
  vertical_pack_version: number
  vertical_pack_content_hash: string
  profile: Json
  content_hash: string
  created_by: string | null
  created_at: string
}

type VerticalPlatformDatabase = {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Omit<Database['public']['Tables'], 'properties'> & {
      properties: {
        Row: ExistingPropertiesTable['Row'] & {
          subject_kind: string
          current_vertical_profile_version_id: string | null
        }
        Insert: ExistingPropertiesTable['Insert'] & {
          subject_kind?: string
          current_vertical_profile_version_id?: string | null
        }
        Update: ExistingPropertiesTable['Update'] & {
          subject_kind?: string
          current_vertical_profile_version_id?: string | null
        }
        Relationships: ExistingPropertiesTable['Relationships']
      }
      property_vertical_profile_versions: {
        Row: VerticalProfileRow
        Insert: Omit<VerticalProfileRow, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<VerticalProfileRow>
        Relationships: []
      }
      property_offerings: {
        Row: {
          id: string
          org_id: string
          property_id: string
          offering_key: string
          offering_kind: string
          status: string
          current_version_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      property_offering_versions: {
        Row: {
          id: string
          org_id: string
          property_id: string
          offering_id: string
          version: number
          offering: Json
          content_hash: string
          source_kind: string
          source_identity: string | null
          effective_at: string | null
          expires_at: string | null
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      property_availability_snapshots: {
        Row: {
          id: string
          org_id: string
          property_id: string
          offering_id: string
          offering_version_id: string
          observed_at: string
          effective_at: string
          expires_at: string | null
          availability: Json
          content_hash: string
          source_kind: string
          source_identity: string
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      property_policy_versions: {
        Row: {
          id: string
          org_id: string
          property_id: string
          policy_key: string
          policy_kind: string
          version: number
          status: string
          policy: Json
          content_hash: string
          effective_at: string | null
          expires_at: string | null
          approved_by: string | null
          approved_at: string | null
          created_by: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>

function verticalClient(
  client: ServiceClient
): SupabaseClient<VerticalPlatformDatabase> {
  // Narrow generated-type bridge: remove after the two pending migrations are
  // applied and types/supabase.ts is regenerated.
  return client as unknown as SupabaseClient<VerticalPlatformDatabase>
}

export class PropertyVerticalProfileError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'PropertyVerticalProfileError'
  }
}

export type PersistedPropertyVerticalProfile = {
  id: string
  orgId: string
  propertyId: string
  version: number
  mappingStatus: 'confirmed' | 'needs_review'
  mappingReason: string | null
  verticalPack: {
    key: string
    version: number
    contentHash: string
  }
  profile: PropertyVerticalProfile
  contentHash: string
  createdAt: string
}

function mapVerticalProfile(
  row: VerticalProfileRow
): PersistedPropertyVerticalProfile {
  const mappingStatus =
    row.mapping_status === 'confirmed' ? 'confirmed' : 'needs_review'
  const parsedProfile = propertyVerticalProfileSchema.safeParse(row.profile)
  const profile = parsedProfile.success
    ? parsedProfile.data
    : normalizeLegacyPropertyVerticalProfile(row.profile)
  if (!profile) throw parsedProfile.error
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    version: row.version,
    mappingStatus,
    mappingReason: row.mapping_reason,
    verticalPack: {
      key: row.vertical_pack_key,
      version: row.vertical_pack_version,
      contentHash: row.vertical_pack_content_hash,
    },
    profile,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  }
}

async function loadPropertyIdentity(
  input: { orgId: string; propertyId: string },
  client: SupabaseClient<VerticalPlatformDatabase>
) {
  const { data, error } = await client
    .from('properties')
    .select('id, org_id, subject_kind, current_vertical_profile_version_id')
    .eq('id', input.propertyId)
    .eq('org_id', input.orgId)
    .single()
  if (error || !data?.org_id) {
    throw new PropertyVerticalProfileError('Property not found', 404)
  }
  return data
}

export async function getCurrentPropertyVerticalProfile(
  input: { orgId: string; propertyId: string },
  service: ServiceClient = createServiceClient()
): Promise<PersistedPropertyVerticalProfile> {
  const client = verticalClient(service)
  const property = await loadPropertyIdentity(input, client)
  if (!property.current_vertical_profile_version_id) {
    throw new PropertyVerticalProfileError(
      'Property does not have a current vertical profile',
      409
    )
  }
  const { data, error } = await client
    .from('property_vertical_profile_versions')
    .select('*')
    .eq('id', property.current_vertical_profile_version_id)
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .single()
  if (error || !data) {
    throw new PropertyVerticalProfileError(
      'Current vertical profile identity is unavailable',
      409
    )
  }
  return mapVerticalProfile(data)
}

export async function createPropertyVerticalProfileVersion(
  input: {
    orgId: string
    propertyId: string
    userId: string
    value: CreatePropertyVerticalProfile
  },
  service: ServiceClient = createServiceClient()
): Promise<{ profile: PersistedPropertyVerticalProfile; reused: boolean }> {
  const value = createPropertyVerticalProfileSchema.parse(input.value)
  const client = verticalClient(service)
  const property = await loadPropertyIdentity(input, client)
  if (property.subject_kind !== value.profile.subjectKind) {
    throw new PropertyVerticalProfileError(
      'Profile subject kind must match the property subject kind',
      409
    )
  }

  const contentHash = hashPropertyVerticalProfileVersion(value)
  const verticalPackContentHash = hashVerticalPackIdentity(value.verticalPack)
  const { data: duplicate, error: duplicateError } = await client
    .from('property_vertical_profile_versions')
    .select('*')
    .eq('property_id', input.propertyId)
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (duplicateError) {
    throw new PropertyVerticalProfileError(
      'Failed to inspect vertical profile history',
      500
    )
  }
  if (duplicate) {
    return { profile: mapVerticalProfile(duplicate), reused: true }
  }

  const { data: latest, error: latestError } = await client
    .from('property_vertical_profile_versions')
    .select('version')
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new PropertyVerticalProfileError(
      'Failed to inspect vertical profile version',
      500
    )
  }
  const currentVersion = latest?.version ?? 0
  if (
    value.expectedVersion !== null &&
    value.expectedVersion !== undefined &&
    value.expectedVersion !== currentVersion
  ) {
    throw new PropertyVerticalProfileError(
      'Vertical profile version changed; reload before saving',
      409
    )
  }

  const { data: created, error: createError } = await client
    .from('property_vertical_profile_versions')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      version: currentVersion + 1,
      subject_kind: value.profile.subjectKind,
      vertical_key: value.profile.verticalKey,
      mapping_status: value.mappingStatus,
      mapping_reason: value.mappingReason?.trim() || null,
      vertical_pack_key: value.verticalPack.key,
      vertical_pack_version: value.verticalPack.version,
      vertical_pack_content_hash: verticalPackContentHash,
      profile: jsonValueSchema.parse(value.profile),
      content_hash: contentHash,
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (createError || !created) {
    const status = createError?.code === '23505' ? 409 : 500
    throw new PropertyVerticalProfileError(
      status === 409
        ? 'Vertical profile version changed; reload before saving'
        : 'Failed to create vertical profile version',
      status
    )
  }

  let pointerUpdate = client
    .from('properties')
    .update({ current_vertical_profile_version_id: created.id })
    .eq('id', input.propertyId)
    .eq('org_id', input.orgId)
  pointerUpdate = property.current_vertical_profile_version_id
    ? pointerUpdate.eq(
        'current_vertical_profile_version_id',
        property.current_vertical_profile_version_id
      )
    : pointerUpdate.is('current_vertical_profile_version_id', null)
  const { data: updated, error: updateError } = await pointerUpdate
    .select('id')
    .single()
  if (updateError || !updated) {
    throw new PropertyVerticalProfileError(
      'Vertical profile was created but the current pointer changed concurrently',
      409
    )
  }

  return { profile: mapVerticalProfile(created), reused: false }
}

export async function loadCurrentVerticalContextIdentity(
  input: { orgId: string; propertyId: string },
  service: ServiceClient = createServiceClient(),
  now = new Date()
): Promise<VerticalContextIdentity> {
  const client = verticalClient(service)
  const current = await getCurrentPropertyVerticalProfile(input, service)
  const nowIso = now.toISOString()

  const { data: offering, error: offeringError } = await client
    .from('property_offerings')
    .select('id, current_version_id')
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .eq('status', 'active')
    .order('offering_key', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (offeringError) {
    throw new PropertyVerticalProfileError(
      'Failed to load current property offering',
      500
    )
  }

  const offeringVersion = offering?.current_version_id
    ? await client
        .from('property_offering_versions')
        .select('id, content_hash')
        .eq('id', offering.current_version_id)
        .eq('org_id', input.orgId)
        .eq('property_id', input.propertyId)
        .single()
    : { data: null, error: null }
  if (offeringVersion.error) {
    throw new PropertyVerticalProfileError(
      'Current offering version identity is unavailable',
      409
    )
  }

  const availability = offeringVersion.data
    ? await client
        .from('property_availability_snapshots')
        .select('id, content_hash')
        .eq('org_id', input.orgId)
        .eq('property_id', input.propertyId)
        .eq('offering_version_id', offeringVersion.data.id)
        .lte('effective_at', nowIso)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('effective_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null }
  if (availability.error) {
    throw new PropertyVerticalProfileError(
      'Failed to load current availability identity',
      500
    )
  }

  const policy = await client
    .from('property_policy_versions')
    .select('id, content_hash')
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .eq('status', 'approved')
    .or(`effective_at.is.null,effective_at.lte.${nowIso}`)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('policy_key', { ascending: true })
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (policy.error) {
    throw new PropertyVerticalProfileError(
      'Failed to load current policy identity',
      500
    )
  }

  return verticalContextIdentitySchema.parse({
    profile: {
      id: current.id,
      contentHash: current.contentHash,
    },
    pack: current.verticalPack,
    offering: offeringVersion.data
      ? {
          versionId: offeringVersion.data.id,
          contentHash: offeringVersion.data.content_hash,
        }
      : null,
    availability: availability.data
      ? {
          snapshotId: availability.data.id,
          contentHash: availability.data.content_hash,
        }
      : null,
    policy: policy.data
      ? {
          versionId: policy.data.id,
          contentHash: policy.data.content_hash,
        }
      : null,
  })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function compositionFromProfile(
  current: PersistedPropertyVerticalProfile
): VerticalCompositionRequest {
  const attributes = record(current.profile.attributes)
  const explicit = verticalCompositionRequestSchema.safeParse(
    attributes.siteforgeComposition || attributes.siteforge_composition
  )
  if (explicit.success) return explicit.data

  const legacyPropertyType =
    typeof current.profile.legacyPropertyType === 'string' &&
    PROPERTY_TYPE_VALUES.includes(
      current.profile.legacyPropertyType as PropertyType
    )
      ? (current.profile.legacyPropertyType as PropertyType)
      : null
  const legacy = legacyPropertyTypeToPackSelection(
    legacyPropertyType,
    current.profile.subjectKind
  )
  if (legacy.status === 'resolved') return legacy.request

  throw new PropertyVerticalProfileError(
    current.mappingReason ||
      'The current vertical profile needs review before SiteForge discovery can begin',
    409
  )
}

function evidenceEntry(
  value: Omit<AdaptiveEvidenceEntry, 'url' | 'observedAt' | 'freshUntil'> &
    Partial<
      Pick<AdaptiveEvidenceEntry, 'url' | 'observedAt' | 'freshUntil'>
    >
): AdaptiveEvidenceEntry {
  return {
    ...value,
    url: value.url || null,
    observedAt: value.observedAt || null,
    freshUntil: value.freshUntil || null,
  }
}

/**
 * Loads the current, tenant-bound inputs used by adaptive guided discovery.
 * Source text remains inert evidence data; it is never interpreted as an
 * instruction or appended to an executable model prompt.
 */
export async function loadAdaptiveVerticalContext(
  input: { orgId: string; propertyId: string },
  service: ServiceClient = createServiceClient()
): Promise<AdaptiveVerticalContext> {
  const current = await getCurrentPropertyVerticalProfile(input, service)
  const manifest = composeVerticalPacks(compositionFromProfile(current))
  const nowIso = new Date().toISOString()

  const [
    propertyResult,
    relationshipsResult,
    brandResult,
    knowledgeResult,
    offeringsResult,
    policiesResult,
    integrationsResult,
    assetsResult,
    lifecycleResult,
  ] = await Promise.all([
    service
      .from('properties')
      .select(
        'id, name, address, amenities, pet_policy, parking_info, special_features, office_hours, website_url'
      )
      .eq('id', input.propertyId)
      .eq('org_id', input.orgId)
      .single(),
    service
      .from('property_subject_relationships')
      .select(
        'id, subject_property_id, related_property_id, relationship_kind, relationship_metadata, created_at'
      )
      .eq('org_id', input.orgId)
      .or(
        `subject_property_id.eq.${input.propertyId},related_property_id.eq.${input.propertyId}`
      )
      .eq('status', 'active')
      .order('relationship_kind', { ascending: true }),
    service
      .from('property_brand_assets')
      .select(
        'id, contract_hash, approval_status, source_manifest, section_2_positioning, section_3_target_audience, updated_at'
      )
      .eq('property_id', input.propertyId)
      .eq('approval_status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from('knowledge_sources')
      .select(
        'id, source_name, source_type, source_url, status, extracted_data, last_synced_at'
      )
      .eq('property_id', input.propertyId)
      .eq('status', 'completed')
      .order('source_name', { ascending: true }),
    service
      .from('property_offerings')
      .select(
        'id, offering_key, offering_kind, current_version_id, updated_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('status', 'active')
      .order('offering_key', { ascending: true }),
    service
      .from('property_policy_versions')
      .select(
        'id, policy_key, policy_kind, version, policy, content_hash, effective_at, expires_at, approved_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('status', 'approved')
      .or(`effective_at.is.null,effective_at.lte.${nowIso}`)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('policy_key', { ascending: true })
      .order('version', { ascending: false }),
    service
      .from('integration_credentials')
      .select(
        'id, platform, status, mapping_validated, verified_at, last_sync_at'
      )
      .eq('property_id', input.propertyId)
      .order('platform', { ascending: true }),
    service
      .from('content_assets')
      .select(
        'id, name, asset_type, asset_role, content_hash, rights_status, approval_status, curation_status, source_identity, tags, updated_at'
      )
      .eq('property_id', input.propertyId)
      .eq('approval_status', 'approved')
      .in('rights_status', ['owned', 'licensed', 'generated'])
      .order('name', { ascending: true }),
    service
      .from('property_onboarding_snapshots')
      .select(
        'id, status, content_hash, snapshot_payload, source_references, approved_at, updated_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const failed = [
    propertyResult.error,
    relationshipsResult.error,
    brandResult.error,
    knowledgeResult.error,
    offeringsResult.error,
    policiesResult.error,
    integrationsResult.error,
    assetsResult.error,
    lifecycleResult.error,
  ].find(Boolean)
  if (failed || !propertyResult.data) {
    throw new PropertyVerticalProfileError(
      'Failed to assemble current vertical discovery evidence',
      500
    )
  }

  const offeringIds = (offeringsResult.data || [])
    .map(offering => offering.current_version_id)
    .filter((id): id is string => Boolean(id))
  const [offeringVersionsResult, availabilityResult] = await Promise.all([
    offeringIds.length
      ? service
          .from('property_offering_versions')
          .select(
            'id, offering_id, version, offering, content_hash, source_kind, source_identity, effective_at, expires_at, created_at'
          )
          .in('id', offeringIds)
          .order('id', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    offeringIds.length
      ? service
          .from('property_availability_snapshots')
          .select(
            'id, offering_version_id, availability, content_hash, source_kind, source_identity, observed_at, effective_at, expires_at'
          )
          .eq('org_id', input.orgId)
          .eq('property_id', input.propertyId)
          .in('offering_version_id', offeringIds)
          .lte('effective_at', nowIso)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order('effective_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (offeringVersionsResult.error || availabilityResult.error) {
    throw new PropertyVerticalProfileError(
      'Failed to load current offering and availability evidence',
      500
    )
  }

  const entries: AdaptiveEvidenceEntry[] = [
    evidenceEntry({
      id: `vertical-profile:${current.id}`,
      kind: 'subject_identity',
      label: `Current ${current.profile.displayName} vertical profile`,
      sourceType: 'vertical_profile',
      sourceId: current.id,
      observedAt: current.createdAt,
      content: {
        profile: current.profile,
        mappingStatus: current.mappingStatus,
        mappingReason: current.mappingReason,
      },
    }),
    evidenceEntry({
      id: `property:${propertyResult.data.id}`,
      kind: 'location',
      label: propertyResult.data.name,
      sourceType: 'property',
      sourceId: propertyResult.data.id,
      url: propertyResult.data.website_url,
      content: {
        address: propertyResult.data.address,
        amenities: propertyResult.data.amenities,
        petPolicy: propertyResult.data.pet_policy,
        parking: propertyResult.data.parking_info,
        specialFeatures: propertyResult.data.special_features,
        officeHours: propertyResult.data.office_hours,
      },
    }),
    ...(relationshipsResult.data || []).map(relationship =>
      evidenceEntry({
        id: `subject-relationship:${relationship.id}`,
        kind: 'portfolio_membership',
        label: `${relationship.relationship_kind} subject relationship`,
        sourceType: 'subject_relationship',
        sourceId: relationship.id,
        observedAt: relationship.created_at,
        content: relationship,
      })
    ),
    ...(brandResult.data
      ? [
          evidenceEntry({
            id: `brand:${brandResult.data.id}`,
            kind: 'brand',
            label: 'Approved BrandForge contract',
            sourceType: 'brandforge',
            sourceId: brandResult.data.id,
            observedAt: brandResult.data.updated_at,
            content: {
              contractHash: brandResult.data.contract_hash,
              sourceManifest: brandResult.data.source_manifest,
              positioning: brandResult.data.section_2_positioning,
              audiences: brandResult.data.section_3_target_audience,
            },
          }),
        ]
      : []),
    ...(knowledgeResult.data || []).map(source =>
      evidenceEntry({
        id: `knowledge-source:${source.id}`,
        kind: 'services',
        label: source.source_name,
        sourceType: `knowledge_source:${source.source_type}`,
        sourceId: source.id,
        url: source.source_url,
        observedAt: source.last_synced_at,
        content: {
          trustBoundary: 'untrusted_source_data',
          extractedData: source.extracted_data,
        },
      })
    ),
    ...(offeringVersionsResult.data || []).map(version =>
      evidenceEntry({
        id: `offering-version:${version.id}`,
        kind: 'offering_catalog',
        label: `Current offering version ${version.version}`,
        sourceType: `offering:${version.source_kind}`,
        sourceId: version.id,
        observedAt: version.created_at,
        freshUntil: version.expires_at,
        content: version.offering,
      })
    ),
    ...(availabilityResult.data || []).flatMap(snapshot => [
      evidenceEntry({
        id: `availability:${snapshot.id}`,
        kind: 'availability',
        label: 'Current availability snapshot',
        sourceType: `availability:${snapshot.source_kind}`,
        sourceId: snapshot.id,
        observedAt: snapshot.observed_at,
        freshUntil: snapshot.expires_at,
        content: snapshot.availability,
      }),
      evidenceEntry({
        id: `pricing:${snapshot.id}`,
        kind: 'pricing',
        label: 'Current sourced pricing and availability',
        sourceType: `availability:${snapshot.source_kind}`,
        sourceId: snapshot.id,
        observedAt: snapshot.observed_at,
        freshUntil: snapshot.expires_at,
        content: snapshot.availability,
      }),
    ]),
    ...(policiesResult.data || []).flatMap(policy => {
      const kinds = new Set([
        'licensing',
        'eligibility',
        ...(policy.policy_kind.includes('construction')
          ? ['construction_status']
          : []),
        ...(policy.policy_kind.includes('commercial')
          ? ['commercial_specifications']
          : []),
        ...(policy.policy_kind.includes('brand') ? ['brand_license'] : []),
      ])
      return [...kinds].map(kind =>
        evidenceEntry({
          id: `${kind}:${policy.id}`,
          kind,
          label: `Approved ${policy.policy_key} policy`,
          sourceType: 'approved_policy',
          sourceId: policy.id,
          observedAt: policy.approved_at,
          freshUntil: policy.expires_at,
          content: policy.policy,
        })
      )
    }),
    ...(integrationsResult.data || []).map(integration =>
      evidenceEntry({
        id: `integration:${integration.id}`,
        kind: 'services',
        label: `${integration.platform} integration`,
        sourceType: 'integration_status',
        sourceId: integration.id,
        observedAt: integration.last_sync_at || integration.verified_at,
        content: {
          platform: integration.platform,
          status: integration.status,
          mappingValidated: integration.mapping_validated,
        },
      })
    ),
    ...(assetsResult.data || []).map(asset =>
      evidenceEntry({
        id: `asset:${asset.id}`,
        kind: asset.asset_type === 'logo' ? 'brand' : 'amenities',
        label: asset.name,
        sourceType: 'approved_rights_cleared_asset',
        sourceId: asset.id,
        observedAt: asset.updated_at,
        content: {
          assetType: asset.asset_type,
          assetRole: asset.asset_role,
          contentHash: asset.content_hash,
          curationStatus: asset.curation_status,
          sourceIdentity: asset.source_identity,
          tags: asset.tags,
        },
      })
    ),
    ...(lifecycleResult.data
      ? [
          evidenceEntry({
            id: `lifecycle:${lifecycleResult.data.id}`,
            kind: 'construction_status',
            label: 'Approved property lifecycle evidence',
            sourceType: 'onboarding_snapshot',
            sourceId: lifecycleResult.data.id,
            observedAt:
              lifecycleResult.data.approved_at ||
              lifecycleResult.data.updated_at,
            content: {
              snapshot: lifecycleResult.data.snapshot_payload,
              sources: lifecycleResult.data.source_references,
            },
          }),
          evidenceEntry({
            id: `destination-programming:${lifecycleResult.data.id}`,
            kind: 'destination_programming',
            label: 'Approved destination and lifecycle evidence',
            sourceType: 'onboarding_snapshot',
            sourceId: lifecycleResult.data.id,
            observedAt:
              lifecycleResult.data.approved_at ||
              lifecycleResult.data.updated_at,
            content: lifecycleResult.data.snapshot_payload,
          }),
        ]
      : []),
  ].sort((left, right) => left.id.localeCompare(right.id))

  return {
    profile: {
      id: current.id,
      version: current.version,
      contentHash: current.contentHash,
      mappingStatus: current.mappingStatus,
      mappingReason: current.mappingReason,
      value: current.profile,
    },
    manifest,
    evidence: {
      contextHash: hashSiteForgeContent(
        entries.map(entry => ({
          id: entry.id,
          kind: entry.kind,
          sourceId: entry.sourceId,
          observedAt: entry.observedAt,
          freshUntil: entry.freshUntil,
          content: entry.content,
        }))
      ),
      entries,
    },
  }
}

export type ForSaleOfferingOmission = {
  offeringKey: string
  dimension: 'pricing' | 'availability' | 'release' | 'construction'
  reason: 'missing' | 'stale' | 'unknown'
}

function factIsFresh(
  observedAt: string,
  expiresAt: string | null,
  maxAgeHours: number,
  now: Date
): boolean {
  const observed = new Date(observedAt).getTime()
  const expires = expiresAt ? new Date(expiresAt).getTime() : Number.POSITIVE_INFINITY
  return (
    Number.isFinite(observed) &&
    observed + maxAgeHours * 3_600_000 > now.getTime() &&
    expires > now.getTime()
  )
}

/**
 * Produces a provider-neutral, publication-safe for-sale graph. Volatile facts
 * are omitted rather than guessed, while multifamily inventory remains on its
 * existing property_units path.
 */
export function publishForSaleOfferingGraph(
  rawGraph: ForSaleOfferingGraph,
  rawPolicy: ForSalePublicationPolicy,
  now = new Date()
): {
  graph: ForSaleOfferingGraph
  omissions: ForSaleOfferingOmission[]
  disclosureCodes: string[]
} {
  const graph = forSaleOfferingGraphSchema.parse(rawGraph)
  const policy = forSalePublicationPolicySchema.parse(rawPolicy)
  const omissions: ForSaleOfferingOmission[] = []

  const pricing = graph.pricing.filter(fact => {
    const fresh = factIsFresh(
      fact.observedAt,
      fact.expiresAt,
      policy.maxAgeHours.pricing,
      now
    )
    if (!fresh) {
      omissions.push({
        offeringKey: fact.offeringKey,
        dimension: 'pricing',
        reason: 'stale',
      })
    }
    return fresh
  })
  const availability = graph.availability.filter(fact => {
    const fresh = factIsFresh(
      fact.observedAt,
      fact.expiresAt,
      policy.maxAgeHours.availability,
      now
    )
    const known = fact.state !== 'unknown' || !policy.omitUnknownAvailability
    if (!fresh || !known) {
      omissions.push({
        offeringKey: fact.offeringKey,
        dimension: 'availability',
        reason: fresh ? 'unknown' : 'stale',
      })
    }
    return fresh && known
  })
  const lifecycleStates = graph.lifecycleStates.filter(fact => {
    const releaseFresh =
      fact.releaseState === null ||
      factIsFresh(
        fact.observedAt,
        fact.expiresAt,
        policy.maxAgeHours.release,
        now
      )
    const constructionFresh =
      fact.constructionState === null ||
      factIsFresh(
        fact.observedAt,
        fact.expiresAt,
        policy.maxAgeHours.construction,
        now
      )
    if (!releaseFresh) {
      omissions.push({
        offeringKey: fact.offeringKey,
        dimension: 'release',
        reason: 'stale',
      })
    }
    if (!constructionFresh) {
      omissions.push({
        offeringKey: fact.offeringKey,
        dimension: 'construction',
        reason: 'stale',
      })
    }
    return releaseFresh && constructionFresh
  })

  const disclosureMap = new Map(
    [...graph.disclosures, ...policy.requiredDisclosures].map(disclosure => [
      disclosure.code,
      disclosure,
    ])
  )
  if (policy.staleAction === 'disclose' && omissions.length) {
    disclosureMap.set('volatile_facts_omitted', {
      code: 'volatile_facts_omitted',
      text: 'Pricing, availability, release, or construction facts may be omitted when source data is stale or unknown.',
      offeringKeys: [...new Set(omissions.map(item => item.offeringKey))],
    })
  }

  return {
    graph: forSaleOfferingGraphSchema.parse({
      ...graph,
      pricing,
      availability,
      lifecycleStates,
      disclosures: [...disclosureMap.values()].sort((left, right) =>
        left.code.localeCompare(right.code)
      ),
    }),
    omissions,
    disclosureCodes: [...disclosureMap.keys()].sort(),
  }
}
