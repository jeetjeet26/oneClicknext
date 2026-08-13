import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import {
  decideMigrationManifest,
  recordMigrationImported,
  recordPostLaunchCrawlVerification,
  SiteForgeMigrationError,
} from '@/utils/siteforge/migration/repository'
import { postLaunchVerificationInputSchema } from '@/utils/siteforge/migration/contracts'
import { SharedApprovalError } from '@/utils/services/shared-approvals'

const commandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('decide'),
      propertyId: z.guid(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      decisionStatus: z.enum(['approved', 'denied']),
      decisionReason: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      action: z.literal('mark_imported'),
      propertyId: z.guid(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('record_post_launch_crawl'),
      propertyId: z.guid(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      verification: postLaunchVerificationInputSchema,
    })
    .strict(),
])

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ websiteId: string; manifestId: string }>
  }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/migration/[websiteId]/[manifestId]'
  )
  ctx.logStart()
  try {
    const { websiteId, manifestId } = await params
    if (
      !z.string().uuid().safeParse(websiteId).success ||
      !z.string().uuid().safeParse(manifestId).success
    ) {
      return NextResponse.json(
        { error: 'Invalid migration identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const parsed = commandSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid migration command' },
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
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return NextResponse.json(
        { error: 'Migration approval permission required' },
        { status: 403, headers: ctx.responseHeaders }
      )
    }

    let result
    if (parsed.data.action === 'decide') {
      result = await decideMigrationManifest({
        manifestId,
        websiteId,
        propertyId: parsed.data.propertyId,
        reviewerProfileId: user.id,
        contentHash: parsed.data.contentHash,
        decisionStatus: parsed.data.decisionStatus,
        decisionReason: parsed.data.decisionReason,
      })
    } else if (parsed.data.action === 'mark_imported') {
      result = await recordMigrationImported({
        manifestId,
        websiteId,
        propertyId: parsed.data.propertyId,
        contentHash: parsed.data.contentHash,
      })
    } else {
      result = await recordPostLaunchCrawlVerification({
        manifestId,
        websiteId,
        propertyId: parsed.data.propertyId,
        contentHash: parsed.data.contentHash,
        verification: parsed.data.verification,
      })
    }
    ctx.logSuccess(200, {
      websiteId,
      manifestId,
      action: parsed.data.action,
    })
    return NextResponse.json(
      { success: true, manifest: result },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    const status =
      error instanceof SiteForgeMigrationError ||
      error instanceof SharedApprovalError
        ? error.statusCode
        : 500
    ctx.logError(status, error)
    return NextResponse.json(
      {
        error:
          error instanceof SiteForgeMigrationError ||
          error instanceof SharedApprovalError
            ? error.message
            : 'Failed to execute migration command',
      },
      { status, headers: ctx.responseHeaders }
    )
  }
}
