import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  validatePropertyAccess,
  validatePropertyManagerAccess,
} from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'

const propertySchema = z.guid()
const legalDocumentSchema = z.object({
  text: z.string().min(1).max(100_000),
  sourceUrl: z.string().url().optional(),
  reviewedAt: z.string().datetime().optional(),
})
const saveSchema = z.object({
  propertyId: propertySchema,
  jurisdiction: z.string().min(2).max(200),
  legalEntityName: z.string().min(2).max(300),
  effectiveAt: z.string().datetime(),
  approve: z.boolean().default(false),
  privacyPolicy: legalDocumentSchema,
  terms: legalDocumentSchema,
  accessibility: legalDocumentSchema,
  fairHousing: legalDocumentSchema,
  pricingDisclaimer: legalDocumentSchema,
  analyticsConsent: legalDocumentSchema,
  communicationsConsent: legalDocumentSchema,
  sourceReferences: z.array(z.object({
    sourceType: z.string().min(1),
    sourceId: z.string().optional(),
    sourceUrl: z.string().url().optional(),
  })).default([]),
})

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/onboarding/legal')
  ctx.logStart()
  const propertyId = request.nextUrl.searchParams.get('propertyId')
  const parsed = propertySchema.safeParse(propertyId)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid property ID' }, { status: 400, headers: ctx.responseHeaders })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const access = await validatePropertyAccess(user.id, parsed.data)
  if (!access.authorized) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })

  const service = createServiceClient()
  const { data, error } = await service
    .from('property_legal_configs')
    .select('*')
    .eq('property_id', parsed.data)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    ctx.logError(500, error)
    return NextResponse.json({ error: 'Could not load legal configuration' }, { status: 500, headers: ctx.responseHeaders })
  }
  ctx.logSuccess(200, { legalConfigId: data?.id || null })
  return NextResponse.json({ legalConfig: data }, { headers: ctx.responseHeaders })
}

export async function PUT(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/onboarding/legal')
  ctx.logStart()
  const parsed = saveSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid legal configuration', details: parsed.error.flatten() }, { status: 400, headers: ctx.responseHeaders })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: ctx.responseHeaders })
  const access = await validatePropertyManagerAccess(user.id, parsed.data.propertyId)
  if (!access.authorized || !access.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: ctx.responseHeaders })
  }

  const service = createServiceClient()
  const { data: latest } = await service
    .from('property_legal_configs')
    .select('version')
    .eq('property_id', parsed.data.propertyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const now = new Date().toISOString()
  const { data: legalConfig, error } = await service
    .from('property_legal_configs')
    .insert({
      org_id: access.orgId,
      property_id: parsed.data.propertyId,
      version: (latest?.version || 0) + 1,
      status: parsed.data.approve ? 'approved' : 'draft',
      jurisdiction: parsed.data.jurisdiction,
      legal_entity_name: parsed.data.legalEntityName,
      privacy_policy: parsed.data.privacyPolicy,
      terms: parsed.data.terms,
      accessibility: parsed.data.accessibility,
      fair_housing: parsed.data.fairHousing,
      pricing_disclaimer: parsed.data.pricingDisclaimer,
      analytics_consent: parsed.data.analyticsConsent,
      communications_consent: parsed.data.communicationsConsent,
      source_references: parsed.data.sourceReferences,
      effective_at: parsed.data.effectiveAt,
      approved_by: parsed.data.approve ? user.id : null,
      approved_at: parsed.data.approve ? now : null,
    })
    .select('*')
    .single()
  if (error || !legalConfig) {
    ctx.logError(500, error)
    return NextResponse.json({ error: 'Could not save legal configuration' }, { status: 500, headers: ctx.responseHeaders })
  }
  if (parsed.data.approve) {
    await service
      .from('property_legal_configs')
      .update({ status: 'superseded' })
      .eq('property_id', parsed.data.propertyId)
      .eq('status', 'approved')
      .neq('id', legalConfig.id)
  }
  ctx.logSuccess(200, { legalConfigId: legalConfig.id, status: legalConfig.status })
  return NextResponse.json({ legalConfig }, { headers: ctx.responseHeaders })
}
