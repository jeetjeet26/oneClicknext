import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { classifySiteForgeGenerationFailure } from '@/utils/siteforge/workflows/generation-failure'
import { buildSiteForgeDirectorCommands } from './command-registry'
import type {
  SiteForgeArtifactIdentity,
  SiteForgeCertificationPosture,
  SiteForgeDirectorBlocker,
  SiteForgeDirectorDecision,
  SiteForgeDirectorJob,
  SiteForgeDirectorSnapshot,
  SiteForgeDirectorStage,
} from './contracts'

type ServiceClient = SupabaseClient<Database>

type WebsiteSource = {
  id: string
  org_id: string
  property_id: string
  generation_status: string | null
  generation_progress: number | null
  current_step: string | null
  error_message: string | null
  current_artifact_version_id: string | null
  canonical_preview_url: string | null
  canonical_preview_artifact_id: string | null
  canonical_preview_content_hash: string | null
  canonical_previewed_at: string | null
  staging_target_id: string | null
  staging_artifact_id: string | null
  staging_content_hash: string | null
  staging_url: string | null
  staging_certified_at: string | null
  production_target_id: string | null
  production_artifact_id: string | null
  production_content_hash: string | null
  production_url: string | null
  production_certified_at: string | null
}

type PlanSource = {
  id: string
  status: string
  current_revision: number
  confirmed_version_id: string | null
  confirmed_at: string | null
}

type PlanVersionSource = {
  id: string
  plan_id: string
  revision: number
  content_hash: string
  readiness_report: Json
}

type ArtifactSource = {
  id: string
  website_id: string
  property_id: string
  org_id: string
  version: number
  content_hash: string
  source_plan_version_id: string | null
  asset_manifest_hash: string | null
  base_theme_package_sha256: string | null
  runtime_contract_version: number
  runtime_package_sha256: string | null
  operation_set_hash: string | null
  deployment_decision: string | null
}

type JobSource = {
  id: string
  domain: string
  subject_id: string | null
  lifecycle_status: string
  status_reason: string | null
  stage: string
  progress: number
  current_step: string
  attempt_count: number
  max_attempts: number
  cancel_requested: boolean
  retry_at: string | null
  error_message: string | null
  error_details: Json
  payload: Json
  created_at: string
  updated_at: string
}

type ActionSource = {
  id: string
  job_id: string
  action_type: string
  proposal_decision_status: string
  execution_status: string
  policy_reason: string | null
  confidence_score: number | null
  proposed_at: string
  request_payload: Json
  execution_payload: Json
}

type DeploymentSource = {
  id: string
  target_id: string
  artifact_id: string
  artifact_content_hash: string
  status: string
  remote_manifest_hash: string | null
  certified_at: string | null
  failure_code: string | null
  failure_phase: string | null
  created_at: string
}

type CertificationSource = {
  id: string
  artifact_id: string
  environment: string
  status: string
  policy_version: string
  report_hash: string
  created_at: string
}

type ReleaseSource = {
  id: string
  release_version: number
  state: string
  artifact_id: string
  artifact_content_hash: string
  rollback_artifact_id: string | null
  rollback_content_hash: string | null
  approval_expires_at: string | null
  approved_at: string | null
  promoted_at: string | null
  live_at: string | null
  backup_id: string | null
  failure_code: string | null
  failure_message: string | null
  created_at: string
}

type IncidentSource = {
  id: string
  severity: string
  status: string
  category: string
  title: string
  summary: string
  artifact_id: string | null
  created_at: string
}

type RestoreSource = {
  id: string
  release_id: string | null
  status: string
  expected_artifact_id: string | null
  expected_content_hash: string
  started_at: string | null
  completed_at: string | null
  created_at: string
}

type HealthSource = {
  id: string
  status: string
  artifact_id: string | null
  started_at: string
  completed_at: string | null
}

type AutonomySource = {
  id: string
  action_scope: string
  mode: string
  frozen_at: string | null
  policy_version: string
  holdout_percent: number
}

type BriefSource = {
  id: string
  version: number
  status: string
  content_hash: string
  unresolved_contradictions: Json
  onboarding_snapshot_id: string | null
  onboarding_snapshot_hash: string | null
  brand_asset_id: string | null
  brand_contract_hash: string | null
}

type DirectionSetSource = {
  id: string
  version: number
  status: string
  content_hash: string
  brief_version_id: string
  selected_direction_id: string | null
}

type SelectedDirectionSource = {
  id: string
  name: string
  content_hash: string
}

export type SiteForgeDirectorSourceSnapshot = {
  website: WebsiteSource
  plan: PlanSource | null
  planVersion: PlanVersionSource | null
  artifact: ArtifactSource | null
  jobs: JobSource[]
  actions: ActionSource[]
  deployments: DeploymentSource[]
  certifications: CertificationSource[]
  release: ReleaseSource | null
  incidents: IncidentSource[]
  restore: RestoreSource | null
  health: HealthSource | null
  autonomy: AutonomySource[]
  brief?: BriefSource | null
  directionSet?: DirectionSetSource | null
  selectedDirection?: SelectedDirectionSource | null
}

export class SiteForgeDirectorError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeDirectorError'
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function projectedJobFailure(job: JobSource) {
  const details = asRecord(job.error_details)
  const diagnostics = asRecord(details.diagnostics)
  const diagnosticMessage =
    typeof diagnostics.message === 'string'
      ? diagnostics.message
      : job.error_message
  if (details.code === 'generation_failure' && diagnosticMessage) {
    const classified = classifySiteForgeGenerationFailure(
      diagnosticMessage,
      job.current_step || job.stage
    )
    return {
      code: classified.code,
      safeMessage: classified.safeMessage,
      failedCheckpoint: classified.failedCheckpoint,
      retryable: classified.retryable,
    }
  }
  if (
    typeof details.code === 'string' &&
    typeof details.safeMessage === 'string'
  ) {
    return {
      code: details.code,
      safeMessage: details.safeMessage,
      failedCheckpoint:
        typeof details.failedCheckpoint === 'string'
          ? details.failedCheckpoint
          : null,
      retryable: details.retryable === true,
    }
  }
  const classified = classifySiteForgeGenerationFailure(
    job.error_message || `${job.domain} failed`,
    job.current_step || job.stage
  )
  return {
    code: classified.code,
    safeMessage: classified.safeMessage,
    failedCheckpoint: classified.failedCheckpoint,
    retryable: classified.retryable,
  }
}

function currentIdentity(
  artifact: ArtifactSource | null
): SiteForgeArtifactIdentity {
  return {
    artifactId: artifact?.id || null,
    version: artifact?.version ?? null,
    contentHash: artifact?.content_hash || null,
    assetManifestHash: artifact?.asset_manifest_hash || null,
    baseThemePackageSha256: artifact?.base_theme_package_sha256 || null,
    runtimeContractVersion: artifact?.runtime_contract_version ?? null,
    runtimePackageSha256: artifact?.runtime_package_sha256 || null,
    operationSetHash: artifact?.operation_set_hash || null,
  }
}

function deploymentPosture(deployment: DeploymentSource | null) {
  if (!deployment) return null
  return {
    id: deployment.id,
    status: deployment.status,
    artifactId: deployment.artifact_id,
    contentHash: deployment.artifact_content_hash,
    remoteManifestHash: deployment.remote_manifest_hash,
    certifiedAt: deployment.certified_at,
    failureCode: deployment.failure_code,
    failurePhase: deployment.failure_phase,
  }
}

function certificationPosture(
  certification: CertificationSource | null,
  artifact: ArtifactSource | null
): SiteForgeCertificationPosture | null {
  if (!certification) return null
  return {
    id: certification.id,
    environment: certification.environment,
    status: certification.status,
    artifactId: certification.artifact_id,
    policyVersion: certification.policy_version,
    reportHash: certification.report_hash,
    createdAt: certification.created_at,
    exact:
      Boolean(artifact) &&
      certification.artifact_id === artifact?.id &&
      certification.status === 'passed',
  }
}

function latestCertification(
  certifications: CertificationSource[],
  environments: string[]
): CertificationSource | null {
  return (
    certifications.find(certification =>
      environments.includes(certification.environment)
    ) || null
  )
}

function readinessIssues(readiness: unknown): Array<Record<string, unknown>> {
  const issues = asRecord(readiness).issues
  return Array.isArray(issues)
    ? issues.filter(
        (issue): issue is Record<string, unknown> =>
          Boolean(issue) && typeof issue === 'object' && !Array.isArray(issue)
      )
    : []
}

function deriveBlockers(
  source: SiteForgeDirectorSourceSnapshot,
  now: Date
): SiteForgeDirectorBlocker[] {
  const blockers: SiteForgeDirectorBlocker[] = []
  const { website, artifact, release, restore } = source

  if (website.error_message) {
    blockers.push({
      code: 'website_error',
      severity: 'blocker',
      source: 'website',
      message: website.error_message,
      entityId: website.id,
    })
  }
  const contradictions = source.brief?.unresolved_contradictions
  if (Array.isArray(contradictions) && contradictions.length > 0) {
    blockers.push({
      code: 'brief_contradictions_unresolved',
      severity: 'blocker',
      source: 'brief',
      message: `${contradictions.length} brief contradiction${contradictions.length === 1 ? '' : 's'} must be resolved before approval.`,
      entityId: source.brief?.id,
    })
  }
  if (website.current_artifact_version_id && !artifact) {
    blockers.push({
      code: 'current_artifact_unavailable',
      severity: 'blocker',
      source: 'artifact',
      message:
        'The website projection references an artifact that is unavailable in the current tenant.',
      entityId: website.current_artifact_version_id,
    })
  }

  for (const issue of readinessIssues(source.planVersion?.readiness_report)) {
    const severity = issue.severity === 'blocker' ? 'blocker' : 'warning'
    blockers.push({
      code:
        typeof issue.code === 'string' ? issue.code : 'plan_readiness_issue',
      severity,
      source: 'plan',
      message:
        typeof issue.message === 'string'
          ? issue.message
          : 'The current plan has a readiness issue.',
      entityId: source.plan?.id,
    })
  }

  if (
    artifact &&
    website.canonical_preview_artifact_id &&
    (website.canonical_preview_artifact_id !== artifact.id ||
      website.canonical_preview_content_hash !== artifact.content_hash)
  ) {
    blockers.push({
      code: 'preview_artifact_identity_mismatch',
      severity: 'blocker',
      source: 'artifact',
      message:
        'The canonical preview does not match the exact current artifact identity.',
      entityId: artifact.id,
    })
  }

  if (
    artifact &&
    website.staging_artifact_id &&
    (website.staging_artifact_id !== artifact.id ||
      website.staging_content_hash !== artifact.content_hash)
  ) {
    blockers.push({
      code: 'staging_artifact_identity_mismatch',
      severity: 'blocker',
      source: 'artifact',
      message:
        'Staging is certified against a different artifact or content hash.',
      entityId: artifact.id,
    })
  }

  const latestJobDomains = new Set<string>()
  for (const job of source.jobs) {
    if (latestJobDomains.has(job.domain)) continue
    latestJobDomains.add(job.domain)
    if (job.lifecycle_status === 'failed') {
      const failure = projectedJobFailure(job)
      blockers.push({
        code: `job_failed:${job.domain}`,
        severity: 'blocker',
        source: 'job',
        message: failure.safeMessage,
        entityId: job.id,
      })
    }
  }

  const latestDeploymentTargets = new Set<string>()
  for (const deployment of source.deployments) {
    if (latestDeploymentTargets.has(deployment.target_id)) continue
    latestDeploymentTargets.add(deployment.target_id)
    if (deployment.status === 'failed') {
      blockers.push({
        code: deployment.failure_code || 'deployment_failed',
        severity: 'blocker',
        source: 'artifact',
        message: deployment.failure_phase
          ? `Deployment failed during ${deployment.failure_phase}.`
          : 'Artifact deployment failed.',
        entityId: deployment.id,
      })
    }
  }

  const latestCertificationEnvironments = new Set<string>()
  for (const certification of source.certifications) {
    if (latestCertificationEnvironments.has(certification.environment)) continue
    latestCertificationEnvironments.add(certification.environment)
    if (
      certification.status === 'failed' &&
      (!artifact || certification.artifact_id === artifact.id)
    ) {
      blockers.push({
        code: `certification_failed:${certification.environment}`,
        severity: 'blocker',
        source: 'certification',
        message: `${certification.environment} certification failed for the current artifact.`,
        entityId: certification.id,
      })
    }
  }

  if (release?.failure_message || release?.state === 'failed') {
    blockers.push({
      code: release.failure_code || 'release_failed',
      severity: 'blocker',
      source: 'release',
      message: release.failure_message || 'The active release failed.',
      entityId: release.id,
    })
  }
  if (
    release?.state === 'launch_approved' &&
    release.approval_expires_at &&
    new Date(release.approval_expires_at).getTime() <= now.getTime()
  ) {
    blockers.push({
      code: 'launch_approval_expired',
      severity: 'blocker',
      source: 'release',
      message: 'The launch approval and one-use promotion authority expired.',
      entityId: release.id,
    })
  }

  for (const incident of source.incidents.filter(
    incident => incident.status !== 'resolved'
  )) {
    blockers.push({
      code: `incident:${incident.category}`,
      severity:
        incident.severity === 'critical' || incident.severity === 'high'
          ? 'blocker'
          : 'warning',
      source: 'incident',
      message: incident.title,
      entityId: incident.id,
    })
  }

  if (restore?.status === 'failed') {
    blockers.push({
      code: 'restore_failed',
      severity: 'blocker',
      source: 'recovery',
      message: 'The latest restore attempt failed and needs operator review.',
      entityId: restore.id,
    })
  }

  for (const mode of source.autonomy.filter(mode => mode.frozen_at)) {
    blockers.push({
      code: `autonomy_frozen:${mode.action_scope}`,
      severity: 'warning',
      source: 'autonomy',
      message: `${mode.action_scope} autonomy is frozen.`,
      entityId: mode.id,
    })
  }

  return blockers
}

function deriveStage(
  source: SiteForgeDirectorSourceSnapshot,
  blockers: SiteForgeDirectorBlocker[]
): SiteForgeDirectorSnapshot['stage'] {
  const activeRestore =
    source.restore &&
    ['queued', 'restoring', 'verifying'].includes(source.restore.status)
  const recoveryIncident = source.incidents.some(
    incident =>
      incident.status !== 'resolved' &&
      ['restore_required', 'rollback', 'production_drift'].includes(
        incident.category
      )
  )
  let key: SiteForgeDirectorStage
  let detail: string

  if (activeRestore || recoveryIncident) {
    key = 'recovery'
    detail = activeRestore
      ? 'A supervised restore is active.'
      : 'Production recovery needs operator attention.'
  } else if (
    source.release &&
    !['live', 'rolled_back'].includes(source.release.state)
  ) {
    key = 'release'
    detail = `Release ${source.release.release_version} is ${source.release.state}.`
  } else if (source.website.production_artifact_id) {
    key = 'production'
    detail = source.website.production_certified_at
      ? 'The exact production artifact is certified.'
      : 'Production exists but certification is incomplete.'
  } else if (
    source.website.staging_artifact_id ||
    source.deployments.some(deployment =>
      ['deploying', 'deployed', 'certified'].includes(deployment.status)
    )
  ) {
    key = 'staging'
    detail = source.website.staging_certified_at
      ? 'The staging artifact is certified.'
      : 'Staging deployment or certification is in progress.'
  } else if (
    source.actions.some(
      action => action.proposal_decision_status === 'proposed'
    )
  ) {
    key = 'approval'
    detail = 'A human decision is required before the next mutation.'
  } else if (source.website.canonical_preview_artifact_id) {
    key = 'preview'
    detail = 'The immutable artifact is available in canonical preview.'
  } else if (
    source.jobs.some(
      job =>
        job.domain === 'siteforge.generation' &&
        ['queued', 'running', 'retrying'].includes(job.lifecycle_status)
    )
  ) {
    key = 'generation'
    detail = 'The existing generation workflow is active.'
  } else if (source.plan || source.brief || source.directionSet) {
    key = 'planning'
    detail = source.plan
      ? `Plan revision ${source.plan.current_revision} is ${source.plan.status}.`
      : source.directionSet
        ? `Creative direction set ${source.directionSet.version} is ${source.directionSet.status}.`
        : `Brief version ${source.brief?.version} is ${source.brief?.status}.`
  } else {
    key = 'setup'
    detail = 'Create a trusted SiteForge plan to begin.'
  }

  const labels: Record<SiteForgeDirectorStage, string> = {
    setup: 'Setup',
    planning: 'Planning',
    generation: 'Generation',
    preview: 'Preview',
    approval: 'Approval',
    staging: 'Staging',
    release: 'Release',
    production: 'Production',
    recovery: 'Recovery',
  }
  const hasBlockingIssue = blockers.some(blocker => blocker.severity === 'blocker')
  const active = source.jobs.some(job =>
    ['queued', 'running', 'retrying'].includes(job.lifecycle_status)
  )
  return {
    key,
    label: labels[key],
    status: hasBlockingIssue
      ? 'blocked'
      : active || key === 'recovery' || key === 'release'
        ? 'active'
        : key === 'production'
          ? 'ready'
          : 'idle',
    detail,
  }
}

export function deriveSiteForgeDirectorSnapshot(
  source: SiteForgeDirectorSourceSnapshot,
  now = new Date()
): SiteForgeDirectorSnapshot {
  const { website, artifact, release } = source
  const blockers = deriveBlockers(source, now)
  const jobs: SiteForgeDirectorJob[] = source.jobs.map(job => {
    const failure =
      job.lifecycle_status === 'failed' ? projectedJobFailure(job) : null
    return {
      id: job.id,
      domain: job.domain,
      lifecycleStatus: job.lifecycle_status,
      statusReason: job.status_reason,
      stage: job.stage,
      progress: job.progress,
      currentStep: job.current_step,
      attemptCount: job.attempt_count,
      maxAttempts: job.max_attempts,
      cancelRequested: job.cancel_requested,
      retryAt: job.retry_at,
      errorMessage: job.error_message,
      failureCode: failure?.code || null,
      failureReason: failure?.safeMessage || null,
      failedCheckpoint: failure?.failedCheckpoint || null,
      retryable: failure?.retryable === true,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }
  })
  const jobDomains = new Map(source.jobs.map(job => [job.id, job.domain]))
  const pendingDecisions: SiteForgeDirectorDecision[] = source.actions
    .filter(action => action.proposal_decision_status === 'proposed')
    .map(action => ({
      id: action.id,
      jobId: action.job_id,
      domain: jobDomains.get(action.job_id) || 'siteforge',
      actionType: action.action_type,
      proposalDecisionStatus: action.proposal_decision_status,
      executionStatus: action.execution_status,
      policyReason: action.policy_reason,
      confidenceScore: action.confidence_score,
      proposedAt: action.proposed_at,
      requestPayload: action.request_payload,
      executionPayload: action.execution_payload,
    }))

  const stagingDeployment =
    source.deployments.find(
      deployment => deployment.target_id === website.staging_target_id
    ) || null
  const productionDeployment =
    source.deployments.find(
      deployment => deployment.target_id === website.production_target_id
    ) || null
  const previewCertification = latestCertification(source.certifications, [
    'preview',
    'protected_preview',
  ])
  const stagingCertification = latestCertification(source.certifications, [
    'staging',
  ])
  const productionCertification = latestCertification(source.certifications, [
    'production',
  ])
  const previewExact = Boolean(
    artifact &&
      website.canonical_preview_artifact_id === artifact.id &&
      website.canonical_preview_content_hash === artifact.content_hash &&
      website.canonical_preview_url
  )
  const stagingExact = Boolean(
    artifact &&
      website.staging_artifact_id === artifact.id &&
      website.staging_content_hash === artifact.content_hash &&
      website.staging_certified_at &&
      stagingDeployment?.artifact_id === artifact.id &&
      stagingDeployment.artifact_content_hash === artifact.content_hash &&
      stagingDeployment.status === 'certified' &&
      stagingDeployment.certified_at &&
      stagingCertification?.artifact_id === artifact.id &&
      stagingCertification.status === 'passed'
  )
  const productionExact = Boolean(
    artifact &&
      website.production_artifact_id === artifact.id &&
      website.production_content_hash === artifact.content_hash &&
      website.production_certified_at
  )
  const openIncidents = source.incidents.filter(
    incident => incident.status !== 'resolved'
  )

  const productionStatus: SiteForgeDirectorSnapshot['production']['status'] =
    !website.production_artifact_id
      ? 'not_live'
      : !website.production_certified_at
        ? 'uncertified'
        : openIncidents.length > 0 || source.health?.status === 'failed'
          ? 'degraded'
          : source.health?.status === 'passed' ||
              source.health?.status === 'healthy'
            ? 'healthy'
            : 'unknown'

  const commands = buildSiteForgeDirectorCommands({
    websiteId: website.id,
    propertyId: website.property_id,
    plan: {
      id: source.plan?.id || null,
      status: source.plan?.status || null,
      revision: source.plan?.current_revision ?? null,
      contentHash: source.planVersion?.content_hash || null,
    },
    artifact: {
      id: artifact?.id || null,
      contentHash: artifact?.content_hash || null,
      deploymentDecision: artifact?.deployment_decision || null,
      previewExact,
      stagingTargetId: website.staging_target_id,
      stagingExact,
    },
    release: {
      id: release?.id || null,
      state: release?.state || null,
      artifactId: release?.artifact_id || null,
      contentHash: release?.artifact_content_hash || null,
      rollbackArtifactId: release?.rollback_artifact_id || null,
      rollbackContentHash: release?.rollback_content_hash || null,
    },
    production: {
      artifactId: website.production_artifact_id,
      contentHash: website.production_content_hash,
      certifiedAt: website.production_certified_at,
    },
    jobs,
    incidents: source.incidents.map(incident => ({
      id: incident.id,
      status: incident.status,
    })),
  })

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    identity: {
      websiteId: website.id,
      propertyId: website.property_id,
      orgId: website.org_id,
    },
    stage: deriveStage(source, blockers),
    blockers,
    collaboration: {
      account: {
        orgId: website.org_id,
        propertyId: website.property_id,
        websiteId: website.id,
      },
      brief: source.brief
        ? {
            id: source.brief.id,
            version: source.brief.version,
            status: source.brief.status,
            contentHash: source.brief.content_hash,
            contradictionCount: Array.isArray(
              source.brief.unresolved_contradictions
            )
              ? source.brief.unresolved_contradictions.length
              : 0,
            onboardingSnapshotId: source.brief.onboarding_snapshot_id,
            onboardingSnapshotHash: source.brief.onboarding_snapshot_hash,
            brandAssetId: source.brief.brand_asset_id,
            brandContractHash: source.brief.brand_contract_hash,
          }
        : null,
      direction: source.directionSet
        ? {
            id: source.directionSet.id,
            version: source.directionSet.version,
            status: source.directionSet.status,
            contentHash: source.directionSet.content_hash,
            briefVersionId: source.directionSet.brief_version_id,
            selectedDirectionId: source.directionSet.selected_direction_id,
            selectedDirectionName: source.selectedDirection?.name || null,
            selectedDirectionHash:
              source.selectedDirection?.content_hash || null,
          }
        : null,
    },
    plan: {
      id: source.plan?.id || null,
      status: source.plan?.status || null,
      revision: source.plan?.current_revision ?? null,
      versionId: source.planVersion?.id || null,
      contentHash: source.planVersion?.content_hash || null,
      readiness: source.planVersion?.readiness_report || null,
      confirmedAt: source.plan?.confirmed_at || null,
    },
    artifact: {
      current: currentIdentity(artifact),
      preview: {
        url: website.canonical_preview_url,
        artifactId: website.canonical_preview_artifact_id,
        contentHash: website.canonical_preview_content_hash,
        certifiedAt:
          previewExact && previewCertification?.status === 'passed'
            ? previewCertification.created_at
            : null,
        exact: previewExact,
      },
      staging: {
        url: website.staging_url,
        targetId: website.staging_target_id,
        artifactId: website.staging_artifact_id,
        contentHash: website.staging_content_hash,
        certifiedAt: website.staging_certified_at,
        exact: stagingExact,
        latestDeployment: deploymentPosture(stagingDeployment),
      },
      production: {
        url: website.production_url,
        targetId: website.production_target_id,
        artifactId: website.production_artifact_id,
        contentHash: website.production_content_hash,
        certifiedAt: website.production_certified_at,
        exact: productionExact,
        latestDeployment: deploymentPosture(productionDeployment),
      },
    },
    pendingDecisions,
    jobs,
    certification: {
      preview: certificationPosture(previewCertification, artifact),
      staging: certificationPosture(stagingCertification, artifact),
      production: certificationPosture(productionCertification, artifact),
    },
    release: {
      id: release?.id || null,
      version: release?.release_version ?? null,
      state: release?.state || null,
      artifactId: release?.artifact_id || null,
      contentHash: release?.artifact_content_hash || null,
      rollbackArtifactId: release?.rollback_artifact_id || null,
      rollbackContentHash: release?.rollback_content_hash || null,
      approvalExpiresAt: release?.approval_expires_at || null,
      approvedAt: release?.approved_at || null,
      promotedAt: release?.promoted_at || null,
      liveAt: release?.live_at || null,
      failureCode: release?.failure_code || null,
      failureMessage: release?.failure_message || null,
    },
    production: {
      status: productionStatus,
      lastHealthRun: source.health
        ? {
            id: source.health.id,
            status: source.health.status,
            artifactId: source.health.artifact_id,
            startedAt: source.health.started_at,
            completedAt: source.health.completed_at,
          }
        : null,
      openIncidentCount: openIncidents.length,
    },
    recovery: {
      rollbackArtifactId: release?.rollback_artifact_id || null,
      rollbackContentHash: release?.rollback_content_hash || null,
      backupId: release?.backup_id || null,
      latestRestore: source.restore
        ? {
            id: source.restore.id,
            status: source.restore.status,
            expectedArtifactId: source.restore.expected_artifact_id,
            expectedContentHash: source.restore.expected_content_hash,
            startedAt: source.restore.started_at,
            completedAt: source.restore.completed_at,
          }
        : null,
      incidents: source.incidents.map(incident => ({
        id: incident.id,
        severity: incident.severity,
        status: incident.status,
        category: incident.category,
        title: incident.title,
        summary: incident.summary,
        createdAt: incident.created_at,
      })),
    },
    autonomy: source.autonomy.map(mode => ({
      id: mode.id,
      actionScope: mode.action_scope,
      mode: mode.mode,
      frozenAt: mode.frozen_at,
      policyVersion: mode.policy_version,
      holdoutPercent: mode.holdout_percent,
    })),
    commands,
  }
}

function jobReferencesWebsite(
  job: JobSource,
  references: Set<string>,
  websiteId: string
): boolean {
  if (job.subject_id && references.has(job.subject_id)) return true
  const payload = asRecord(job.payload)
  return (
    payload.websiteId === websiteId ||
    (typeof payload.artifactId === 'string' &&
      references.has(payload.artifactId)) ||
    (typeof payload.releaseId === 'string' &&
      references.has(payload.releaseId))
  )
}

export async function loadSiteForgeDirectorSnapshot(
  websiteId: string,
  client: ServiceClient = createServiceClient()
): Promise<SiteForgeDirectorSnapshot> {
  const { data: website, error: websiteError } = await client
    .from('property_websites')
    .select(
      'id, org_id, property_id, generation_status, generation_progress, current_step, error_message, current_artifact_version_id, canonical_preview_url, canonical_preview_artifact_id, canonical_preview_content_hash, canonical_previewed_at, staging_target_id, staging_artifact_id, staging_content_hash, staging_url, staging_certified_at, production_target_id, production_artifact_id, production_content_hash, production_url, production_certified_at'
    )
    .eq('id', websiteId)
    .single()
  if (websiteError || !website) {
    throw new SiteForgeDirectorError('SiteForge website not found', 404)
  }

  const tenant = {
    orgId: website.org_id,
    propertyId: website.property_id,
    websiteId: website.id,
  }
  const artifactPromise = website.current_artifact_version_id
    ? client
        .from('siteforge_blueprint_versions')
        .select(
          'id, website_id, property_id, org_id, version, content_hash, source_plan_version_id, asset_manifest_hash, base_theme_package_sha256, runtime_contract_version, runtime_package_sha256, operation_set_hash, deployment_decision'
        )
        .eq('id', website.current_artifact_version_id)
        .eq('website_id', tenant.websiteId)
        .eq('property_id', tenant.propertyId)
        .eq('org_id', tenant.orgId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const [
    artifactResult,
    planResult,
    deploymentsResult,
    certificationsResult,
    releaseResult,
    incidentsResult,
    restoreResult,
    healthResult,
    jobsResult,
    autonomyResult,
    briefResult,
    directionSetResult,
  ] = await Promise.all([
    artifactPromise,
    client
      .from('siteforge_plans')
      .select(
        'id, status, current_revision, confirmed_version_id, confirmed_at'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('siteforge_artifact_deployments')
      .select(
        'id, target_id, artifact_id, artifact_content_hash, status, remote_manifest_hash, certified_at, failure_code, failure_phase, created_at'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('created_at', { ascending: false })
      .limit(30),
    client
      .from('siteforge_certification_evidence')
      .select(
        'id, artifact_id, environment, status, policy_version, report_hash, created_at'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('created_at', { ascending: false })
      .limit(50),
    client
      .from('siteforge_launch_releases')
      .select(
        'id, release_version, state, artifact_id, artifact_content_hash, rollback_artifact_id, rollback_content_hash, approval_expires_at, approved_at, promoted_at, live_at, backup_id, failure_code, failure_message, created_at'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('release_version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('siteforge_incidents')
      .select(
        'id, severity, status, category, title, summary, artifact_id, created_at'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('created_at', { ascending: false })
      .limit(50),
    client
      .from('siteforge_restore_drills')
      .select(
        'id, release_id, status, expected_artifact_id, expected_content_hash, started_at, completed_at, created_at'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('siteforge_health_runs')
      .select('id, status, artifact_id, started_at, completed_at')
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('shared_jobs')
      .select(
        'id, domain, subject_id, lifecycle_status, status_reason, stage, progress, current_step, attempt_count, max_attempts, cancel_requested, retry_at, error_message, error_details, payload, created_at, updated_at'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .or('domain.eq.siteforge,domain.like.siteforge.%')
      .order('created_at', { ascending: false })
      .limit(100),
    client
      .from('siteforge_autonomy_modes')
      .select(
        'id, action_scope, mode, frozen_at, policy_version, holdout_percent'
      )
      .eq('org_id', tenant.orgId)
      .or(`property_id.eq.${tenant.propertyId},property_id.is.null`)
      .is('superseded_at', null)
      .order('created_at', { ascending: false }),
    client
      .from('siteforge_brief_versions')
      .select(
        'id, version, status, content_hash, unresolved_contradictions, onboarding_snapshot_id, onboarding_snapshot_hash, brand_asset_id, brand_contract_hash'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('siteforge_creative_direction_sets')
      .select(
        'id, version, status, content_hash, brief_version_id, selected_direction_id'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .eq('website_id', tenant.websiteId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const failedRead = [
    artifactResult.error,
    planResult.error,
    deploymentsResult.error,
    certificationsResult.error,
    releaseResult.error,
    incidentsResult.error,
    restoreResult.error,
    healthResult.error,
    jobsResult.error,
    autonomyResult.error,
    briefResult.error,
    directionSetResult.error,
  ].find(Boolean)
  if (failedRead) {
    throw new SiteForgeDirectorError(
      `Failed to assemble SiteForge Director snapshot: ${failedRead.message}`,
      500
    )
  }

  const artifact = artifactResult.data as ArtifactSource | null
  let plan = planResult.data as PlanSource | null
  let planVersion: PlanVersionSource | null = null
  const planVersionId =
    artifact?.source_plan_version_id || plan?.confirmed_version_id || null
  if (planVersionId) {
    const { data, error } = await client
      .from('siteforge_plan_versions')
      .select('id, plan_id, revision, content_hash, readiness_report')
      .eq('id', planVersionId)
      .single()
    if (error || !data) {
      throw new SiteForgeDirectorError(
        'The exact SiteForge plan revision could not be loaded',
        500
      )
    }
    planVersion = data as PlanVersionSource
  } else if (plan) {
    const { data, error } = await client
      .from('siteforge_plan_versions')
      .select('id, plan_id, revision, content_hash, readiness_report')
      .eq('plan_id', plan.id)
      .eq('revision', plan.current_revision)
      .maybeSingle()
    if (error) {
      throw new SiteForgeDirectorError(
        'The current SiteForge plan revision could not be loaded',
        500
      )
    }
    planVersion = data as PlanVersionSource | null
  }
  if (planVersion && plan?.id !== planVersion.plan_id) {
    const { data, error } = await client
      .from('siteforge_plans')
      .select(
        'id, status, current_revision, confirmed_version_id, confirmed_at'
      )
      .eq('id', planVersion.plan_id)
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .single()
    if (error || !data) {
      throw new SiteForgeDirectorError(
        'The exact SiteForge plan identity could not be loaded',
        500
      )
    }
    plan = data as PlanSource
  }

  const release = releaseResult.data as ReleaseSource | null
  const incidents = (incidentsResult.data || []) as IncidentSource[]
  const restore = restoreResult.data as RestoreSource | null
  const references = new Set(
    [
      tenant.websiteId,
      artifact?.id,
      plan?.id,
      planVersion?.id,
      (briefResult.data as BriefSource | null)?.id,
      (directionSetResult.data as DirectionSetSource | null)?.id,
      release?.id,
      restore?.id,
      ...incidents.map(incident => incident.id),
    ].filter((value): value is string => Boolean(value))
  )
  const jobs = ((jobsResult.data || []) as JobSource[]).filter(job =>
    jobReferencesWebsite(job, references, tenant.websiteId)
  )
  let actions: ActionSource[] = []
  if (jobs.length) {
    const { data, error } = await client
      .from('shared_action_attempts')
      .select(
        'id, job_id, action_type, proposal_decision_status, execution_status, policy_reason, confidence_score, proposed_at, request_payload, execution_payload'
      )
      .eq('org_id', tenant.orgId)
      .eq('property_id', tenant.propertyId)
      .in(
        'job_id',
        jobs.map(job => job.id)
      )
      .order('created_at', { ascending: false })
    if (error) {
      throw new SiteForgeDirectorError(
        'Failed to load SiteForge decisions',
        500
      )
    }
    actions = (data || []) as ActionSource[]
  }
  const directionSet = directionSetResult.data as DirectionSetSource | null
  let selectedDirection: SelectedDirectionSource | null = null
  if (directionSet?.selected_direction_id) {
    const { data, error } = await client
      .from('siteforge_creative_directions')
      .select('id, name, content_hash')
      .eq('id', directionSet.selected_direction_id)
      .eq('website_id', tenant.websiteId)
      .eq('property_id', tenant.propertyId)
      .eq('org_id', tenant.orgId)
      .single()
    if (error || !data) {
      throw new SiteForgeDirectorError(
        'The selected creative direction identity could not be loaded',
        500
      )
    }
    selectedDirection = data
  }

  return deriveSiteForgeDirectorSnapshot({
    website: website as WebsiteSource,
    plan,
    planVersion,
    artifact,
    jobs,
    actions,
    deployments: (deploymentsResult.data || []) as DeploymentSource[],
    certifications: (certificationsResult.data || []) as CertificationSource[],
    release,
    incidents,
    restore,
    health: healthResult.data as HealthSource | null,
    autonomy: (autonomyResult.data || []) as AutonomySource[],
    brief: briefResult.data as BriefSource | null,
    directionSet,
    selectedDirection,
  })
}
