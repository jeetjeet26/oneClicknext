import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeSiteForgeWebsite } from '@/utils/siteforge/operations-auth'

const cadenceSchema = z.enum(['weekly', 'monthly', 'quarterly'])
const sectionsSchema = z
  .array(
    z.enum([
      'funnels',
      'sessions',
      'attribution',
      'versions',
      'freshness',
      'gaps',
      'incidents',
      'outcomes',
      'recommendations',
    ])
  )
  .min(1)
  .default([
    'funnels',
    'versions',
    'freshness',
    'gaps',
    'incidents',
    'outcomes',
    'recommendations',
  ])
const createSchema = z.object({
  websiteId: z.string().uuid(),
  recipientEmail: z.string().trim().email().max(320),
  cadence: cadenceSchema,
  sections: sectionsSchema,
})
const updateSchema = z.object({
  websiteId: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  status: z.enum(['active', 'paused', 'revoked']),
})

function nextSendAt(cadence: z.infer<typeof cadenceSchema>) {
  const next = new Date()
  if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7)
  if (cadence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  if (cadence === 'quarterly') next.setUTCMonth(next.getUTCMonth() + 3)
  return next.toISOString()
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reporting/subscriptions'
  )
  const websiteId = new URL(request.url).searchParams.get('websiteId')
  if (!z.string().uuid().safeParse(websiteId).success) {
    return NextResponse.json(
      { error: 'Valid websiteId is required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(websiteId!)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const { data, error } = await auth.service
    .from('siteforge_report_subscriptions')
    .select('*')
    .eq('org_id', auth.website.org_id)
    .eq('property_id', auth.website.property_id)
    .eq('website_id', auth.website.id)
    .order('created_at', { ascending: false })
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to list report subscriptions' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  return NextResponse.json({ subscriptions: data || [] }, {
    headers: ctx.responseHeaders,
  })
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reporting/subscriptions'
  )
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Valid report subscription is required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(parsed.data.websiteId, true)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const { data, error } = await auth.service
    .from('siteforge_report_subscriptions')
    .insert({
      org_id: auth.website.org_id,
      property_id: auth.website.property_id,
      website_id: auth.website.id,
      recipient_email: parsed.data.recipientEmail.toLowerCase(),
      cadence: parsed.data.cadence,
      status: 'active',
      report_config: {
        sections: parsed.data.sections,
        delivery: 'scheduled_export',
        providerInvocation: false,
      } as Json,
      next_send_at: nextSendAt(parsed.data.cadence),
      created_by: auth.user.id,
    })
    .select('*')
    .single()
  if (error || !data) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to create report subscription' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  return NextResponse.json(
    { subscription: data, emailSent: false, providerInvoked: false },
    { status: 201, headers: ctx.responseHeaders }
  )
}

export async function PATCH(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/reporting/subscriptions'
  )
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Valid subscription update is required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(parsed.data.websiteId, true)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const { data, error } = await auth.service
    .from('siteforge_report_subscriptions')
    .update({
      status: parsed.data.status,
      next_send_at:
        parsed.data.status === 'active' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.subscriptionId)
    .eq('org_id', auth.website.org_id)
    .eq('property_id', auth.website.property_id)
    .eq('website_id', auth.website.id)
    .select('*')
    .single()
  if (error || !data) {
    return NextResponse.json(
      { error: 'Report subscription not found' },
      { status: 404, headers: ctx.responseHeaders }
    )
  }
  return NextResponse.json(
    { subscription: data, emailSent: false, providerInvoked: false },
    { headers: ctx.responseHeaders }
  )
}
