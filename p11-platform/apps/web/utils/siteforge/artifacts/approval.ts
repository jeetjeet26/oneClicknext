import { createServiceClient } from '@/utils/supabase/admin'
import { proposeSharedAction } from '@/utils/services/shared-executor'
import { recordSharedApprovalDecision } from '@/utils/services/shared-approvals'

type ServiceClient = ReturnType<typeof createServiceClient>

/**
 * Canonical preview is the one iterative exception in the release chain.
 * A reviewer may approve an exact protected WordPress render without complete
 * browser evidence so corrections can continue. That approval never certifies
 * a public environment: staging and production independently require complete
 * blocking rendered/browser certification.
 */
export const CANONICAL_PREVIEW_ITERATION_POLICY = Object.freeze({
  environment: 'protected_preview' as const,
  browserEvidenceRequiredForIteration: false,
  publicStagingCertificationRequired: true,
  productionCertificationRequired: true,
})

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
      'id, website_id, org_id, property_id, version, content_hash, quality_report, approval_action_attempt_id, confirmed_approval_id, deployment_decision, decision_reason, deployment_approved_by, deployment_approved_at'
    )
    .eq('id', artifactId)
    .eq('property_id', propertyId)
    .single()
  if (error || !artifact) {
    throw new SiteForgeArtifactApprovalError(
      'SiteForge artifact not found',
      404
    )
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
      'id, current_artifact_version_id, canonical_preview_artifact_id, canonical_preview_content_hash, canonical_preview_url, editor_lifecycle_status'
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
  const { data: certificationRow } = await supabase
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
    certificationRow?.report &&
    typeof certificationRow.report === 'object' &&
    !Array.isArray(certificationRow.report)
      ? certificationRow.report
      : null
  const certification =
    !report ||
    report.passed !== true ||
    report.artifactId !== artifact.id ||
    report.contentHash !== artifact.content_hash
      ? null
      : certificationRow
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
    const { data: existing, error: existingError } = await supabase
      .from('shared_action_attempts')
      .select(
        'id, org_id, property_id, action_type, proposal_decision_status, request_payload, execution_payload'
      )
      .eq('id', current.artifact.approval_action_attempt_id)
      .maybeSingle()
    if (existingError) {
      throw new SiteForgeArtifactApprovalError(
        'Failed to reconcile artifact deployment proposal',
        500
      )
    }
    if (existing) {
      const requestPayload =
        existing.request_payload &&
        typeof existing.request_payload === 'object' &&
        !Array.isArray(existing.request_payload)
          ? existing.request_payload
          : null
      const executionPayload =
        existing.execution_payload &&
        typeof existing.execution_payload === 'object' &&
        !Array.isArray(existing.execution_payload)
          ? existing.execution_payload
          : null
      if (
        existing.org_id !== current.artifact.org_id ||
        existing.property_id !== propertyId ||
        existing.action_type !== 'siteforge.artifact:deploy_staging' ||
        requestPayload?.artifactId !== artifactId ||
        requestPayload.contentHash !== current.artifact.content_hash ||
        executionPayload?.artifactId !== artifactId ||
        executionPayload.contentHash !== current.artifact.content_hash ||
        executionPayload.websiteId !== current.artifact.website_id
      ) {
        throw new SiteForgeArtifactApprovalError(
          'Artifact deployment proposal is bound to different artifact details',
          409
        )
      }
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
      ...(current.certification
        ? {
            previewCertificationId: current.certification.id,
            previewCertificationReportHash: current.certification.report_hash,
          }
        : {}),
    },
    action: {
      actionType: 'siteforge.artifact:deploy_staging',
      requestPayload: {
        artifactId,
        contentHash: current.artifact.content_hash,
        ...(current.certification
          ? {
              previewCertificationId: current.certification.id,
              previewCertificationReportHash: current.certification.report_hash,
            }
          : {}),
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

function hasPersistedArtifactDecision(
  artifact: Awaited<ReturnType<typeof loadDeployableArtifact>>['artifact'],
  input: {
    reviewerProfileId: string
    decisionStatus: 'approved' | 'denied'
    decisionReason: string
  },
  approvalId: string
): boolean {
  const hasDecision =
    artifact.deployment_decision !== null &&
    artifact.deployment_decision !== 'pending'
  if (!hasDecision) {
    if (
      artifact.confirmed_approval_id !== null ||
      artifact.decision_reason !== null ||
      artifact.deployment_approved_by !== null ||
      artifact.deployment_approved_at !== null
    ) {
      throw new SiteForgeArtifactApprovalError(
        'Artifact has a conflicting partial deployment decision',
        409
      )
    }
    return false
  }

  const approvalFieldsMatch =
    artifact.deployment_decision === input.decisionStatus &&
    artifact.confirmed_approval_id === approvalId &&
    artifact.decision_reason === input.decisionReason &&
    (input.decisionStatus === 'approved'
      ? artifact.deployment_approved_by === input.reviewerProfileId &&
        Boolean(artifact.deployment_approved_at)
      : artifact.deployment_approved_by === null &&
        artifact.deployment_approved_at === null)
  if (!approvalFieldsMatch) {
    throw new SiteForgeArtifactApprovalError(
      'Artifact deployment was already decided with different details',
      409
    )
  }
  return true
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
  const decisionReason = input.decisionReason.trim()
  const decision = await recordSharedApprovalDecision(
    {
      propertyId: input.propertyId,
      actionAttemptId: current.actionAttemptId,
      reviewerProfileId: input.reviewerProfileId,
      decisionStatus: input.decisionStatus,
      decisionReason,
      decisionPayload: {
        artifactId: input.artifactId,
        contentHash: input.contentHash,
        canonicalPreviewUrl: current.website.canonical_preview_url,
        previewCertificationId: current.certification?.id || null,
        previewCertificationReportHash:
          current.certification?.report_hash || null,
      },
      policyDecision: {
        policyName: 'siteforge-artifact-deployment',
        policyVersion: 'v1',
        confidenceScore: 1,
        decisionPayload: {
          qualityReport: current.artifact.quality_report,
          canonicalPreviewArtifactId:
            current.website.canonical_preview_artifact_id,
          previewCertificationId: current.certification?.id || null,
          previewCertificationReportHash:
            current.certification?.report_hash || null,
        },
      },
    },
    supabase
  )
  const now = new Date().toISOString()
  if (
    !hasPersistedArtifactDecision(
      current.artifact,
      {
        reviewerProfileId: input.reviewerProfileId,
        decisionStatus: input.decisionStatus,
        decisionReason,
      },
      decision.approval.id
    )
  ) {
    const artifactUpdate = supabase
      .from('siteforge_blueprint_versions')
      .update({
        confirmed_approval_id: decision.approval.id,
        deployment_decision: input.decisionStatus,
        decision_reason: decisionReason,
        deployment_approved_by:
          input.decisionStatus === 'approved' ? input.reviewerProfileId : null,
        deployment_approved_at:
          input.decisionStatus === 'approved' ? now : null,
      })
      .eq('id', input.artifactId)
      .eq('content_hash', input.contentHash)
      .eq('approval_action_attempt_id', current.actionAttemptId)
    const pendingArtifactUpdate =
      current.artifact.deployment_decision === null
        ? artifactUpdate.is('deployment_decision', null)
        : artifactUpdate.eq('deployment_decision', 'pending')
    const { data: updatedArtifact, error: updateError } =
      await pendingArtifactUpdate
        .is('confirmed_approval_id', null)
        .select('id')
        .maybeSingle()
    if (updateError) {
      throw new SiteForgeArtifactApprovalError(
        'Failed to persist artifact deployment decision',
        500
      )
    }
    if (!updatedArtifact) {
      throw new SiteForgeArtifactApprovalError(
        'Artifact deployment changed while reconciling the decision',
        409
      )
    }
  }
  const expectedWebsiteStatus =
    input.decisionStatus === 'approved'
      ? 'approved_for_staging'
      : 'preview_ready'
  if (current.website.editor_lifecycle_status !== expectedWebsiteStatus) {
    const { data: updatedWebsite, error: websiteUpdateError } = await supabase
      .from('property_websites')
      .update({
        editor_lifecycle_status: expectedWebsiteStatus,
        updated_at: now,
      })
      .eq('id', current.website.id)
      .eq('current_artifact_version_id', input.artifactId)
      .eq('canonical_preview_artifact_id', input.artifactId)
      .eq('canonical_preview_content_hash', input.contentHash)
      .eq(
        'editor_lifecycle_status',
        current.website.editor_lifecycle_status
      )
      .select('id')
      .maybeSingle()
    if (websiteUpdateError) {
      throw new SiteForgeArtifactApprovalError(
        'Failed to persist website approval lifecycle',
        500
      )
    }
    if (!updatedWebsite) {
      throw new SiteForgeArtifactApprovalError(
        'Artifact website changed while reconciling the decision',
        409
      )
    }
  }
  return {
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    decisionStatus: input.decisionStatus,
    approvalId: decision.approval.id,
  }
}
