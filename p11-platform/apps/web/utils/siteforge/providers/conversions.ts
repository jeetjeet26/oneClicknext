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

const requiredConsentSchema = z.preprocess(
  (value) =>
    value === true ||
    value === 'true' ||
    value === '1' ||
    value === 'on',
  z.literal(true)
)

export const siteForgePublicConversionSchema = z
  .object({
    submission_id: z.string().trim().min(8).max(200).optional(),
    submissionId: z.string().trim().min(8).max(200).optional(),
    form_type: z.enum(['contact', 'tour', 'register']).optional(),
    formType: z.enum(['contact', 'tour', 'register']).optional(),
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
    consent: requiredConsentSchema,
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
    if (!value.submission_id && !value.submissionId) {
      context.addIssue({
        code: 'custom',
        path: ['submission_id'],
        message: 'submission_id is required',
      })
    }
    if (!value.email && !value.phone) {
      context.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Email or phone is required',
      })
    }
    if (!value.consent_text && !value.consentText) {
      context.addIssue({
        code: 'custom',
        path: ['consent_text'],
        message: 'consent_text is required',
      })
    }
    const formType = value.form_type || value.formType || 'contact'
    if (formType === 'tour') {
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

type PublicConversionDependencies = {
  client?: SupabaseClient<Database>
  syncLead?: typeof syncLeadToCRM
  startLeadWorkflow?: typeof startWorkflow
  bookTour?: typeof bookLumaLeasingTour
  trackEvent?: typeof trackEngagementEvent
  recordTelemetry?: typeof recordConfirmedSiteForgeTelemetry
  enqueueOutbox?: typeof enqueueSiteForgeOutbox
}

export async function ingestPublicSiteForgeConversion(
  context: PublicWebsiteConversionContext,
  raw: unknown,
  dependencies: PublicConversionDependencies = {}
): Promise<{
  leadId: string
  duplicate: boolean
  isExisting: boolean
  tour?: BookLumaLeasingTourResult
}> {
  const input = siteForgePublicConversionSchema.parse(raw)
  const client = dependencies.client || createServiceClient()
  const adapter = getConversionProviderAdapter(context.provider, client)
  const { firstName, lastName } = splitName(input)
  const submissionId = input.submission_id || input.submissionId!
  const pageUrl = input.page_url || input.pageUrl
  const formType = input.form_type || input.formType || 'contact'
  const notes = input.message || input.notes
  const consentText = input.consent_text || input.consentText!
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
      metadata: attributionMetadata(attribution),
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
            metadata: attributionMetadata(attribution),
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
  })

  if (formType !== 'tour') return leadResult
  if (!context.toursEnabled) {
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

  return { ...leadResult, tour }
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
