import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { syncLeadToCRM } from '@/utils/services/crm-sync'
import { startWorkflow } from '@/utils/services/workflow-processor'
import {
  bookLumaLeasingTour,
  type BookLumaLeasingTourResult,
} from '@/utils/services/lumaleasing-tour-booking'
import { formatPropertyAddress } from '@/utils/services/property-address'
import { trackEngagementEvent } from '@/utils/services/engagement-tracker'
import {
  attributionFromUrl,
  attributionMetadata,
  persistAttributionTouches,
  siteForgeAttributionSchema,
} from '@/utils/siteforge/operations/attribution'
import { enqueueSiteForgeOutbox } from '@/utils/siteforge/operations/outbox'
import {
  LeadUpsertError,
  upsertLeadByContact,
} from '@/utils/services/lead-upsert'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { jsonValueSchema } from '@/utils/real-estate/contracts'
import {
  FOR_SALE_CONVERSION_LANES,
  SITEFORGE_CONVERSION_INTENTS,
  forSaleConversionLaneSchema,
  validateConversionCustomFields,
  type ConversionIntentDefinition,
} from '@/utils/siteforge/providers/conversion-intents'
import { verticalConversionIntentSchema } from '@/utils/siteforge/verticals/contracts'

export const conversionAttributionSchema = siteForgeAttributionSchema

export const normalizedLeadSubmissionSchema = z
  .object({
    orgId: z.guid(),
    propertyId: z.guid(),
    submissionId: z.string().trim().min(1).max(200),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().min(7).max(30).optional(),
    moveInDate: z.string().date().optional(),
    bedrooms: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(4_000).optional(),
    consent: z.literal(true),
    consentText: z.string().trim().min(10).max(2_000),
    consentedAt: z.string().datetime(),
    attribution: conversionAttributionSchema,
  })
  .strict()
  .refine((value) => Boolean(value.email || value.phone), {
    message: 'Email or phone is required',
    path: ['email'],
  })

export const normalizedTourSubmissionSchema = z
  .object({
    orgId: z.guid(),
    propertyId: z.guid(),
    leadId: z.guid(),
    submissionId: z.string().trim().min(1).max(200),
    date: z.string().date(),
    time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
    tourType: z.enum(['in_person', 'virtual', 'self_guided']),
    notes: z.string().trim().max(2_000).optional(),
    attribution: conversionAttributionSchema,
  })
  .strict()

export type NormalizedLeadSubmission = z.infer<
  typeof normalizedLeadSubmissionSchema
>
export type NormalizedTourSubmission = z.infer<
  typeof normalizedTourSubmissionSchema
>

export interface ConversionProviderAdapter {
  readonly provider: 'p11' | 'lumaleasing'
  submitLead(input: NormalizedLeadSubmission): Promise<{
    leadId: string
    duplicate: boolean
    isExisting: boolean
  }>
  scheduleTour(input: NormalizedTourSubmission): Promise<{
    tourId: string
    duplicate: boolean
  }>
}

abstract class DatabaseConversionAdapter
  implements ConversionProviderAdapter
{
  abstract readonly provider: 'p11' | 'lumaleasing'

  constructor(
    protected readonly client: SupabaseClient<Database> = createServiceClient()
  ) {}

  async submitLead(raw: NormalizedLeadSubmission) {
    const input = normalizedLeadSubmissionSchema.parse(raw)
    const { data: existing, error: existingError } = await this.client
      .from('leads')
      .select('id')
      .eq('property_id', input.propertyId)
      .eq('provider', this.provider)
      .eq('provider_submission_id', input.submissionId)
      .maybeSingle()
    if (existingError) {
      throw new Error(`Failed to check lead submission identity: ${existingError.message}`)
    }
    if (existing) {
      return { leadId: existing.id, duplicate: true, isExisting: true }
    }

    try {
      const result = await upsertLeadByContact({
        client: this.client,
        propertyId: input.propertyId,
        email: input.email,
        phone: input.phone,
        create: {
          org_id: input.orgId,
          provider: this.provider,
          provider_submission_id: input.submissionId,
          source: input.attribution.source,
          first_name: input.firstName,
          last_name: input.lastName || null,
          email: input.email || null,
          phone: input.phone || null,
          move_in_date: input.moveInDate || null,
          bedrooms: input.bedrooms || null,
          notes: input.notes || null,
          status: 'new',
          consent: input.consent,
          consent_text: input.consentText,
          consented_at: input.consentedAt,
          attribution: input.attribution as unknown as Json,
        },
        update: {
          first_name: input.firstName,
          ...(input.lastName ? { last_name: input.lastName } : {}),
          ...(input.email ? { email: input.email } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.moveInDate ? { move_in_date: input.moveInDate } : {}),
          ...(input.bedrooms ? { bedrooms: input.bedrooms } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          consent: input.consent,
          consent_text: input.consentText,
          consented_at: input.consentedAt,
        },
        repeatActivity: {
          description: `Returned via SiteForge Website: ${
            [
              input.moveInDate ? `Move-in: ${input.moveInDate}` : null,
              input.bedrooms ? `Bedrooms: ${input.bedrooms}` : null,
              input.notes ? `Notes: ${input.notes}` : null,
            ].filter(Boolean).join(', ') || 'New inquiry'
          }`,
          metadata: {
            source: 'siteforge',
            provider: this.provider,
            submissionId: input.submissionId,
          },
        },
      })

      return {
        leadId: result.leadId,
        duplicate: false,
        isExisting: result.isExisting,
      }
    } catch (error) {
      if (error instanceof LeadUpsertError && error.code === '23505') {
        const { data: duplicate } = await this.client
          .from('leads')
          .select('id')
          .eq('property_id', input.propertyId)
          .eq('provider', this.provider)
          .eq('provider_submission_id', input.submissionId)
          .single()
        if (duplicate) {
          return { leadId: duplicate.id, duplicate: true, isExisting: true }
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to submit lead through ${this.provider}: ${message}`)
    }
  }

  async scheduleTour(raw: NormalizedTourSubmission) {
    const input = normalizedTourSubmissionSchema.parse(raw)
    const { data: existing, error: existingError } = await this.client
      .from('tours')
      .select('id')
      .eq('property_id', input.propertyId)
      .eq('provider', this.provider)
      .eq('provider_tour_id', input.submissionId)
      .maybeSingle()
    if (existingError) {
      throw new Error(`Failed to check tour submission identity: ${existingError.message}`)
    }
    if (existing) return { tourId: existing.id, duplicate: true }

    const { data, error } = await this.client
      .from('tours')
      .insert({
        org_id: input.orgId,
        property_id: input.propertyId,
        lead_id: input.leadId,
        provider: this.provider,
        provider_tour_id: input.submissionId,
        tour_date: input.date,
        tour_time: input.time,
        tour_type: input.tourType,
        status: 'scheduled',
        notes: input.notes || null,
        attribution: input.attribution as unknown as Json,
      })
      .select('id')
      .single()
    if (error || !data) {
      throw new Error(`Failed to schedule tour through ${this.provider}: ${error?.message}`)
    }
    return { tourId: data.id, duplicate: false }
  }
}

export class P11ConversionAdapter extends DatabaseConversionAdapter {
  readonly provider = 'p11' as const
}

export class LumaLeasingConversionAdapter extends DatabaseConversionAdapter {
  readonly provider = 'lumaleasing' as const
}

export function getConversionProviderAdapter(
  provider: 'p11' | 'lumaleasing',
  client?: SupabaseClient<Database>
): ConversionProviderAdapter {
  return provider === 'lumaleasing'
    ? new LumaLeasingConversionAdapter(client)
    : new P11ConversionAdapter(client)
}

const consentSchema = z.preprocess(
  (value) =>
    value === true ||
    value === 'true' ||
    value === '1' ||
    value === 'on',
  z.boolean()
)

export const siteForgePublicConversionSchema = z
  .object({
    submission_id: z.string().trim().min(8).max(200).optional(),
    submissionId: z.string().trim().min(8).max(200).optional(),
    form_type: z.enum(['contact', 'tour', 'register']).optional(),
    formType: z.enum(['contact', 'tour', 'register']).optional(),
    intent: verticalConversionIntentSchema.optional(),
    offering_id: z.guid().optional(),
    offeringId: z.guid().optional(),
    custom_fields: z.record(z.string(), z.string().trim().max(2_000)).optional(),
    customFields: z.record(z.string(), z.string().trim().max(2_000)).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    first_name: z.string().trim().max(100).optional(),
    firstName: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(7).max(30).optional(),
    move_in_date: z.string().date().optional(),
    moveInDate: z.string().date().optional(),
    bedrooms: z.string().trim().max(50).optional(),
    bedroomPreference: z.string().trim().max(50).optional(),
    message: z.string().trim().max(4_000).optional(),
    notes: z.string().trim().max(4_000).optional(),
    consent: consentSchema.optional(),
    consent_text: z.string().trim().min(10).max(2_000).optional(),
    consentText: z.string().trim().min(10).max(2_000).optional(),
    timestamp: z.string().datetime().optional(),
    page_url: z.string().url().optional(),
    pageUrl: z.string().url().optional(),
    referrer: z.string().url().optional(),
    session_id: z.string().trim().min(8).max(200).optional(),
    sessionId: z.string().trim().min(8).max(200).optional(),
    analytics_consent: z
      .enum(['unknown', 'denied', 'granted', 'not_required'])
      .optional(),
    analyticsConsent: z
      .enum(['unknown', 'denied', 'granted', 'not_required'])
      .optional(),
    campaign: z
      .object({
        source: z.string().trim().max(100).optional(),
        medium: z.string().trim().max(100).optional(),
        campaign: z.string().trim().max(200).optional(),
        content: z.string().trim().max(200).optional(),
        term: z.string().trim().max(200).optional(),
      })
      .optional(),
    click_ids: z
      .object({
        gclid: z.string().trim().max(300).optional(),
        fbclid: z.string().trim().max(300).optional(),
        msclkid: z.string().trim().max(300).optional(),
        ttclid: z.string().trim().max(300).optional(),
      })
      .strict()
      .optional(),
    clickIds: z
      .object({
        gclid: z.string().trim().max(300).optional(),
        fbclid: z.string().trim().max(300).optional(),
        msclkid: z.string().trim().max(300).optional(),
        ttclid: z.string().trim().max(300).optional(),
      })
      .strict()
      .optional(),
    redirect_url: z.string().trim().max(2_048).optional(),
    tour_date: z.string().date().optional(),
    tourDate: z.string().date().optional(),
    tour_time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
    tourTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).optional(),
    tour_type: z.enum(['in_person', 'virtual', 'self_guided']).optional(),
    tourType: z.enum(['in_person', 'virtual', 'self_guided']).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const intent =
      value.intent ||
      ((value.form_type || value.formType) === 'tour'
        ? 'tour'
        : (value.form_type || value.formType) === 'register'
          ? 'register_interest'
          : 'inquiry')
    const contract = SITEFORGE_CONVERSION_INTENTS[intent]
    if (!value.submission_id && !value.submissionId) {
      context.addIssue({
        code: 'custom',
        path: ['submission_id'],
        message: 'submission_id is required',
      })
    }
    if (
      contract.providerCapability === 'lead_capture' ||
      contract.providerCapability === 'tour_scheduler'
    ) {
      if (!value.email && !value.phone) {
        context.addIssue({
          code: 'custom',
          path: ['email'],
          message: 'Email or phone is required',
        })
      }
    }
    if (contract.consentRequirement === 'explicit' && value.consent !== true) {
      context.addIssue({
        code: 'custom',
        path: ['consent'],
        message: 'Explicit consent is required',
      })
    }
    if (
      contract.consentRequirement === 'explicit' &&
      !value.consent_text &&
      !value.consentText
    ) {
      context.addIssue({
        code: 'custom',
        path: ['consent_text'],
        message: 'consent_text is required',
      })
    }
    if (intent === 'tour') {
      if (!value.email) {
        context.addIssue({
          code: 'custom',
          path: ['email'],
          message: 'Email is required to schedule a tour',
        })
      }
      if (!(value.tour_date || value.tourDate)) {
        context.addIssue({
          code: 'custom',
          path: ['tour_date'],
          message: 'tour_date is required for tour forms',
        })
      }
      if (!(value.tour_time || value.tourTime)) {
        context.addIssue({
          code: 'custom',
          path: ['tour_time'],
          message: 'tour_time is required for tour forms',
        })
      }
    }
    try {
      validateConversionCustomFields(
        intent,
        value.custom_fields || value.customFields
      )
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['custom_fields'],
        message:
          error instanceof Error
            ? error.message
            : 'Custom conversion fields are invalid',
      })
    }
  })

export type SiteForgePublicConversionInput = z.infer<
  typeof siteForgePublicConversionSchema
>

export interface PublicWebsiteConversionContext {
  websiteId: string
  propertyId: string
  orgId: string
  publicKey: string
  artifactId: string | null
  propertyName: string
  propertyAddress?: string
  provider: 'p11' | 'lumaleasing'
  toursEnabled: boolean
  allowedOrigins: readonly string[]
}

function originFromUrl(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim()
  if (!normalizedValue) return null
  try {
    const url = new URL(
      normalizedValue.includes('://')
        ? normalizedValue
        : `https://${normalizedValue}`
    )
    return url.origin
  } catch {
    return null
  }
}

export function isAllowedPublicWebsiteOrigin(
  context: PublicWebsiteConversionContext,
  origin: string | null
): boolean {
  const normalized = originFromUrl(origin)
  return Boolean(normalized && context.allowedOrigins.includes(normalized))
}

export async function resolvePublicWebsiteConversionContext(
  websiteId: string,
  client: SupabaseClient<Database> = createServiceClient()
): Promise<PublicWebsiteConversionContext | null> {
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select(
      'id, org_id, property_id, siteforge_public_key, current_artifact_version_id, target_domain, wp_url, staging_url, production_url, canonical_preview_url'
    )
    .eq('id', websiteId)
    .maybeSingle()
  if (websiteError) {
    throw new Error(`Failed to resolve public website: ${websiteError.message}`)
  }
  if (!website) return null

  const [
    { data: property, error: propertyError },
    { data: lumaConfig },
    { data: activeTargets, error: targetsError },
  ] =
    await Promise.all([
      client
        .from('properties')
        .select('id, org_id, name, address, website_url')
        .eq('id', website.property_id)
        .eq('org_id', website.org_id)
        .maybeSingle(),
      client
        .from('lumaleasing_config')
        .select('is_active, tours_enabled')
        .eq('property_id', website.property_id)
        .maybeSingle(),
      client
        .from('siteforge_wordpress_targets')
        .select('site_url')
        .eq('website_id', website.id)
        .eq('is_active', true),
    ])
  if (propertyError) {
    throw new Error(`Failed to resolve website property: ${propertyError.message}`)
  }
  if (targetsError) {
    throw new Error(`Failed to resolve website targets: ${targetsError.message}`)
  }
  if (!property) return null

  const allowedOrigins = [
    website.target_domain,
    website.wp_url,
    website.staging_url,
    website.production_url,
    website.canonical_preview_url,
    property.website_url,
    ...(activeTargets || []).map((target) => target.site_url),
  ]
    .map(originFromUrl)
    .filter((origin): origin is string => Boolean(origin))

  return {
    websiteId: website.id,
    propertyId: website.property_id,
    orgId: website.org_id,
    publicKey: website.siteforge_public_key,
    artifactId: website.current_artifact_version_id,
    propertyName: property.name,
    propertyAddress: formatPropertyAddress(property.address) || undefined,
    provider: lumaConfig?.is_active ? 'lumaleasing' : 'p11',
    toursEnabled: Boolean(lumaConfig?.is_active && lumaConfig.tours_enabled),
    allowedOrigins: [...new Set(allowedOrigins)],
  }
}

function splitName(input: SiteForgePublicConversionInput) {
  const suppliedFirst = input.first_name || input.firstName
  const suppliedLast = input.last_name || input.lastName
  if (suppliedFirst) {
    return { firstName: suppliedFirst, lastName: suppliedLast }
  }
  const [firstName, ...lastParts] = (input.name || '').split(/\s+/).filter(Boolean)
  return {
    firstName: firstName || 'Prospect',
    lastName: suppliedLast || lastParts.join(' ') || undefined,
  }
}

type SiteForgeConversionIntent = keyof typeof SITEFORGE_CONVERSION_INTENTS

function conversionIntentFromInput(
  input: SiteForgePublicConversionInput
): SiteForgeConversionIntent {
  if (input.intent) return input.intent
  const formType = input.form_type || input.formType
  if (formType === 'tour') return 'tour'
  if (formType === 'register') return 'register_interest'
  return 'inquiry'
}

function formKindForIntent(
  intent: SiteForgeConversionIntent
): 'lead' | 'tour' | 'contact' | 'custom' {
  if (intent === 'tour') return 'tour'
  if (intent === 'inquiry') return 'contact'
  if (intent === 'register_interest') return 'lead'
  return 'custom'
}

type PublicConversionDependencies = {
  client?: SupabaseClient<Database>
  syncLead?: typeof syncLeadToCRM
  startLeadWorkflow?: typeof startWorkflow
  bookTour?: typeof bookLumaLeasingTour
  trackEvent?: typeof trackEngagementEvent
  recordTelemetry?: typeof recordConfirmedSiteForgeTelemetry
  recordSubmission?: typeof recordSiteForgeConversionSubmission
  resolveIntentVersion?: typeof ensureSiteForgeConversionIntentVersion
  enqueueOutbox?: typeof enqueueSiteForgeOutbox
}

type ConversionSubmissionRow =
  Database['public']['Tables']['siteforge_conversion_submissions']['Row']

async function ensureSiteForgeConversionIntentVersion(
  client: SupabaseClient<Database>,
  context: PublicWebsiteConversionContext,
  intent: SiteForgeConversionIntent,
  contract: ConversionIntentDefinition
): Promise<{ id: string; version: number; contentHash: string }> {
  const contractPayload = jsonValueSchema.parse({
    schemaVersion: 1,
    ...contract,
  })
  const contentHash = hashSiteForgeContent(contractPayload)
  const { data: latest, error: latestError } = await client
    .from('siteforge_conversion_intent_versions')
    .select('id, version, content_hash')
    .eq('website_id', context.websiteId)
    .eq('org_id', context.orgId)
    .eq('property_id', context.propertyId)
    .eq('intent_key', intent)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new Error(
      `Failed to resolve SiteForge conversion intent: ${latestError.message}`
    )
  }
  if (latest?.content_hash === contentHash) {
    return { id: latest.id, version: latest.version, contentHash }
  }

  const nextVersion = (latest?.version || 0) + 1
  const { data, error } = await client
    .from('siteforge_conversion_intent_versions')
    .insert({
      org_id: context.orgId,
      property_id: context.propertyId,
      website_id: context.websiteId,
      version: nextVersion,
      intent_key: intent,
      offering_kind: null,
      provider_key:
        contract.providerCapability === 'tour_scheduler'
          ? context.provider
          : 'p11',
      fallback_intent_key: contract.fallbackIntent,
      field_schema: {
        allowed: contract.allowedFields,
        required: contract.requiredFields,
      },
      sensitivity: contract.sensitivity,
      consent_requirement: contract.consentRequirement,
      success_event: contract.successEvent,
      offline_outcome_key: contract.offlineOutcome,
      policy: contractPayload,
      content_hash: contentHash,
      created_by: null,
    })
    .select('id, version')
    .single()
  if (!error && data) {
    return { id: data.id, version: data.version, contentHash }
  }

  const { data: concurrent } = await client
    .from('siteforge_conversion_intent_versions')
    .select('id, version')
    .eq('website_id', context.websiteId)
    .eq('intent_key', intent)
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (concurrent) {
    return { id: concurrent.id, version: concurrent.version, contentHash }
  }
  throw new Error(
    `Failed to persist SiteForge conversion intent: ${error?.message || 'unknown error'}`
  )
}

async function recordSiteForgeConversionSubmission(
  client: SupabaseClient<Database>,
  context: PublicWebsiteConversionContext,
  event: {
    submissionId: string
    formKind: 'lead' | 'tour' | 'contact' | 'custom'
    intent: SiteForgeConversionIntent
    intentVersionId: string | null
    offeringId: string | null
    providerKey: string
    sensitivity: ConversionIntentDefinition['sensitivity']
    input: SiteForgePublicConversionInput
    status: ConversionSubmissionRow['result_status']
    leadId?: string
    tourId?: string
    failureCode?: string
  }
): Promise<void> {
  const submissionPayload = jsonValueSchema.parse(event.input)
  const payloadHash = hashSiteForgeContent(submissionPayload)
  const receivedAt = event.input.timestamp || new Date().toISOString()

  if (event.status === 'received') {
    const { error } = await client
      .from('siteforge_conversion_submissions')
      .upsert(
        {
          org_id: context.orgId,
          property_id: context.propertyId,
          website_id: context.websiteId,
          artifact_id: context.artifactId,
          submission_id: event.submissionId,
          form_kind: event.formKind,
          intent_key: event.intent,
          intent_version_id: event.intentVersionId,
          offering_id: event.offeringId,
          provider_key: event.providerKey,
          sensitivity: event.sensitivity,
          submission_payload: submissionPayload,
          payload_hash: payloadHash,
          consent_state:
            event.input.consent === true ? 'accepted' : 'unknown',
          result_status: 'received',
          lead_id: null,
          tour_id: null,
          failure_code: null,
          request_id: null,
          received_at: receivedAt,
          processed_at: null,
        },
        {
          onConflict: 'website_id,submission_id',
          ignoreDuplicates: true,
        }
      )
    if (error) {
      throw new Error(
        `Failed to record SiteForge conversion receipt: ${error.message}`
      )
    }
    const { data: existing, error: existingError } = await client
      .from('siteforge_conversion_submissions')
      .select('payload_hash, intent_key')
      .eq('website_id', context.websiteId)
      .eq('submission_id', event.submissionId)
      .single()
    if (
      existingError ||
      !existing ||
      existing.payload_hash !== payloadHash ||
      existing.intent_key !== event.intent
    ) {
      throw new Error(
        'SiteForge conversion submission identity was reused with different content'
      )
    }
    return
  }

  const { error } = await client
    .from('siteforge_conversion_submissions')
    .update({
      result_status: event.status,
      lead_id: event.leadId || null,
      tour_id: event.tourId || null,
      failure_code: event.failureCode || null,
      processed_at: new Date().toISOString(),
    })
    .eq('website_id', context.websiteId)
    .eq('submission_id', event.submissionId)
    .eq('payload_hash', payloadHash)
  if (error) {
    throw new Error(
      `Failed to record SiteForge conversion outcome: ${error.message}`
    )
  }
}

export const siteForgeConversionOutcomeInputSchema = z
  .object({
    websiteId: z.guid(),
    submissionId: z.string().trim().min(1).max(200),
    conversionLane: forSaleConversionLaneSchema.nullable().default(null),
    outcomeKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    sourceKind: z.enum([
      'online',
      'provider',
      'crm',
      'offline',
      'operator',
      'import',
    ]),
    providerKey: z.string().trim().min(1).max(120).nullable().default(null),
    providerOutcomeId: z.string().trim().min(1).max(240).nullable().default(null),
    occurredAt: z.string().datetime(),
    evidence: jsonValueSchema.default({}),
    recordedBy: z.guid().nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.conversionLane) return
    const lane = FOR_SALE_CONVERSION_LANES[value.conversionLane]
    if (
      value.outcomeKey !== lane.onlineOutcome &&
      value.outcomeKey !== lane.offlineOutcome
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcomeKey'],
        message: `Outcome is not valid for ${value.conversionLane}`,
      })
    }
  })

export async function recordSiteForgeConversionOutcome(
  raw: z.input<typeof siteForgeConversionOutcomeInputSchema>,
  client: SupabaseClient<Database> = createServiceClient()
): Promise<{ id: string; duplicate: boolean }> {
  const input = siteForgeConversionOutcomeInputSchema.parse(raw)
  const { data: submission, error: submissionError } = await client
    .from('siteforge_conversion_submissions')
    .select(
      'id, org_id, property_id, website_id, intent_version_id, offering_id'
    )
    .eq('website_id', input.websiteId)
    .eq('submission_id', input.submissionId)
    .maybeSingle()
  if (submissionError) {
    throw new Error(
      `Failed to resolve SiteForge conversion submission: ${submissionError.message}`
    )
  }
  if (!submission) {
    throw new Error('SiteForge conversion submission was not found')
  }

  const evidence = jsonValueSchema.parse(
    input.conversionLane
      ? { conversionLane: input.conversionLane, detail: input.evidence }
      : input.evidence
  )
  const contentHash = hashSiteForgeContent({
    submissionRowId: submission.id,
    conversionLane: input.conversionLane,
    outcomeKey: input.outcomeKey,
    sourceKind: input.sourceKind,
    providerKey: input.providerKey,
    providerOutcomeId: input.providerOutcomeId,
    occurredAt: input.occurredAt,
    evidence,
  })
  const { data: existing, error: existingError } = await client
    .from('siteforge_conversion_outcomes')
    .select('id')
    .eq('submission_row_id', submission.id)
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (existingError) {
    throw new Error(
      `Failed to check SiteForge conversion outcome identity: ${existingError.message}`
    )
  }
  if (existing) return { id: existing.id, duplicate: true }

  const { data, error } = await client
    .from('siteforge_conversion_outcomes')
    .insert({
      org_id: submission.org_id,
      property_id: submission.property_id,
      website_id: submission.website_id,
      submission_row_id: submission.id,
      intent_version_id: submission.intent_version_id,
      offering_id: submission.offering_id,
      outcome_key: input.outcomeKey,
      source_kind: input.sourceKind,
      provider_key: input.providerKey,
      provider_outcome_id: input.providerOutcomeId,
      occurred_at: input.occurredAt,
      evidence,
      content_hash: contentHash,
      recorded_by: input.recordedBy,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(
      `Failed to record SiteForge conversion outcome: ${error?.message || 'unknown error'}`
    )
  }
  return { id: data.id, duplicate: false }
}

export async function ingestPublicSiteForgeConversion(
  context: PublicWebsiteConversionContext,
  raw: unknown,
  dependencies: PublicConversionDependencies = {}
): Promise<{
  leadId: string | null
  duplicate: boolean
  isExisting: boolean
  intent: SiteForgeConversionIntent
  tour?: BookLumaLeasingTourResult
}> {
  const input = siteForgePublicConversionSchema.parse(raw)
  const client = dependencies.client || createServiceClient()
  const submissionId = input.submission_id || input.submissionId!
  const pageUrl = input.page_url || input.pageUrl
  const intent = conversionIntentFromInput(input)
  const intentContract = SITEFORGE_CONVERSION_INTENTS[intent]
  const formKind = formKindForIntent(intent)
  const offeringId = input.offering_id || input.offeringId || null
  validateConversionCustomFields(intent, input.custom_fields || input.customFields)
  const intentVersion =
    dependencies.resolveIntentVersion ||
    (!dependencies.recordSubmission
      ? ensureSiteForgeConversionIntentVersion
      : null)
  const resolvedIntent = intentVersion
    ? await intentVersion(client, context, intent, intentContract)
    : null
  const providerKey =
    intentContract.providerCapability === 'tour_scheduler'
      ? context.provider
      : 'p11'
  const submissionIdentity = {
    submissionId,
    formKind,
    intent,
    intentVersionId: resolvedIntent?.id || null,
    offeringId,
    providerKey,
    sensitivity: intentContract.sensitivity,
    input,
  }
  const notes = input.message || input.notes
  const consentText =
    input.consent_text ||
    input.consentText ||
    'No explicit consent was required for this non-contact action.'
  const recordSubmission =
    dependencies.recordSubmission || recordSiteForgeConversionSubmission
  await recordSubmission(client, context, {
    ...submissionIdentity,
    status: 'received',
  })
  if (
    intentContract.providerCapability === 'external_redirect' ||
    intentContract.providerCapability === 'application_redirect'
  ) {
    await recordSubmission(client, context, {
      ...submissionIdentity,
      status: 'accepted',
    })
    return {
      leadId: null,
      duplicate: false,
      isExisting: false,
      intent,
    }
  }

  const adapter = getConversionProviderAdapter(context.provider, client)
  const { firstName, lastName } = splitName(input)
  const attribution = attributionFromUrl(pageUrl, {
    source: input.campaign?.source || 'siteforge',
    medium: input.campaign?.medium || 'website',
    campaign: input.campaign?.campaign,
    content: input.campaign?.content,
    term: input.campaign?.term,
    clickIds: input.click_ids || input.clickIds,
    landingPage: pageUrl,
    referrer: input.referrer,
    sessionId: input.session_id || input.sessionId,
    websiteId: context.websiteId,
    artifactId: context.artifactId,
    consent: {
      state:
        input.analytics_consent ||
        input.analyticsConsent ||
        'unknown',
      text: consentText,
      capturedAt: input.timestamp || new Date().toISOString(),
    },
  })
  const leadResult = await adapter.submitLead({
    orgId: context.orgId,
    propertyId: context.propertyId,
    submissionId,
    firstName,
    lastName,
    email: input.email,
    phone: input.phone,
    moveInDate: input.move_in_date || input.moveInDate,
    bedrooms: input.bedrooms || input.bedroomPreference,
    notes,
    consent: true,
    consentText,
    consentedAt: input.timestamp || new Date().toISOString(),
    attribution,
  })

  const hasInjectedSideEffects = Boolean(
    dependencies.syncLead ||
      dependencies.startLeadWorkflow ||
      dependencies.trackEvent
  )
  if (hasInjectedSideEffects && !leadResult.duplicate) {
    const sync = dependencies.syncLead || syncLeadToCRM
    const workflow = dependencies.startLeadWorkflow || startWorkflow
    await sync(context.propertyId, leadResult.leadId, {
      first_name: firstName,
      last_name: lastName,
      email: input.email,
      phone: input.phone,
      source: 'SiteForge Website',
      status: 'new',
      move_in_date: input.move_in_date || input.moveInDate,
      bedrooms: input.bedrooms || input.bedroomPreference,
      notes,
      metadata: {
        ...attributionMetadata(attribution),
        intent,
        offeringId,
        intentVersionId: resolvedIntent?.id || null,
      },
    }).catch((error) =>
      console.error('[SiteForge conversion] CRM sync failed (non-blocking):', error)
    )
    if (!leadResult.isExisting) {
      workflow(leadResult.leadId, context.propertyId, 'lead_created').catch(
        (error) =>
          console.error(
            '[SiteForge conversion] lead workflow failed (non-blocking):',
            error
          )
      )
    }
    const trackEvent = dependencies.trackEvent || trackEngagementEvent
    trackEvent({
      leadId: leadResult.leadId,
      propertyId: context.propertyId,
      eventType: 'website_lead_submitted',
      metadata: {
        websiteId: context.websiteId,
        artifactId: context.artifactId,
        submissionId,
        intent,
        offeringId,
        intentVersionId: resolvedIntent?.id || null,
        sessionId: input.session_id || input.sessionId,
        ...attributionMetadata(attribution),
      },
    }).catch((error) =>
      console.error('[SiteForge conversion] LeadPulse event failed (non-blocking):', error)
    )
  } else if (!hasInjectedSideEffects && !leadResult.duplicate) {
    const enqueue = dependencies.enqueueOutbox || enqueueSiteForgeOutbox
    const sharedIdentity = {
      orgId: context.orgId,
      propertyId: context.propertyId,
      websiteId: context.websiteId,
      artifactId: context.artifactId || undefined,
      aggregateType: 'lead',
      aggregateId: leadResult.leadId,
      attribution: attribution as unknown as Json,
      consentEvidence: {
        state: attribution.consent.state,
        text: attribution.consent.text,
        capturedAt: attribution.consent.capturedAt,
      } as Json,
    }
    const outboxWrites = [
      enqueue(client, {
        ...sharedIdentity,
        eventType: 'crm.lead_sync',
        idempotencyKey: `${submissionId}:crm`,
        payload: {
          propertyId: context.propertyId,
          leadId: leadResult.leadId,
          lead: {
            first_name: firstName,
            last_name: lastName,
            email: input.email,
            phone: input.phone,
            source: 'SiteForge Website',
            status: 'new',
            move_in_date: input.move_in_date || input.moveInDate,
            bedrooms: input.bedrooms || input.bedroomPreference,
            notes,
            metadata: {
              ...attributionMetadata(attribution),
              intent,
              offeringId,
              intentVersionId: resolvedIntent?.id || null,
            },
          },
        } as Json,
      }),
      enqueue(client, {
        ...sharedIdentity,
        eventType: 'leadpulse.engagement',
        idempotencyKey: `${submissionId}:leadpulse`,
        payload: {
          propertyId: context.propertyId,
          leadId: leadResult.leadId,
          eventType: 'website_lead_submitted',
          metadata: {
            websiteId: context.websiteId,
            artifactId: context.artifactId,
            submissionId,
            intent,
            offeringId,
            intentVersionId: resolvedIntent?.id || null,
            sessionId: input.session_id || input.sessionId,
            ...attributionMetadata(attribution),
          },
        } as Json,
      }),
    ]
    if (!leadResult.isExisting) {
      outboxWrites.push(
        enqueue(client, {
          ...sharedIdentity,
          eventType: 'workflow.start',
          idempotencyKey: `${submissionId}:workflow`,
          payload: {
            propertyId: context.propertyId,
            leadId: leadResult.leadId,
            trigger: 'lead_created',
          },
        })
      )
    }
    await Promise.all(outboxWrites)
  }

  await persistAttributionTouches(
    client,
    {
      orgId: context.orgId,
      propertyId: context.propertyId,
      leadId: leadResult.leadId,
    },
    attribution
  )

  const recordTelemetry =
    dependencies.recordTelemetry || recordConfirmedSiteForgeTelemetry
  await recordTelemetry(client, context, {
    eventType: 'lead_submit',
    submissionId,
    leadId: leadResult.leadId,
    input,
    payload: {
      intent,
      offeringId,
      intentVersionId: resolvedIntent?.id || null,
      successEvent: intentContract.successEvent,
    },
  })

  if (intent !== 'tour') {
    await recordSubmission(client, context, {
      ...submissionIdentity,
      status: 'accepted',
      leadId: leadResult.leadId,
    })
    return { ...leadResult, intent }
  }
  if (!context.toursEnabled) {
    await recordSubmission(client, context, {
      ...submissionIdentity,
      status: 'rejected',
      leadId: leadResult.leadId,
      failureCode: 'tours_disabled',
    })
    throw new Error('Tour scheduling is not enabled for this property')
  }

  const bookTour = dependencies.bookTour || bookLumaLeasingTour
  const tour = await bookTour({
    supabase: client,
    propertyId: context.propertyId,
    propertyName: context.propertyName,
    propertyAddress: context.propertyAddress,
    leadId: leadResult.leadId,
    leadInfo: {
      first_name: firstName,
      last_name: lastName,
      email: input.email!,
      phone: input.phone,
    },
    bookingDate: input.tour_date || input.tourDate!,
    bookingTime: input.tour_time || input.tourTime!,
    specialRequests: notes,
    source: 'lumaleasing',
    attributionMetadata: attributionMetadata(attribution),
  })

  if (tour.ok) {
    await recordTelemetry(client, context, {
      eventType: 'tour_booked',
      submissionId,
      leadId: leadResult.leadId,
      input,
      payload: { tourId: tour.booking.id },
    })
  }

  await recordSubmission(client, context, {
    ...submissionIdentity,
    status: tour.ok ? 'accepted' : 'failed',
    leadId: leadResult.leadId,
    tourId: tour.ok ? tour.booking.id : undefined,
    failureCode: tour.ok ? undefined : tour.reason,
  })

  return { ...leadResult, intent, tour }
}

async function recordConfirmedSiteForgeTelemetry(
  client: SupabaseClient<Database>,
  context: PublicWebsiteConversionContext,
  event: {
    eventType: 'lead_submit' | 'tour_booked'
    submissionId: string
    leadId: string
    input: SiteForgePublicConversionInput
    payload?: Record<string, unknown>
  }
): Promise<void> {
  const sessionId =
    event.input.session_id || event.input.sessionId || event.submissionId
  const { error } = await client.from('siteforge_telemetry_events').upsert(
    {
      org_id: context.orgId,
      property_id: context.propertyId,
      website_id: context.websiteId,
      artifact_id: context.artifactId,
      lead_id: event.leadId,
      event_type: event.eventType,
      session_id: sessionId,
      idempotency_key: `conversion:${event.submissionId}:${event.eventType}`,
      page_path: event.input.page_url || event.input.pageUrl
        ? new URL(event.input.page_url || event.input.pageUrl!).pathname
        : '/',
      page_url: event.input.page_url || event.input.pageUrl || null,
      referrer: event.input.referrer || null,
      campaign: (event.input.campaign || {}) as Json,
      consent_state:
        event.input.analytics_consent ||
        event.input.analyticsConsent ||
        'unknown',
      payload: (event.payload || {}) as Json,
      occurred_at: event.input.timestamp || new Date().toISOString(),
    },
    { onConflict: 'website_id,idempotency_key', ignoreDuplicates: true }
  )
  if (error) {
    throw new Error(`Failed to record confirmed SiteForge conversion: ${error.message}`)
  }
}
