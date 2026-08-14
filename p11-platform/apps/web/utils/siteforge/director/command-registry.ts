import type {
  SiteForgeDirectorCommand,
  SiteForgeDirectorJob,
} from './contracts'

export type SiteForgeDirectorCommandContext = {
  websiteId: string
  propertyId: string
  plan: {
    id: string | null
    status: string | null
    revision: number | null
    contentHash: string | null
  }
  artifact: {
    id: string | null
    contentHash: string | null
    deploymentDecision: string | null
    previewExact: boolean
    stagingTargetId: string | null
    stagingExact: boolean
  }
  release: {
    id: string | null
    state: string | null
    artifactId: string | null
    contentHash: string | null
    rollbackArtifactId: string | null
    rollbackContentHash: string | null
  }
  production: {
    artifactId: string | null
    contentHash: string | null
    certifiedAt: string | null
  }
  jobs: SiteForgeDirectorJob[]
  incidents: Array<{ id: string; status: string }>
}

function command(
  value: Omit<SiteForgeDirectorCommand, 'available' | 'unavailableReason'> & {
    unavailableReason?: string | null
  }
): SiteForgeDirectorCommand {
  return {
    ...value,
    available: !value.unavailableReason,
    unavailableReason: value.unavailableReason || null,
  }
}

export function buildSiteForgeDirectorCommands(
  context: SiteForgeDirectorCommandContext
): SiteForgeDirectorCommand[] {
  const activeJob = context.jobs.find(job =>
    ['queued', 'running', 'retrying'].includes(job.lifecycleStatus)
  )
  const retryableJob = context.jobs.find(
    job =>
      job.lifecycleStatus === 'failed' &&
      !job.cancelRequested &&
      job.retryable &&
      job.attemptCount < job.maxAttempts
  )
  const openIncident = context.incidents.find(
    incident => incident.status === 'open'
  )

  return [
    command({
      id: context.plan.id ? `review-plan:${context.plan.id}` : 'review-plan',
      type: 'review_plan',
      label: 'Review plan',
      description:
        'Use the existing plan decision service to approve, deny, or modify the exact revision.',
      unavailableReason:
        !context.plan.id || context.plan.status !== 'ready_for_review'
          ? 'No plan revision is awaiting review.'
          : null,
      risk: 'supervised',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/plans/${context.plan.id || 'missing'}/decision`,
      },
      requiredInput: ['decisionStatus', 'decisionReason'],
      payload: {
        websiteId: context.websiteId,
        propertyId: context.propertyId,
        expectedRevision: context.plan.revision,
        contentHash: context.plan.contentHash,
      },
    }),
    command({
      id: retryableJob ? `retry-job:${retryableJob.id}` : 'retry-job',
      type: 'retry_job',
      label: 'Retry failed job',
      description:
        'Resume the existing durable workflow using the SiteForge retry route.',
      unavailableReason: retryableJob
        ? null
        : 'No failed SiteForge job is eligible for retry.',
      risk: 'low',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/jobs/${retryableJob?.id || 'missing'}/retry`,
      },
      requiredInput: [],
      payload: {},
    }),
    command({
      id: activeJob ? `cancel-job:${activeJob.id}` : 'cancel-job',
      type: 'cancel_job',
      label: 'Cancel active job',
      description:
        'Cancel the existing durable workflow without creating a parallel state machine.',
      unavailableReason: activeJob ? null : 'No SiteForge job is currently active.',
      risk: 'supervised',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/jobs/${activeJob?.id || 'missing'}/cancel`,
      },
      requiredInput: [],
      payload: {},
    }),
    command({
      id: context.artifact.id
        ? `review-artifact:${context.artifact.id}`
        : 'review-artifact',
      type: 'review_artifact',
      label: 'Review exact preview',
      description:
        'Record the deployment decision through the existing artifact approval service.',
      unavailableReason: !context.artifact.id
        ? 'No immutable artifact exists.'
        : !context.artifact.previewExact
          ? 'The canonical preview does not match the current artifact identity.'
          : context.artifact.deploymentDecision === 'approved'
            ? 'The current artifact is already approved.'
            : null,
      risk: 'supervised',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/artifacts/${context.artifact.id || 'missing'}/decision`,
      },
      requiredInput: ['decisionStatus', 'decisionReason'],
      payload: {
        propertyId: context.propertyId,
        contentHash: context.artifact.contentHash,
      },
    }),
    command({
      id: `provision-staging:${context.websiteId}`,
      type: 'provision_staging',
      label: 'Provision staging',
      description:
        'Provision the existing staging target through the SiteForge staging route.',
      unavailableReason:
        context.artifact.deploymentDecision !== 'approved'
          ? 'Approve the exact current artifact before provisioning staging.'
          : context.artifact.stagingTargetId
            ? 'A staging target is already linked.'
            : null,
      risk: 'supervised',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/staging/provision/${context.websiteId}`,
      },
      requiredInput: [],
      payload: {},
    }),
    command({
      id: `deploy-staging:${context.websiteId}`,
      type: 'deploy_staging',
      label: 'Deploy to staging',
      description:
        'Start the existing artifact deployment workflow for the approved current artifact.',
      unavailableReason:
        context.artifact.deploymentDecision !== 'approved'
          ? 'Approve the exact current artifact before deployment.'
          : !context.artifact.stagingTargetId
            ? 'Provision a staging target first.'
            : context.artifact.stagingExact
              ? 'The exact current artifact is already certified on staging.'
              : activeJob
                ? 'Wait for the active SiteForge job to finish.'
                : null,
      risk: 'supervised',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/deploy/${context.websiteId}`,
      },
      requiredInput: [],
      payload: {},
    }),
    command({
      id: `prepare-launch:${context.websiteId}`,
      type: 'prepare_launch',
      label: 'Prepare release',
      description:
        'Bind the certified staging artifact and rollback identity through the launch service.',
      unavailableReason: !context.artifact.stagingExact
        ? 'The exact current artifact is not certified on staging.'
        : context.release.id &&
            !['live', 'failed', 'rolled_back'].includes(
              context.release.state || ''
            )
          ? 'A release is already active.'
          : null,
      risk: 'critical',
      target: {
        kind: 'route',
        method: 'POST',
        path: '/api/siteforge/launch/prepare',
      },
      requiredInput: [],
      payload: {
        propertyId: context.propertyId,
        websiteId: context.websiteId,
        artifactId: context.artifact.id,
        contentHash: context.artifact.contentHash,
        rollbackArtifactId: context.production.artifactId,
        rollbackContentHash: context.production.contentHash,
      },
    }),
    command({
      id: context.release.id
        ? `approve-launch:${context.release.id}`
        : 'approve-launch',
      type: 'approve_launch',
      label: 'Approve release',
      description:
        'Issue the one-use promotion token through the dedicated manager approval route.',
      unavailableReason:
        !context.release.id || context.release.state !== 'certified'
          ? 'No certified release is awaiting manager approval.'
          : null,
      risk: 'critical',
      target: {
        kind: 'route',
        method: 'POST',
        path: '/api/siteforge/launch/approve',
      },
      requiredInput: [
        'rationale',
        'legalSnapshot',
        'expiresAt',
        'firstLaunchAcknowledged',
      ],
      payload: {
        propertyId: context.propertyId,
        releaseId: context.release.id,
        artifactId: context.release.artifactId,
        contentHash: context.release.contentHash,
        rollbackArtifactId: context.release.rollbackArtifactId,
        rollbackContentHash: context.release.rollbackContentHash,
      },
    }),
    command({
      id: context.release.id
        ? `promote-launch:${context.release.id}`
        : 'promote-launch',
      type: 'promote_launch',
      label: 'Promote production',
      description:
        'Perform the final human-owned launch through the one-use token route.',
      unavailableReason:
        !context.release.id || context.release.state !== 'launch_approved'
          ? 'No launch-approved release is ready for promotion.'
          : null,
      risk: 'critical',
      target: {
        kind: 'route',
        method: 'POST',
        path: '/api/siteforge/launch/promote',
      },
      requiredInput: ['promotionToken'],
      payload: {
        propertyId: context.propertyId,
        releaseId: context.release.id,
      },
    }),
    command({
      id: `certify-production:${context.websiteId}`,
      type: 'certify_production',
      label: 'Certify production',
      description:
        'Run the existing production certification workflow against the exact promoted artifact.',
      unavailableReason:
        !context.release.id ||
        !['promoted', 'production_certified', 'live'].includes(
          context.release.state || ''
        ) ||
        !context.production.artifactId
          ? 'No promoted production artifact is ready for certification.'
          : context.production.certifiedAt
            ? 'The production artifact is already certified.'
            : null,
      risk: 'supervised',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/production/${context.websiteId}/certify`,
      },
      requiredInput: [],
      payload: {
        releaseId: context.release.id,
        promotedArtifactId: context.production.artifactId,
        promotedContentHash: context.production.contentHash,
      },
    }),
    command({
      id: openIncident
        ? `acknowledge-incident:${openIncident.id}`
        : 'acknowledge-incident',
      type: 'acknowledge_incident',
      label: 'Acknowledge incident',
      description:
        'Assign the open incident through the existing incident service.',
      unavailableReason: openIncident ? null : 'No open SiteForge incident exists.',
      risk: 'supervised',
      target: {
        kind: 'route',
        method: 'POST',
        path: `/api/siteforge/incidents/${openIncident?.id || 'missing'}/acknowledge`,
      },
      requiredInput: ['rationale'],
      payload: {},
    }),
    command({
      id: context.release.id
        ? `restore-release:${context.release.id}`
        : 'restore-release',
      type: 'restore_release',
      label: 'Restore release',
      description:
        'Use the supervised restore service with either the certified rollback identity or the verified pre-promotion backup for a first launch.',
      unavailableReason:
        !context.release.id ||
        !['promoted', 'production_certified', 'live', 'failed'].includes(
          context.release.state || ''
        )
          ? 'No release with a supervised recovery path exists.'
          : null,
      risk: 'critical',
      target: {
        kind: 'route',
        method: 'POST',
        path: '/api/siteforge/launch/restore',
      },
      requiredInput: ['rationale'],
      payload: {
        propertyId: context.propertyId,
        releaseId: context.release.id,
      },
    }),
  ]
}
