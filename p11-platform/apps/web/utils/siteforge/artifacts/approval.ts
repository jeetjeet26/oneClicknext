import { createServiceClient } from '@/utils/supabase/admin'
import { proposeSharedAction } from '@/utils/services/shared-executor'
import { recordSharedApprovalDecision } from '@/utils/services/shared-approvals'

type ServiceClient = ReturnType<typeof createServiceClient>

export class SiteForgeArtifactApprovalError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeArtifactApprovalError'
  }
}

export async function loadDeployableArtifact(
  artifactId: string,
  propertyId: string,
  supabase: ServiceClient
) {
  const { data: artifact, error } = await supabase
    .from('siteforge_blueprint_versions')
    .select(
      'id, website_id, org_id, property_id, version, content_hash, quality_report, approval_action_attempt_id, deployment_decision'
    )
    .eq('id', artifactId)
    .eq('property_id', propertyId)
    .single()
  if (error || !artifact) {
    throw new SiteForgeArtifactApprovalError('SiteForge artifact not found', 404)
  }

  const deterministic =
    artifact.quality_report &&
    typeof artifact.quality_report === 'object' &&
    !Array.isArray(artifact.quality_report)
      ? artifact.quality_report.deterministic
      : null
  if (
    !deterministic ||
    typeof deterministic !== 'object' ||
    Array.isArray(deterministic) ||
    deterministic.passed !== true
  ) {
    throw new SiteForgeArtifactApprovalError(
      'Artifact has not passed deterministic quality gates',
      409
    )
  }

  const { data: website, error: websiteError } = await supabase
    .from('property_websites')
    .select(
      'id, current_artifact_version_id, canonical_preview_artifact_id, canonical_preview_content_hash, canonical_preview_url'
    )
    .eq('id', artifact.website_id)
    .eq('property_id', propertyId)
    .single()
  if (websiteError || !website) {
    throw new SiteForgeArtifactApprovalError('Artifact website not found', 404)
  }
  if (
    website.current_artifact_version_id !== artifact.id ||
    website.canonical_preview_artifact_id !== artifact.id ||
    website.canonical_preview_content_hash !== artifact.content_hash ||
    !website.canonical_preview_url
  ) {
    throw new SiteForgeArtifactApprovalError(
      'Render this exact artifact in canonical WordPress preview before approval',
      409
    )
  }
  const { data: certification, error: certificationError } = await supabase
    .from('siteforge_certification_evidence')
    .select('id, policy_version, status, report_hash, report, created_at')
    .eq('org_id', artifact.org_id)
    .eq('property_id', propertyId)
    .eq('website_id', artifact.website_id)
    .eq('artifact_id', artifact.id)
    .eq('environment', 'preview')
    .eq('status', 'passed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const report =
    certification?.report &&
    typeof certification.report === 'object' &&
    !Array.isArray(certification.report)
      ? certification.report
      : null
  if (
    certificationError ||
    !certification ||
    !report ||
    report.passed !== true ||
    report.artifactId !== artifact.id ||
    report.contentHash !== artifact.content_hash
  ) {
    throw new SiteForgeArtifactApprovalError(
      'This exact canonical preview must pass persisted browser certification before approval',
      409
    )
  }
  return { artifact, website, certification }
}

async function ensureDeployProposal(
  artifactId: string,
  propertyId: string,
  requestedBy: string,
  supabase: ServiceClient
) {
  const current = await loadDeployableArtifact(artifactId, propertyId, supabase)
  if (current.artifact.approval_action_attempt_id) {
    const { data: existing } = await supabase
      .from('shared_action_attempts')
      .select('id, proposal_decision_status')
      .eq('id', current.artifact.approval_action_attempt_id)
      .maybeSingle()
    if (existing?.proposal_decision_status === 'proposed') {
      return { ...current, actionAttemptId: existing.id }
    }
  }

  const proposal = await proposeSharedAction({
    orgId: current.artifact.org_id,
    propertyId,
    domain: 'siteforge',
    subjectType: 'artifact_deployment',
    subjectId: artifactId,
    dedupeKey: `siteforge-deploy:${artifactId}:${current.artifact.content_hash}`,
    requestedBy,
    capturedBy: requestedBy,
    payload: {
      artifactId,
      websiteId: current.artifact.website_id,
      artifactVersion: current.artifact.version,
      contentHash: current.artifact.content_hash,
      canonicalPreviewUrl: current.website.canonical_preview_url,
      qualityReport: current.artifact.quality_report,
      previewCertificationId: current.certification.id,
      previewCertificationReportHash: current.certification.report_hash,
    },
    action: {
      actionType: 'siteforge.artifact:deploy_staging',
      requestPayload: {
        artifactId,
        contentHash: current.artifact.content_hash,
        previewCertificationId: current.certification.id,
        previewCertificationReportHash: current.certification.report_hash,
      },
      executionPayload: {
        websiteId: current.artifact.website_id,
        artifactId,
        contentHash: current.artifact.content_hash,
      },
      policyReason:
        'Explicit approval of the exact canonical WordPress preview is required before deployment.',
      confidenceScore: 1,
    },
  })
  const { error: updateError } = await supabase
    .from('siteforge_blueprint_versions')
    .update({ approval_action_attempt_id: proposal.sharedActionAttemptId })
    .eq('id', artifactId)
    .eq('content_hash', current.artifact.content_hash)
  if (updateError) {
    throw new SiteForgeArtifactApprovalError(
      'Failed to link artifact deployment proposal',
      500
    )
  }
  return {
    ...current,
    actionAttemptId: proposal.sharedActionAttemptId,
  }
}

export async function decideSiteForgeArtifactDeployment(
  input: {
    artifactId: string
    propertyId: string
    reviewerProfileId: string
    contentHash: string
    decisionStatus: 'approved' | 'denied'
    decisionReason: string
  },
  supabase: ServiceClient = createServiceClient()
) {
  const current = await ensureDeployProposal(
    input.artifactId,
    input.propertyId,
    input.reviewerProfileId,
    supabase
  )
  if (current.artifact.content_hash !== input.contentHash) {
    throw new SiteForgeArtifactApprovalError(
      'Artifact content changed; review the latest canonical preview',
      409
    )
  }
  if (current.artifact.deployment_decision === 'approved') {
    throw new SiteForgeArtifactApprovalError(
      'Artifact deployment is already approved',
      409
    )
  }

  const decision = await recordSharedApprovalDecision(
    {
      propertyId: input.propertyId,
      actionAttemptId: current.actionAttemptId,
      reviewerProfileId: input.reviewerProfileId,
      decisionStatus: input.decisionStatus,
      decisionReason: input.decisionReason,
      decisionPayload: {
        artifactId: input.artifactId,
        contentHash: input.contentHash,
        canonicalPreviewUrl: current.website.canonical_preview_url,
        previewCertificationId: current.certification.id,
        previewCertificationReportHash: current.certification.report_hash,
      },
      policyDecision: {
        policyName: 'siteforge-artifact-deployment',
        policyVersion: 'v1',
        confidenceScore: 1,
        decisionPayload: {
          qualityReport: current.artifact.quality_report,
          canonicalPreviewArtifactId:
            current.website.canonical_preview_artifact_id,
          previewCertificationId: current.certification.id,
          previewCertificationReportHash: current.certification.report_hash,
        },
      },
    },
    supabase
  )
  const now = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('siteforge_blueprint_versions')
    .update({
      confirmed_approval_id: decision.approval.id,
      deployment_decision: input.decisionStatus,
      decision_reason: input.decisionReason,
      deployment_approved_by:
        input.decisionStatus === 'approved'
          ? input.reviewerProfileId
          : null,
      deployment_approved_at:
        input.decisionStatus === 'approved' ? now : null,
    })
    .eq('id', input.artifactId)
    .eq('content_hash', input.contentHash)
  if (updateError) {
    throw new SiteForgeArtifactApprovalError(
      'Failed to persist artifact deployment decision',
      500
    )
  }
  const { error: websiteUpdateError } = await supabase
    .from('property_websites')
    .update({
      editor_lifecycle_status:
        input.decisionStatus === 'approved'
          ? 'approved_for_staging'
          : 'preview_ready',
      updated_at: now,
    })
    .eq('id', current.website.id)
    .eq('current_artifact_version_id', input.artifactId)
  if (websiteUpdateError) {
    throw new SiteForgeArtifactApprovalError(
      'Failed to persist website approval lifecycle',
      500
    )
  }
  return {
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    decisionStatus: input.decisionStatus,
    approvalId: decision.approval.id,
  }
}
