import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'
import type { Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const rollbackRequestSchema = z.object({
  expectedCurrentArtifactId: z.string().uuid(),
  targetArtifactId: z.string().uuid(),
  targetContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  decisionReason: z.string().trim().min(10).max(2_000),
})

async function authenticateWebsite(
  websiteId: string,
  requireManager = false
) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Unauthorized', status: 401 } as const

  const service = createServiceClient()
  const { data: website, error } = await service
    .from('property_websites')
    .select('id, org_id, property_id, current_artifact_version_id')
    .eq('id', websiteId)
    .single()
  if (error || !website) {
    return { error: 'Website not found', status: 404 } as const
  }
  const access = await validatePropertyAccess(user.id, website.property_id)
  if (!access.authorized) return { error: 'Forbidden', status: 403 } as const

  if (requireManager) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['admin', 'manager'].includes(profile.role || '')) {
      return {
        error: 'Rollback permission required',
        status: 403,
      } as const
    }
  }
  return { user, website, service } as const
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/rollback/[websiteId]'
  )
  try {
    const { websiteId } = await params
    if (!z.string().uuid().safeParse(websiteId).success) {
      return NextResponse.json(
        { error: 'Invalid website identifier' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await authenticateWebsite(websiteId)
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: ctx.responseHeaders }
      )
    }
    const { data: history, error } = await auth.service
      .from('siteforge_blueprint_versions')
      .select(
        'id, version, content_hash, change_type, changes_summary, remote_verified_url, remote_verified_at'
      )
      .eq('website_id', websiteId)
      .neq('id', auth.website.current_artifact_version_id || '')
      .not('remote_verified_at', 'is', null)
      .order('version', { ascending: false })
      .limit(20)
    if (error) {
      throw new Error(`Failed to load rollback history: ${error.message}`)
    }
    const current = auth.website.current_artifact_version_id
      ? await auth.service
          .from('siteforge_blueprint_versions')
          .select('id, version, content_hash')
          .eq('id', auth.website.current_artifact_version_id)
          .single()
      : { data: null }
    const target = history?.[0]
    return NextResponse.json(
      {
        canRollback: Boolean(target),
        currentArtifact: current.data,
        rollbackToVersion: target?.version,
        rollbackToArtifactId: target?.id,
        rollbackToContentHash: target?.content_hash,
        history: history || [],
        message: target
          ? `Rollback will create a new immutable version from verified artifact v${target.version}.`
          : 'No previously verified artifact is available for rollback.',
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to load rollback preview' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(
    request,
    '/api/siteforge/rollback/[websiteId]'
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
    const parsed = rollbackRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid immutable rollback request' },
        { status: 400, headers: ctx.responseHeaders }
      )
    }
    const auth = await authenticateWebsite(websiteId, true)
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: ctx.responseHeaders }
      )
    }
    if (
      auth.website.current_artifact_version_id !==
      parsed.data.expectedCurrentArtifactId
    ) {
      return NextResponse.json(
        { error: 'Current artifact changed; reload rollback history' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const { data: target, error: targetError } = await auth.service
      .from('siteforge_blueprint_versions')
      .select(
        'id, version, blueprint, content_hash, quality_report, quality_score, remote_verified_at, remote_verification_report, asset_manifest_hash, base_theme_package_id, base_theme_package_sha256'
      )
      .eq('id', parsed.data.targetArtifactId)
      .eq('website_id', websiteId)
      .eq('content_hash', parsed.data.targetContentHash)
      .single()
    if (
      targetError ||
      !target ||
      !target.remote_verified_at ||
      !target.asset_manifest_hash ||
      !target.base_theme_package_id ||
      !target.base_theme_package_sha256
    ) {
      return NextResponse.json(
        {
          error:
            'Rollback target is not a verified remote artifact with an exact release package',
        },
        { status: 409, headers: ctx.responseHeaders }
      )
    }
    const remoteReport =
      target.remote_verification_report &&
      typeof target.remote_verification_report === 'object' &&
      !Array.isArray(target.remote_verification_report)
        ? target.remote_verification_report
        : null
    if (!remoteReport || remoteReport.passed !== true) {
      return NextResponse.json(
        { error: 'Rollback target lacks passing certification evidence' },
        { status: 409, headers: ctx.responseHeaders }
      )
    }

    const rollbackOperation = {
      targetArtifactId: target.id,
      targetVersion: target.version,
      certification: remoteReport,
    }
    const { data: revision, error: revisionError } = await auth.service.rpc(
      'publish_siteforge_artifact_revision',
      {
        p_website_id: websiteId,
        p_expected_artifact_id: parsed.data.expectedCurrentArtifactId,
        p_blueprint: target.blueprint,
        p_content_hash: target.content_hash,
        p_change_type: 'rollback',
        p_changes_summary: `Rollback copy of verified artifact v${target.version}`,
        p_edit_intent: parsed.data.decisionReason,
        p_patches_applied: rollbackOperation as unknown as Json,
        p_quality_report: target.quality_report,
        p_quality_score: target.quality_score ?? 100,
        p_created_by: auth.user.id,
        p_base_theme_package_id: target.base_theme_package_id,
        p_base_theme_package_sha256: target.base_theme_package_sha256,
        p_operation_set: [rollbackOperation] as unknown as Json,
        p_operation_set_hash: hashSiteForgeContent([rollbackOperation]),
      }
    )
    if (revisionError || !revision) {
      const conflict = revisionError?.message.includes('version conflict')
      return NextResponse.json(
        {
          error: conflict
            ? 'Current artifact changed; reload rollback history'
            : 'Failed to publish rollback artifact',
        },
        { status: conflict ? 409 : 500, headers: ctx.responseHeaders }
      )
    }
    await auth.service.from('mcp_audit_log').insert({
      platform: 'siteforge-rollback',
      tool_name: 'publish_verified_rollback_artifact',
      operation_type: 'siteforge_verified_rollback',
      property_id: auth.website.property_id,
      parameters: {
        websiteId,
        sourceArtifactId: target.id,
        rollbackArtifactId: revision.id,
        contentHash: revision.content_hash,
        reason: parsed.data.decisionReason,
      },
      success: true,
    })

    ctx.logSuccess(200, {
      websiteId,
      artifactId: revision.id,
      sourceArtifactId: target.id,
    })
    return NextResponse.json(
      {
        success: true,
        artifactId: revision.id,
        contentHash: revision.content_hash,
        newVersion: revision.version,
        rolledBackFromArtifactId: parsed.data.expectedCurrentArtifactId,
        rolledBackToArtifactId: target.id,
        requiresCanonicalPreview: true,
        requiresDeploymentApproval: true,
        message:
          'Verified rollback artifact created. Render its exact WordPress preview, approve it, then deploy to complete remote rollback.',
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error)
    return NextResponse.json(
      { error: 'Failed to create verified rollback artifact' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
