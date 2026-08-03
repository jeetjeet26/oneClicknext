import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContext } from '@/utils/services/request-context'
import {
  getRateLimitKey,
  leadLimiter,
  rateLimitHeaders,
} from '@/utils/services/rate-limiter'
import { rateLimited, serverError } from '@/utils/services/api-helpers'
import {
  ingestPublicSiteForgeConversion,
  isAllowedPublicWebsiteOrigin,
  resolvePublicWebsiteConversionContext,
} from '@/utils/siteforge/providers/conversions'

const websiteIdSchema = z.string().uuid()

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-SiteForge-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

async function resolveRequestContext(
  request: NextRequest,
  params: Promise<{ websiteId: string }>
) {
  const parsedWebsiteId = websiteIdSchema.safeParse((await params).websiteId)
  if (!parsedWebsiteId.success) return null
  const website = await resolvePublicWebsiteConversionContext(parsedWebsiteId.data)
  const origin = request.headers.get('origin')
  if (!website || !isAllowedPublicWebsiteOrigin(website, origin)) return null
  return { website, origin: origin! }
}

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  try {
    const resolved = await resolveRequestContext(request, params)
    if (!resolved) {
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
    }
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(resolved.origin),
    })
  } catch {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/public/conversions/[websiteId]'
  )
  ctx.logStart()
  let responseHeaders: Record<string, string> = ctx.responseHeaders

  try {
    const resolved = await resolveRequestContext(request, params)
    if (!resolved) {
      ctx.logSuccess(403, { reason: 'origin_not_allowed' })
      return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
    }
    responseHeaders = {
      ...corsHeaders(resolved.origin),
      ...ctx.responseHeaders,
    }
    if (
      request.headers.get('x-siteforge-key')?.trim() !==
      resolved.website.publicKey
    ) {
      ctx.logSuccess(401, { reason: 'invalid_publishable_key' })
      return NextResponse.json(
        { error: 'Invalid SiteForge publishable key' },
        { status: 401, headers: responseHeaders }
      )
    }
    const rateLimit = leadLimiter.check(
      getRateLimitKey(request, `siteforge-conversion:${resolved.website.websiteId}`)
    )
    if (!rateLimit.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...responseHeaders, ...rateLimitHeaders(rateLimit) })
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      ctx.logSuccess(400, { reason: 'invalid_json' })
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400, headers: responseHeaders }
      )
    }

    const pageUrl =
      raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>).page_url ||
          (raw as Record<string, unknown>).pageUrl
        : null
    let pageOrigin: string | null = null
    if (typeof pageUrl === 'string') {
      try {
        pageOrigin = new URL(pageUrl).origin
      } catch {
        pageOrigin = 'invalid'
      }
    }
    if (pageOrigin && pageOrigin !== resolved.origin) {
      ctx.logSuccess(403, { reason: 'page_origin_mismatch' })
      return NextResponse.json(
        { error: 'Page origin does not match request origin' },
        { status: 403, headers: responseHeaders }
      )
    }

    const result = await ingestPublicSiteForgeConversion(resolved.website, raw)
    if (result.tour && !result.tour.ok) {
      const status =
        result.tour.reason === 'time_unavailable' ? 409 :
        result.tour.reason === 'invalid_input' ? 400 : 503
      ctx.logSuccess(status, {
        reason: result.tour.reason,
        leadId: result.leadId,
      })
      return NextResponse.json(
        {
          error: result.tour.message,
          leadId: result.leadId,
          retryable: status >= 500 || status === 409,
        },
        { status, headers: responseHeaders }
      )
    }

    ctx.logSuccess(result.duplicate ? 200 : 201, {
      websiteId: resolved.website.websiteId,
      propertyId: resolved.website.propertyId,
      leadId: result.leadId,
      duplicate: result.duplicate,
    })
    return NextResponse.json(
      {
        success: true,
        leadId: result.leadId,
        duplicate: result.duplicate,
        tour: result.tour?.ok ? result.tour.booking : undefined,
      },
      { status: result.duplicate ? 200 : 201, headers: responseHeaders }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      ctx.logSuccess(400, { reason: 'validation_failed' })
      return NextResponse.json(
        { error: 'Invalid conversion payload', issues: error.issues },
        { status: 400, headers: responseHeaders }
      )
    }
    if (
      error instanceof Error &&
      error.message === 'Tour scheduling is not enabled for this property'
    ) {
      ctx.logSuccess(409, { reason: 'tours_disabled' })
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: responseHeaders }
      )
    }
    ctx.logError(500, error, { operation: 'siteforge_public_conversion' })
    return serverError(error, responseHeaders)
  }
}
