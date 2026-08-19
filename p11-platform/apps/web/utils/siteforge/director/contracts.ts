export const SITEFORGE_DIRECTOR_STAGES = [
  'setup',
  'planning',
  'generation',
  'preview',
  'approval',
  'staging',
  'release',
  'production',
  'recovery',
] as const

export type SiteForgeDirectorStage =
  (typeof SITEFORGE_DIRECTOR_STAGES)[number]

export type SiteForgeDirectorBlocker = {
  code: string
  severity: 'warning' | 'blocker'
  source:
    | 'website'
    | 'brief'
    | 'direction'
    | 'plan'
    | 'artifact'
    | 'job'
    | 'certification'
    | 'release'
    | 'production'
    | 'incident'
    | 'recovery'
    | 'autonomy'
  message: string
  entityId?: string | null
}

export type SiteForgeArtifactIdentity = {
  artifactId: string | null
  version: number | null
  contentHash: string | null
  assetManifestHash: string | null
  baseThemePackageSha256: string | null
  runtimeContractVersion: number | null
  runtimePackageSha256: string | null
  operationSetHash: string | null
}

export const SITEFORGE_DIRECTOR_COMMAND_TYPES = [
  'review_plan',
  'retry_job',
  'cancel_job',
  'review_artifact',
  'deploy_staging',
  'prepare_launch',
  'approve_launch',
  'promote_launch',
  'certify_production',
  'acknowledge_incident',
  'restore_release',
] as const

export type SiteForgeDirectorCommandType =
  (typeof SITEFORGE_DIRECTOR_COMMAND_TYPES)[number]

export type SiteForgeDirectorCommand = {
  id: string
  type: SiteForgeDirectorCommandType
  label: string
  description: string
  available: boolean
  unavailableReason: string | null
  risk: 'low' | 'supervised' | 'critical'
  target: {
    kind: 'route'
    method: 'POST'
    path: string
  }
  requiredInput: string[]
  payload: Record<string, unknown>
}

export type SiteForgeDirectorJob = {
  id: string
  domain: string
  lifecycleStatus: string
  statusReason: string | null
  stage: string
  progress: number
  currentStep: string
  attemptCount: number
  maxAttempts: number
  cancelRequested: boolean
  retryAt: string | null
  errorMessage: string | null
  failureCode: string | null
  failureReason: string | null
  failedCheckpoint: string | null
  retryable: boolean
  createdAt: string
  updatedAt: string
}

export type SiteForgeDirectorDecision = {
  id: string
  jobId: string
  domain: string
  actionType: string
  proposalDecisionStatus: string
  executionStatus: string
  policyReason: string | null
  confidenceScore: number | null
  proposedAt: string
  requestPayload: unknown
  executionPayload: unknown
}

export type SiteForgeDirectorSnapshot = {
  schemaVersion: 1
  generatedAt: string
  identity: {
    websiteId: string
    propertyId: string
    orgId: string
  }
  stage: {
    key: SiteForgeDirectorStage
    label: string
    status: 'idle' | 'active' | 'blocked' | 'ready'
    detail: string
  }
  blockers: SiteForgeDirectorBlocker[]
  collaboration: {
    account: {
      orgId: string
      propertyId: string
      websiteId: string
    }
    brief: {
      id: string
      version: number
      status: string
      contentHash: string
      contradictionCount: number
      onboardingSnapshotId: string | null
      onboardingSnapshotHash: string | null
      brandAssetId: string | null
      brandContractHash: string | null
    } | null
    direction: {
      id: string
      version: number
      status: string
      contentHash: string
      briefVersionId: string
      selectedDirectionId: string | null
      selectedDirectionName: string | null
      selectedDirectionHash: string | null
    } | null
  }
  plan: {
    id: string | null
    status: string | null
    revision: number | null
    versionId: string | null
    contentHash: string | null
    readiness: unknown
    confirmedAt: string | null
  }
  artifact: {
    current: SiteForgeArtifactIdentity
    preview: {
      url: string | null
      artifactId: string | null
      contentHash: string | null
      certifiedAt: string | null
      exact: boolean
    }
    staging: {
      url: string | null
      targetId: string | null
      artifactId: string | null
      contentHash: string | null
      certifiedAt: string | null
      exact: boolean
      latestDeployment: {
        id: string
        status: string
        artifactId: string
        contentHash: string
        remoteManifestHash: string | null
        certifiedAt: string | null
        failureCode: string | null
        failurePhase: string | null
      } | null
    }
    production: {
      url: string | null
      targetId: string | null
      artifactId: string | null
      contentHash: string | null
      certifiedAt: string | null
      exact: boolean
      latestDeployment: {
        id: string
        status: string
        artifactId: string
        contentHash: string
        remoteManifestHash: string | null
        certifiedAt: string | null
        failureCode: string | null
        failurePhase: string | null
      } | null
    }
  }
  pendingDecisions: SiteForgeDirectorDecision[]
  jobs: SiteForgeDirectorJob[]
  certification: {
    preview: SiteForgeCertificationPosture | null
    staging: SiteForgeCertificationPosture | null
    production: SiteForgeCertificationPosture | null
  }
  release: {
    id: string | null
    version: number | null
    state: string | null
    artifactId: string | null
    contentHash: string | null
    rollbackArtifactId: string | null
    rollbackContentHash: string | null
    approvalExpiresAt: string | null
    approvedAt: string | null
    promotedAt: string | null
    liveAt: string | null
    failureCode: string | null
    failureMessage: string | null
  }
  production: {
    status: 'not_live' | 'uncertified' | 'healthy' | 'degraded' | 'unknown'
    lastHealthRun: {
      id: string
      status: string
      artifactId: string | null
      startedAt: string
      completedAt: string | null
    } | null
    openIncidentCount: number
  }
  recovery: {
    rollbackArtifactId: string | null
    rollbackContentHash: string | null
    backupId: string | null
    latestRestore: {
      id: string
      status: string
      expectedArtifactId: string | null
      expectedContentHash: string
      startedAt: string | null
      completedAt: string | null
    } | null
    incidents: Array<{
      id: string
      severity: string
      status: string
      category: string
      title: string
      summary: string
      createdAt: string
    }>
  }
  autonomy: Array<{
    id: string
    actionScope: string
    mode: string
    frozenAt: string | null
    policyVersion: string
    holdoutPercent: number
  }>
  commands: SiteForgeDirectorCommand[]
}

export type SiteForgeCertificationPosture = {
  id: string
  environment: string
  status: string
  artifactId: string
  policyVersion: string
  reportHash: string
  createdAt: string
  exact: boolean
}
