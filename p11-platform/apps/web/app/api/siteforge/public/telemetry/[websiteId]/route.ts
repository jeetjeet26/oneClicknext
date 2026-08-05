import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import {
  getRateLimitKey,
  publicReadLimiter,
  rateLimitHeaders,
} from '@/utils/services/rate-limiter'
import {
  isAllowedPublicWebsiteOrigin,
  resolvePublicWebsiteConversionContext,
} from '@/utils/siteforge/providers/conversions'
import type { Json } from '@/types/supabase'
import {
  attributionFromUrl,
  persistAttributionTouches,
} from '@/utils/siteforge/operations/attribution'

const websiteIdSchema = z.string().uuid()
const telemetrySchema = z
  .object({
    eventType: z.enum([
      'page_view',
      'cta_click',
      'floorplan_view',
      'availability_click',
      'lead_start',
      'lead_submit',
      'tour_start',
      'tour_booked',
    ]),
    idempotencyKey: z.string().trim().min(8).max(200),
    sessionId: z.string().trim().min(8).max(200),
    consentState: z.enum(['granted', 'not_required']),
    pageUrl: z.string().url(),
    referrer: z.string().url().optional(),
    occurredAt: z.string().datetime().optional(),
    campaign: z
      .object({
        source: z.string().trim().max(100).optional(),
        medium: z.string().trim().max(100).optional(),
        campaign: z.string().trim().max(200).optional(),
        content: z.string().trim().max(200).optional(),
        term: z.string().trim().max(200).optional(),
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
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-SiteForge-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

async function resolveRequest(
  request: NextRequest,
  params: Promise<{ websiteId: string }>
) {
  const parsed = websiteIdSchema.safeParse((await params).websiteId)
  if (!parsed.success) return null
  const website = await resolvePublicWebsiteConversionContext(parsed.data)
  const origin = request.headers.get('origin')
  if (!website || !isAllowedPublicWebsiteOrigin(website, origin)) return null
  return { website, origin: origin! }
}

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const resolved = await resolveRequest(request, params).catch(() => null)
  return resolved
    ? new NextResponse(null, { status: 204, headers: corsHeaders(resolved.origin) })
    : NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/public/telemetry/[websiteId]'
  )
  ctx.logStart()
  try {
    const resolved = await resolveRequest(request, params)
    if (!resolved) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
    }
    const headers = {
      ...corsHeaders(resolved.origin),
      ...ctx.responseHeaders,
    }
    if (
      request.headers.get('x-siteforge-key')?.trim() !==
      resolved.website.publicKey
    ) {
      return NextResponse.json(
        { error: 'Invalid SiteForge publishable key' },
        { status: 401, headers }
      )
    }
    const limit = publicReadLimiter.check(
      getRateLimitKey(request, `siteforge-telemetry:${resolved.website.websiteId}`)
    )
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { ...headers, ...rateLimitHeaders(limit) } }
      )
    }

    const parsed = telemetrySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid telemetry payload', issues: parsed.error.issues },
        { status: 400, headers }
      )
    }
    const page = new URL(parsed.data.pageUrl)
    if (page.origin !== resolved.origin) {
      return NextResponse.json(
        { error: 'Page origin does not match request origin' },
        { status: 403, headers }
      )
    }

    const client = createServiceClient()
    const { error } = await client.from('siteforge_telemetry_events').upsert(
      {
        org_id: resolved.website.orgId,
        property_id: resolved.website.propertyId,
        website_id: resolved.website.websiteId,
        artifact_id: resolved.website.artifactId,
        event_type: parsed.data.eventType,
        session_id: parsed.data.sessionId,
        idempotency_key: parsed.data.idempotencyKey,
        page_path: page.pathname,
        page_url: parsed.data.pageUrl,
        referrer: parsed.data.referrer || null,
        campaign: (parsed.data.campaign || {}) as Json,
        consent_state: parsed.data.consentState,
        payload: (parsed.data.payload || {}) as Json,
        occurred_at: parsed.data.occurredAt || new Date().toISOString(),
      },
      { onConflict: 'website_id,idempotency_key', ignoreDuplicates: true }
    )
    if (error) throw new Error(`Failed to ingest SiteForge telemetry: ${error.message}`)
    const attribution = attributionFromUrl(parsed.data.pageUrl, {
      ...parsed.data.campaign,
      clickIds: parsed.data.clickIds,
      landingPage: parsed.data.pageUrl,
      referrer: parsed.data.referrer,
      sessionId: parsed.data.sessionId,
      websiteId: resolved.website.websiteId,
      artifactId: resolved.website.artifactId,
      consent: { state: parsed.data.consentState },
    })
    await persistAttributionTouches(
      client,
      {
        orgId: resolved.website.orgId,
        propertyId: resolved.website.propertyId,
      },
      attribution,
      parsed.data.occurredAt
    )

    ctx.logSuccess(202, {
      websiteId: resolved.website.websiteId,
      eventType: parsed.data.eventType,
    })
    return NextResponse.json({ accepted: true }, { status: 202, headers })
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to ingest telemetry' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
