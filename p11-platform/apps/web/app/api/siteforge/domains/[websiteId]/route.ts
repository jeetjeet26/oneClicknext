import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  captureDomainDnsInventory,
  resolveDnsHostPolicy,
} from '@/utils/siteforge/launch/dns-cutover'
import { SiteForgeLaunchError } from '@/utils/siteforge/launch/repository'

const requestSchema = z.object({
  targetDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/),
  apexWwwPolicy: z.enum(['apex', 'www', 'custom']),
}).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/domains/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    if (!z.string().uuid().safeParse(websiteId).success) {
      return NextResponse.json(
        { error: 'Invalid website identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid production domain' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const service = createServiceClient()
    const { data: website, error: websiteError } = await service
      .from('property_websites')
      .select('id, property_id, target_domain, domain_status')
      .eq('id', websiteId)
      .single()
    if (websiteError || !website) {
      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json(
        { error: 'Domain configuration permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const domainPolicy = resolveDnsHostPolicy(
      parsed.data.targetDomain,
      parsed.data.apexWwwPolicy
    )
    if (
      website.domain_status === 'attached' &&
      website.target_domain !== domainPolicy.canonicalHostname
    ) {
      return NextResponse.json(
        {
          error:
            'Attached production domains require a separate audited migration',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const dnsInventory = await captureDomainDnsInventory(
      {
        websiteId,
        propertyId: website.property_id,
        targetDomain: domainPolicy.canonicalHostname,
        apexWwwPolicy: domainPolicy.policy,
        actorId: user.id,
      },
      service
    )
    const { error: updateError } = await service
      .from('property_websites')
      .update({
        target_domain: domainPolicy.canonicalHostname,
        domain_status: 'not_configured',
        ssl_status: 'not_configured',
        dns_record_id: null,
        domain_configured_at: null,
      })
      .eq('id', websiteId)
    if (updateError) {
      throw new Error(`Failed to store target domain: ${updateError.message}`)
    }
    ctx.logSuccess(200, {
      websiteId,
      targetDomain: domainPolicy.canonicalHostname,
      dnsSnapshotId: dnsInventory.snapshot.id,
    })
    return NextResponse.json(
      {
        success: true,
        targetDomain: domainPolicy.canonicalHostname,
        apexWwwPolicy: domainPolicy.policy,
        hostnames: domainPolicy.hostnames,
        dnsSnapshotId: dnsInventory.snapshot.id,
        ownershipVerified: true,
        ttlLoweringIntent: true,
        message:
          'Domain inventory and rollback manifest saved. DNS and SSL mutate only during the supervised cutover.',
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status = error instanceof SiteForgeLaunchError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Failed to configure production domain'
            : (error as Error).message,
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/domains/[websiteId]'
  )
  ctx.logStart()
  try {
    const { websiteId } = await params
    if (!z.string().uuid().safeParse(websiteId).success) {
      return NextResponse.json(
        { error: 'Invalid website identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: ctx.responseHeaders }
      )
    }
    const service = createServiceClient()
    const { data: website, error: websiteError } = await service
      .from('property_websites')
      .select(
        'id, property_id, target_domain, domain_status, ssl_status, dns_record_id'
      )
      .eq('id', websiteId)
      .single()
    if (websiteError || !website) {
      return NextResponse.json(
        { error: 'Website not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const access = await validatePropertyAccess(user.id, website.property_id)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const { data: snapshots, error: snapshotsError } = await service
      .from('siteforge_dns_snapshots')
      .select('*')
      .eq('website_id', websiteId)
      .eq('property_id', website.property_id)
      .order('captured_at', { ascending: false })
      .limit(20)
    if (snapshotsError) {
      throw new Error(`Failed to load DNS snapshots: ${snapshotsError.message}`)
    }
    ctx.logSuccess(200, { websiteId, snapshots: snapshots?.length || 0 })
    return NextResponse.json(
      { website, snapshots: snapshots || [] },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to load production domain state' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
