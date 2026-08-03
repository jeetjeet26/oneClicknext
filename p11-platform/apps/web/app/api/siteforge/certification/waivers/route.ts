import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  buildImmutableCertificationWaiver,
  certificationWaiverRequestSchema,
  CertificationWaiverError,
} from '@/utils/siteforge/verification/certification-waivers'

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/certification/waivers'
  )
  ctx.logStart()
  try {
    const parsed = certificationWaiverRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A valid rationale and future waiver expiry are required' },
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
    const access = await validatePropertyAccess(user.id, parsed.data.propertyId)
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (
      profileError ||
      !profile ||
      !['admin', 'manager'].includes(profile.role || '')
    ) {
      return NextResponse.json(
        { error: 'Certification waiver permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    const client = createServiceClient()
    const { data: website, error: websiteError } = await client
      .from('property_websites')
      .select('id, org_id, property_id')
      .eq('id', parsed.data.websiteId)
      .eq('property_id', parsed.data.propertyId)
      .single()
    if (websiteError || !website) {
      return NextResponse.json(
        { error: 'Website not found for property' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const { data: artifact, error: artifactError } = await client
      .from('siteforge_blueprint_versions')
      .select('id')
      .eq('id', parsed.data.artifactId)
      .eq('website_id', website.id)
      .eq('property_id', website.property_id)
      .eq('org_id', website.org_id)
      .single()
    if (artifactError || !artifact) {
      return NextResponse.json(
        { error: 'Artifact not found for website' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    const waiver = buildImmutableCertificationWaiver({
      orgId: website.org_id,
      approvedBy: user.id,
      request: parsed.data,
    })
    const { data: created, error: insertError } = await client
      .from('siteforge_certification_waivers')
      .insert(waiver)
      .select('id, check_code, policy_version, expires_at, created_at')
      .single()
    if (insertError || !created) {
      throw new Error(
        `Failed to persist certification waiver: ${
          insertError?.message || 'missing row'
        }`
      )
    }
    ctx.logSuccess(201, {
      waiverId: created.id,
      websiteId: website.id,
      artifactId: artifact.id,
      checkCode: created.check_code,
    })
    return NextResponse.json(
      { waiver: created },
      { status: 201, headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof CertificationWaiverError ? error.statusCode : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof CertificationWaiverError
            ? error.message
            : 'Failed to create certification waiver',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
