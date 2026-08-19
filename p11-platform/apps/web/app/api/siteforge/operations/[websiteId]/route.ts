import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { createRequestContext } from '@/utils/services/request-context'
import { authorizeSiteForgeWebsite } from '@/utils/siteforge/operations-auth'

const actionSchema = z.object({
  action: z.literal('request_restore'),
  rationale: z.string().trim().min(10).max(2_000),
})

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(request, '/api/siteforge/operations/[websiteId]')
  const { websiteId } = await params
  if (!z.string().uuid().safeParse(websiteId).success) {
    return NextResponse.json(
      { error: 'Invalid website identifier' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(websiteId)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const [
    website,
    releases,
    events,
    certifications,
    restores,
    rollbackHistory,
    productionTarget,
    productionProvisioningJob,
  ] = await Promise.all([
      auth.service
        .from('property_websites')
        .select(
          'id, property_id, editor_lifecycle_status, canonical_preview_url, canonical_preview_artifact_id, canonical_preview_content_hash, staging_artifact_id, staging_content_hash, staging_certified_at, production_artifact_id, production_content_hash, production_url, production_certified_at, production_certification_report, wordpress_credential_ref, production_target_id, target_domain, domain_status'
        )
        .eq('id', websiteId)
        .single(),
      auth.service
        .from('siteforge_launch_releases')
        .select('*')
        .eq('website_id', websiteId)
        .order('release_version', { ascending: false })
        .limit(20),
      auth.service
        .from('siteforge_launch_events')
        .select('*, siteforge_launch_releases!inner(website_id)')
        .eq('siteforge_launch_releases.website_id', websiteId)
        .order('created_at', { ascending: false })
        .limit(50),
      auth.service
        .from('siteforge_certification_evidence')
        .select('*')
        .eq('website_id', websiteId)
        .order('created_at', { ascending: false })
        .limit(20),
      auth.service
        .from('siteforge_restore_drills')
        .select('*')
        .eq('website_id', websiteId)
        .order('created_at', { ascending: false })
        .limit(20),
      auth.service
        .from('siteforge_blueprint_versions')
        .select('id, version, content_hash, change_type, changes_summary, created_at')
        .eq('website_id', websiteId)
        .eq('change_type', 'rollback')
        .order('created_at', { ascending: false })
        .limit(20),
      auth.service
        .from('siteforge_wordpress_targets')
        .select(
          'id, status, site_url, admin_url, dashboard_url, provider_application_id, provider_server_id, credential_ref'
        )
        .eq('website_id', websiteId)
        .eq('target_type', 'production')
        .eq('is_active', true)
        .maybeSingle(),
      auth.service
        .from('shared_jobs')
        .select(
          'id, lifecycle_status, stage, progress, current_step, error_message, workflow_run_id, updated_at'
        )
        .eq('org_id', auth.website.org_id)
        .eq('property_id', auth.website.property_id)
        .eq('domain', 'siteforge.production_provisioning')
        .eq('subject_type', 'siteforge_wordpress_target')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
  const error =
    website.error ||
    releases.error ||
    events.error ||
    certifications.error ||
    restores.error ||
    rollbackHistory.error ||
    productionTarget.error ||
    productionProvisioningJob.error
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  return NextResponse.json(
    {
      website: website.data,
      releases: releases.data || [],
      launchEvents: events.data || [],
      certifications: certifications.data || [],
      restores: restores.data || [],
      rollbackHistory: rollbackHistory.data || [],
      productionTarget: productionTarget.data || null,
      productionProvisioningJob: productionProvisioningJob.data || null,
      automaticProductionLaunch: true,
      browserCertifierConfigured: Boolean(
        process.env.SITEFORGE_BROWSER_CERTIFIER_URL &&
          process.env.SITEFORGE_BROWSER_CERTIFIER_SECRET
      ),
    },
    { headers: ctx.responseHeaders }
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ websiteId: string }> }
) {
  const ctx = createRequestContext(request, '/api/siteforge/operations/[websiteId]')
  const { websiteId } = await params
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(websiteId).success || !parsed.success) {
    return NextResponse.json(
      { error: 'Valid restore request and rationale are required' },
      { status: 400, headers: ctx.responseHeaders }
    )
  }
  const auth = await authorizeSiteForgeWebsite(websiteId, true)
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: ctx.responseHeaders }
    )
  }
  const { data: release } = await auth.service
    .from('siteforge_launch_releases')
    .select(
      'id, backup_id, rollback_artifact_id, rollback_content_hash, artifact_id, artifact_content_hash'
    )
    .eq('website_id', websiteId)
    .in('state', ['promoted', 'production_certified', 'live', 'failed'])
    .order('release_version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!release?.backup_id) {
    return NextResponse.json(
      { error: 'No launch backup is available for a supervised restore request' },
      { status: 409, headers: ctx.responseHeaders }
    )
  }
  const { data: pending } = await auth.service
    .from('siteforge_restore_drills')
    .select('*')
    .eq('website_id', websiteId)
    .in('status', ['queued', 'restoring', 'verifying'])
    .maybeSingle()
  if (pending) {
    return NextResponse.json(
      { restore: pending, duplicate: true },
      { headers: ctx.responseHeaders }
    )
  }
  const { data: restore, error } = await auth.service
    .from('siteforge_restore_drills')
    .insert({
      org_id: auth.website.org_id,
      property_id: auth.website.property_id,
      website_id: websiteId,
      release_id: release.id,
      backup_id: release.backup_id,
      expected_artifact_id: release.rollback_artifact_id || release.artifact_id,
      expected_content_hash:
        release.rollback_content_hash || release.artifact_content_hash,
      status: 'queued',
      verification_report: {
        requestType: 'operator_supervised_restore_request',
        requestedBy: auth.user.id,
        rationale: parsed.data.rationale,
        executionRequiresOperator: true,
      } as Json,
    })
    .select('*')
    .single()
  if (error || !restore) {
    return NextResponse.json(
      { error: error?.message || 'Failed to request restore' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
  return NextResponse.json(
    { restore, executionRequiresOperator: true },
    { status: 202, headers: ctx.responseHeaders }
  )
}
