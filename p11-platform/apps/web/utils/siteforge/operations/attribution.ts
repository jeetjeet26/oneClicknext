import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'

const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional()

export const siteForgeAttributionSchema = z
  .object({
    source: optionalText(100),
    medium: optionalText(100),
    campaign: optionalText(200),
    term: optionalText(200),
    content: optionalText(200),
    clickIds: z
      .object({
        gclid: optionalText(300),
        fbclid: optionalText(300),
        msclkid: optionalText(300),
        ttclid: optionalText(300),
      })
      .strict()
      .optional(),
    landingPage: z.string().url().optional(),
    referrer: z.string().url().optional(),
    sessionId: optionalText(200),
    websiteId: z.string().uuid().optional(),
    artifactId: z.string().uuid().nullable().optional(),
    consent: z
      .object({
        state: z.enum(['unknown', 'denied', 'granted', 'not_required']),
        text: z.string().trim().max(2_000).optional(),
        capturedAt: z.string().datetime().optional(),
      })
      .strict(),
  })
  .strict()

export type SiteForgeAttribution = z.infer<typeof siteForgeAttributionSchema>

export function attributionFromUrl(
  pageUrl: string | undefined,
  input: Partial<SiteForgeAttribution> & Pick<SiteForgeAttribution, 'consent'>
): SiteForgeAttribution {
  const url = pageUrl ? new URL(pageUrl) : null
  const parameter = (name: string) => url?.searchParams.get(name) || undefined
  return siteForgeAttributionSchema.parse({
    ...input,
    source: input.source || parameter('utm_source') || 'direct',
    medium: input.medium || parameter('utm_medium'),
    campaign: input.campaign || parameter('utm_campaign'),
    term: input.term || parameter('utm_term'),
    content: input.content || parameter('utm_content'),
    landingPage: input.landingPage || pageUrl,
    clickIds: {
      gclid: input.clickIds?.gclid || parameter('gclid'),
      fbclid: input.clickIds?.fbclid || parameter('fbclid'),
      msclkid: input.clickIds?.msclkid || parameter('msclkid'),
      ttclid: input.clickIds?.ttclid || parameter('ttclid'),
    },
  })
}

export function attributionMetadata(attribution: SiteForgeAttribution) {
  return {
    attribution,
    attribution_first_touch: attribution,
    attribution_last_touch: attribution,
    website_id: attribution.websiteId,
    artifact_id: attribution.artifactId,
    session_id: attribution.sessionId,
    consent_evidence: attribution.consent,
  }
}

export function withOutboxAttribution<T extends Record<string, unknown>>(
  payload: T,
  attribution: SiteForgeAttribution
) {
  return {
    payload: { ...payload, ...attributionMetadata(attribution) },
    attribution: attribution as unknown as Json,
    consentEvidence: attribution.consent as unknown as Json,
  }
}

export async function persistAttributionTouches(
  client: SupabaseClient<Database>,
  scope: { orgId: string; propertyId: string; leadId?: string },
  attribution: SiteForgeAttribution,
  touchedAt = new Date().toISOString()
): Promise<void> {
  if (!attribution.sessionId) return
  const base = {
    org_id: scope.orgId,
    property_id: scope.propertyId,
    website_id: attribution.websiteId || null,
    artifact_id: attribution.artifactId || null,
    session_id: attribution.sessionId,
    lead_id: scope.leadId || null,
    source: attribution.source || null,
    medium: attribution.medium || null,
    campaign: attribution.campaign || null,
    term: attribution.term || null,
    content: attribution.content || null,
    click_ids: (attribution.clickIds || {}) as Json,
    landing_page: attribution.landingPage || null,
    referrer: attribution.referrer || null,
    consent_evidence: attribution.consent as unknown as Json,
    touched_at: touchedAt,
  }
  const { data, error: lookupError } = await client
    .from('siteforge_attribution_touches')
    .select('id')
    .eq('website_id', attribution.websiteId || '')
    .eq('session_id', attribution.sessionId)
    .eq('touch_position', 'first')
    .limit(1)
  if (lookupError) throw new Error(`Failed to load first touch: ${lookupError.message}`)
  const touches = [
    ...(data?.length ? [] : [{ ...base, touch_position: 'first' }]),
    { ...base, touch_position: 'last' },
  ]
  const { error } = await client.from('siteforge_attribution_touches').insert(touches)
  if (error) throw new Error(`Failed to persist attribution touches: ${error.message}`)
}
