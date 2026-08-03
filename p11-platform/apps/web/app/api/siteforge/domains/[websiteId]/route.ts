import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'

const requestSchema = z.object({
  targetDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/),
})

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
    if (
      website.domain_status === 'attached' &&
      website.target_domain !== parsed.data.targetDomain
    ) {
      return NextResponse.json(
        {
          error:
            'Attached production domains require a separate audited migration',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { error: updateError } = await service
      .from('property_websites')
      .update({
        target_domain: parsed.data.targetDomain,
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
      targetDomain: parsed.data.targetDomain,
    })
    return NextResponse.json(
      {
        success: true,
        targetDomain: parsed.data.targetDomain,
        message:
          'Domain saved. DNS and SSL will attach only after temporary URL certification passes.',
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to configure production domain' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
