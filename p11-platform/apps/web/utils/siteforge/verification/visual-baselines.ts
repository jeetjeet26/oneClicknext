import { createHash, randomUUID } from 'node:crypto'
import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { proposeSharedAction } from '@/utils/services/shared-executor'
import {
  recordSharedApprovalDecision,
  SharedApprovalError,
} from '@/utils/services/shared-approvals'
import { SITEFORGE_CERTIFICATION_POLICY_VERSION } from './browser-evidence'
import type {
  ApprovedBrowserBaseline,
  LighthouseReportArtifact,
} from './browserbase-certifier'
import type { BrowserCertificationEvidence } from './browser-evidence'
import type { CertificationArtifactBinding } from './certification-binding'

type ServiceClient = ReturnType<typeof createServiceClient>

export type CertificationTenantIdentity = {
  orgId: string
  propertyId: string
  websiteId: string
}

export class VisualBaselineError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'VisualBaselineError'
  }
}

function normalizedUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function loadExactApprovedVisualBaselines(
  input: CertificationTenantIdentity & {
    artifact: CertificationArtifactBinding
    expectedUrls: string[]
    environment: 'protected_preview' | 'staging' | 'production'
    access: 'protected' | 'public'
    requireIndexable: boolean
    bindingHash: string
  },
  client: ServiceClient = createServiceClient()
): Promise<ApprovedBrowserBaseline[]> {
  const pageHashes = input.expectedUrls.map(url => sha256(normalizedUrl(url)))
  const { data, error } = await client
    .from('siteforge_visual_baselines')
    .select(
      'id, artifact_id, artifact_content_hash, page_url, viewport, environment, access_mode, require_indexable, policy_version, binding_hash, evidence_digest, screenshot_storage_path, screenshot_sha256, approval_id, approved_at, approved_by'
    )
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .eq('website_id', input.websiteId)
    .eq('artifact_id', input.artifact.artifactId)
    .eq('artifact_content_hash', input.artifact.contentHash)
    .eq('environment', input.environment)
    .eq('access_mode', input.access)
    .eq('require_indexable', input.requireIndexable)
    .eq('policy_version', SITEFORGE_CERTIFICATION_POLICY_VERSION)
    .eq('binding_hash', input.bindingHash)
    .eq('status', 'approved')
    .in('page_url_sha256', pageHashes)

  if (error) {
    throw new Error(`Failed to load approved visual baselines: ${error.message}`)
  }
  return (data || []).map(row => {
    if (!row.approval_id || !row.approved_at || !row.approved_by) {
      throw new Error('Approved visual baseline has incomplete approval identity')
    }
    return {
      baselineId: row.id,
      url: row.page_url,
      viewport: row.viewport as 'desktop' | 'tablet' | 'mobile',
      storagePath: row.screenshot_storage_path,
      sha256: row.screenshot_sha256,
      artifact: {
        artifactId: row.artifact_id,
        contentHash: row.artifact_content_hash,
      },
      environment: row.environment as
        | 'protected_preview'
        | 'staging'
        | 'production',
      access: row.access_mode as 'protected' | 'public',
      requireIndexable: row.require_indexable,
      policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
      bindingHash: row.binding_hash,
      evidenceDigest: row.evidence_digest,
      approvalId: row.approval_id,
      approvedAt: row.approved_at,
      approvedBy: row.approved_by,
    }
  })
}

export async function persistVisualBaselineCandidates(
  input: CertificationTenantIdentity & {
    artifact: CertificationArtifactBinding
    environment: 'protected_preview' | 'staging' | 'production'
    access: 'protected' | 'public'
    requireIndexable: boolean
    bindingHash: string
    evidence: BrowserCertificationEvidence
  },
  client: ServiceClient = createServiceClient()
): Promise<string[]> {
  const candidateIds: string[] = []
  for (const screenshot of input.evidence.screenshots) {
    const pageUrl = normalizedUrl(screenshot.url)
    const pageUrlSha256 = sha256(pageUrl)
    const { data: existing, error: existingError } = await client
      .from('siteforge_visual_baselines')
      .select('id')
      .eq('artifact_id', input.artifact.artifactId)
      .eq('artifact_content_hash', input.artifact.contentHash)
      .eq('page_url_sha256', pageUrlSha256)
      .eq('viewport', screenshot.viewport)
      .eq('environment', input.environment)
      .eq('access_mode', input.access)
      .eq('require_indexable', input.requireIndexable)
      .eq('policy_version', SITEFORGE_CERTIFICATION_POLICY_VERSION)
      .eq('screenshot_sha256', screenshot.sha256)
      .eq('binding_hash', input.bindingHash)
      .maybeSingle()
    if (existingError) {
      throw new Error(
        `Failed to inspect visual baseline candidate: ${existingError.message}`
      )
    }
    if (existing) {
      candidateIds.push(existing.id)
      continue
    }

    const baselineId = randomUUID()
    const proposal = await proposeSharedAction({
      orgId: input.orgId,
      propertyId: input.propertyId,
      domain: 'siteforge.certification',
      subjectType: 'siteforge_visual_baseline',
      subjectId: baselineId,
      dedupeKey: `siteforge-visual-baseline:${screenshot.identityDigest}`,
      capturedBy: 'browser-certifier',
      requestedBy: null,
      payload: {
        baselineId,
        websiteId: input.websiteId,
        artifactId: input.artifact.artifactId,
        contentHash: input.artifact.contentHash,
        pageUrl,
        viewport: screenshot.viewport,
        environment: input.environment,
        access: input.access,
        bindingHash: input.bindingHash,
        screenshotSha256: screenshot.sha256,
        evidenceDigest: screenshot.identityDigest,
      },
      action: {
        actionType: 'siteforge.certification:approve_visual_baseline',
        requestPayload: {
          baselineId,
          screenshotStoragePath: screenshot.storagePath,
          screenshotSha256: screenshot.sha256,
          evidenceDigest: screenshot.identityDigest,
          bindingHash: input.bindingHash,
        },
        executionPayload: { baselineId },
        policyReason:
          'An independent manager must approve this exact policy-v4 screenshot identity before it can be used as a visual baseline.',
        confidenceScore: 1,
      },
    })
    const { error: insertError } = await client
      .from('siteforge_visual_baselines')
      .insert({
        id: baselineId,
        org_id: input.orgId,
        property_id: input.propertyId,
        website_id: input.websiteId,
        artifact_id: input.artifact.artifactId,
        artifact_content_hash: input.artifact.contentHash,
        runtime_package_sha256: input.artifact.runtimePackageSha256,
        runtime_manifest_sha256: input.artifact.runtimeManifestSha256,
        overlay_package_sha256: input.artifact.overlayPackageSha256,
        asset_manifest_hash: input.artifact.assetManifestHash,
        operation_set_hash: input.artifact.operationSetHash,
        page_url: pageUrl,
        page_url_sha256: pageUrlSha256,
        viewport: screenshot.viewport,
        viewport_width: screenshot.width,
        viewport_height: screenshot.height,
        environment: input.environment,
        access_mode: input.access,
        require_indexable: input.requireIndexable,
        policy_version: SITEFORGE_CERTIFICATION_POLICY_VERSION,
        binding_hash: input.bindingHash,
        evidence_digest: screenshot.identityDigest,
        screenshot_storage_path: screenshot.storagePath,
        screenshot_sha256: screenshot.sha256,
        screenshot_bytes: screenshot.bytes,
        screenshot_content_type: screenshot.contentType,
        captured_session_id: input.evidence.identity.sessionId,
        captured_at: input.evidence.capturedAt,
        status: 'candidate',
        approval_action_attempt_id: proposal.sharedActionAttemptId,
      })
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: concurrent, error: concurrentError } = await client
          .from('siteforge_visual_baselines')
          .select('id')
          .eq('artifact_id', input.artifact.artifactId)
          .eq('artifact_content_hash', input.artifact.contentHash)
          .eq('page_url_sha256', pageUrlSha256)
          .eq('viewport', screenshot.viewport)
          .eq('environment', input.environment)
          .eq('access_mode', input.access)
          .eq('require_indexable', input.requireIndexable)
          .eq('policy_version', SITEFORGE_CERTIFICATION_POLICY_VERSION)
          .eq('screenshot_sha256', screenshot.sha256)
          .eq('binding_hash', input.bindingHash)
          .maybeSingle()
        if (concurrentError) {
          throw new Error(
            `Failed to inspect concurrent visual baseline candidate: ${concurrentError.message}`
          )
        }
        if (concurrent) {
          candidateIds.push(concurrent.id)
          continue
        }
      }
      throw new Error(
        `Failed to persist visual baseline candidate: ${insertError.message}`
      )
    }
    candidateIds.push(baselineId)
  }
  return candidateIds
}

export async function persistLighthouseEvidence(
  input: CertificationTenantIdentity & {
    artifact: CertificationArtifactBinding
    environment: 'staging' | 'production'
    access: 'protected' | 'public'
    bindingHash: string
    reports: LighthouseReportArtifact[]
  },
  client: ServiceClient = createServiceClient()
): Promise<void> {
  if (!input.reports.length) {
    throw new Error('External Lighthouse evidence is required')
  }
  const { error } = await client.from('siteforge_lighthouse_evidence').insert(
    input.reports.map(report => ({
      org_id: input.orgId,
      property_id: input.propertyId,
      website_id: input.websiteId,
      artifact_id: input.artifact.artifactId,
      artifact_content_hash: input.artifact.contentHash,
      page_url: normalizedUrl(report.url),
      page_url_sha256: sha256(normalizedUrl(report.url)),
      environment: input.environment,
      access_mode: input.access,
      policy_version: SITEFORGE_CERTIFICATION_POLICY_VERSION,
      binding_hash: input.bindingHash,
      provider: report.provider,
      provider_run_id: report.providerRunId,
      form_factor: report.formFactor,
      report_storage_path: report.storagePath,
      report_sha256: report.sha256,
      runner_binary_sha256: report.runnerBinarySha256,
      runner_config_sha256: report.runnerConfigSha256,
      tool_manifest_sha256: report.toolManifestSha256,
      generated_at: report.generatedAt,
    }))
  )
  if (error && error.code !== '23505') {
    throw new Error(`Failed to persist Lighthouse evidence: ${error.message}`)
  }
}

async function loadBaselineForDecision(
  baselineId: string,
  propertyId: string,
  client: ServiceClient
) {
  const { data, error } = await client
    .from('siteforge_visual_baselines')
    .select(
      'id, org_id, property_id, website_id, artifact_id, artifact_content_hash, status, approval_action_attempt_id, binding_hash, evidence_digest, screenshot_sha256'
    )
    .eq('id', baselineId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) {
    throw new VisualBaselineError('Visual baseline not found', 404)
  }
  return data
}

export async function decideVisualBaseline(
  input: {
    baselineId: string
    propertyId: string
    reviewerProfileId: string
    operation: 'approve' | 'deny' | 'revoke'
    reason: string
  },
  client: ServiceClient = createServiceClient()
) {
  const baseline = await loadBaselineForDecision(
    input.baselineId,
    input.propertyId,
    client
  )
  if (
    (input.operation === 'approve' || input.operation === 'deny') &&
    baseline.status !== 'candidate'
  ) {
    throw new VisualBaselineError(
      'Only a candidate visual baseline can be approved or denied',
      409
    )
  }
  if (input.operation === 'revoke' && baseline.status !== 'approved') {
    throw new VisualBaselineError(
      'Only an approved visual baseline can be revoked',
      409
    )
  }

  let actionAttemptId = baseline.approval_action_attempt_id
  if (input.operation === 'revoke') {
    const proposal = await proposeSharedAction({
      orgId: baseline.org_id,
      propertyId: baseline.property_id,
      domain: 'siteforge.certification',
      subjectType: 'siteforge_visual_baseline_revocation',
      subjectId: baseline.id,
      dedupeKey: `siteforge-visual-baseline-revoke:${baseline.id}:${baseline.evidence_digest}`,
      capturedBy: 'system',
      requestedBy: null,
      payload: {
        baselineId: baseline.id,
        artifactId: baseline.artifact_id,
        contentHash: baseline.artifact_content_hash,
        bindingHash: baseline.binding_hash,
        evidenceDigest: baseline.evidence_digest,
        reason: input.reason,
      },
      action: {
        actionType: 'siteforge.certification:revoke_visual_baseline',
        requestPayload: {
          baselineId: baseline.id,
          screenshotSha256: baseline.screenshot_sha256,
          reason: input.reason,
        },
        executionPayload: { baselineId: baseline.id },
        policyReason:
          'Revoking an approved visual baseline requires an explicit manager decision.',
        confidenceScore: 1,
      },
    })
    actionAttemptId = proposal.sharedActionAttemptId
  }
  if (!actionAttemptId) {
    throw new VisualBaselineError(
      'Visual baseline approval linkage is missing',
      409
    )
  }

  const decisionStatus =
    input.operation === 'deny' ? ('denied' as const) : ('approved' as const)
  const decision = await recordSharedApprovalDecision(
    {
      propertyId: input.propertyId,
      actionAttemptId,
      reviewerProfileId: input.reviewerProfileId,
      decisionStatus,
      decisionReason: input.reason,
      decisionPayload: {
        baselineId: baseline.id,
        operation: input.operation,
        artifactId: baseline.artifact_id,
        contentHash: baseline.artifact_content_hash,
        bindingHash: baseline.binding_hash,
        evidenceDigest: baseline.evidence_digest,
      },
      policyDecision: {
        policyName: 'siteforge-visual-baseline',
        policyVersion: 'v4',
        confidenceScore: 1,
        decisionPayload: {
          baselineId: baseline.id,
          operation: input.operation,
          screenshotSha256: baseline.screenshot_sha256,
        },
      },
    },
    client
  )

  const rpc =
    input.operation === 'approve'
      ? client.rpc('approve_siteforge_visual_baseline', {
          p_baseline_id: baseline.id,
          p_action_attempt_id: actionAttemptId,
          p_approval_id: decision.approval.id,
          p_reviewer_profile_id: input.reviewerProfileId,
        })
      : client.rpc('revoke_siteforge_visual_baseline', {
          p_baseline_id: baseline.id,
          p_action_attempt_id: actionAttemptId,
          p_approval_id: decision.approval.id,
          p_reviewer_profile_id: input.reviewerProfileId,
          p_reason: input.reason,
        })
  const { data: transitioned, error: transitionError } = await rpc
  if (transitionError || !transitioned) {
    throw new SharedApprovalError(
      `Visual baseline decision was recorded but the lifecycle transition failed: ${
        transitionError?.message || 'missing row'
      }`,
      500
    )
  }
  return transitioned as Json
}
