// Temporary Aurora-only operator tool: performs the Cloudways actions the
// SiteForge launch flow asks the operator to complete manually (production
// backup, staging push-to-live) using the server-side Cloudways credentials,
// and returns the operation identities to submit back through the product.
// Gated by a dedicated one-time secret plus manager auth, restricted to the
// disposable Aurora testbed. Remove after the lifecycle proof.
import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyManagerAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import { CloudwaysProviderClient } from '@/utils/siteforge/providers/cloudways-provider'
import { assertNotAcaciaIdentity } from '@/utils/siteforge/testing/aurora-lifecycle-control'

export const maxDuration = 300

const requestSchema = z
  .object({
    propertyId: z.guid(),
    websiteId: z.string().uuid(),
    action: z.enum(['take_backup', 'push_staging']),
  })
  .strict()

export function operatorToolSecretMatches(
  provided: string | null,
  expected: string | undefined
): boolean {
  if (!expected || expected.length < 32 || !provided) return false
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  )
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(
    request,
    '/api/test-only/siteforge/aurora-lifecycle/operator-cloudways'
  )
  ctx.logStart()
  try {
    if (
      !operatorToolSecretMatches(
        request.headers.get('x-aurora-operator-tool-secret'),
        process.env.SITEFORGE_AURORA_OPERATOR_TOOL_SECRET
      )
    ) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }
    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Exact Aurora operator action identity is required' },
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
    const access = await validatePropertyManagerAccess(
      user.id,
      parsed.data.propertyId
    )
    if (!access.authorized) {
      return NextResponse.json(
        { error: 'Manager permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }
    const client = createServiceClient()
    const { data: property } = await client
      .from('properties')
      .select('name')
      .eq('id', parsed.data.propertyId)
      .single()
    assertNotAcaciaIdentity({ propertyName: property?.name || '' })

    const apiKey = process.env.CLOUDWAYS_API_KEY?.trim()
    const email = process.env.CLOUDWAYS_EMAIL?.trim()
    if (!apiKey || !email) {
      return NextResponse.json(
        { error: 'Cloudways API credentials are required' },
        { status: 503, headers: ctx.responseHeaders }
      )
    }
    const { data: staging, error: stagingError } = await client
      .from('siteforge_wordpress_targets')
      .select(
        'provider, provider_application_id, provider_parent_application_id, provider_server_id'
      )
      .eq('website_id', parsed.data.websiteId)
      .eq('target_type', 'staging')
      .eq('is_active', true)
      .single()
    if (
      stagingError ||
      staging?.provider !== 'cloudways' ||
      !staging.provider_application_id ||
      !staging.provider_parent_application_id ||
      !staging.provider_server_id
    ) {
      return NextResponse.json(
        { error: 'Exact Cloudways staging/production identity is required' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const provider = new CloudwaysProviderClient({ apiKey, email })
    if (parsed.data.action === 'take_backup') {
      const started = await provider.createApplicationBackup({
        serverId: staging.provider_server_id,
        applicationId: staging.provider_parent_application_id,
      })
      if (!started.operationId) {
        throw new Error('Cloudways did not return a backup operation identity')
      }
      await provider.waitForOperation(started.operationId)
      const backupId = await provider.getLatestRestorePoint({
        serverId: staging.provider_server_id,
        applicationId: staging.provider_parent_application_id,
      })
      if (!backupId) {
        throw new Error(
          'Cloudways did not reveal the restore point for the completed backup'
        )
      }
      ctx.logSuccess(200, { action: parsed.data.action })
      return NextResponse.json(
        { operationId: started.operationId, backupId },
        { headers: ctx.responseHeaders }
      )
    }
    const started = await provider.promoteStagingApplication({
      serverId: staging.provider_server_id,
      stagingApplicationId: staging.provider_application_id,
      productionApplicationId: staging.provider_parent_application_id,
    })
    if (!started.operationId) {
      throw new Error('Cloudways did not return a promotion operation identity')
    }
    await provider.waitForOperation(started.operationId)
    ctx.logSuccess(200, { action: parsed.data.action })
    return NextResponse.json(
      { operationId: started.operationId },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: (error as Error).message || 'Aurora operator action failed' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
