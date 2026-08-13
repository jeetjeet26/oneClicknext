'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import type {
  SiteForgeDirectorCommand,
  SiteForgeDirectorSnapshot,
} from '@/utils/siteforge/director/contracts'
import {
  SiteForgeDeliveryWorkspace,
  SiteForgeOwnershipWorkspace,
  SiteForgePlanWorkspace,
  SiteForgeReviewWorkspace,
} from './SiteForgeWebDirectorWorkspaces'

export const SITEFORGE_DIRECTOR_AREAS = [
  { value: 'overview', label: 'Overview' },
  { value: 'plan', label: 'Plan' },
  { value: 'review', label: 'Build & review' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'ownership', label: 'Ownership & reporting' },
  { value: 'activity', label: 'Jobs & decisions' },
  { value: 'control', label: 'Control & recovery' },
] as const

type SiteForgeDirectorArea = (typeof SITEFORGE_DIRECTOR_AREAS)[number]['value']

export function normalizeSiteForgeDirectorArea(
  value: string | null | undefined,
): SiteForgeDirectorArea {
  return SITEFORGE_DIRECTOR_AREAS.some(area => area.value === value)
    ? (value as SiteForgeDirectorArea)
    : 'overview'
}

function directorPanelProps(value: string) {
  return {
    id: `siteforge-director-${value}-panel`,
    role: 'tabpanel' as const,
    'aria-labelledby': `siteforge-director-${value}-tab`,
    tabIndex: 0,
  }
}

function compactIdentity(value: string | null): string {
  if (!value) return 'Not set'
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
}

function formatTime(value: string | null): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function statusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' {
  if (
    ['ready', 'passed', 'healthy', 'succeeded', 'certified', 'live'].includes(
      status
    )
  ) {
    return 'success'
  }
  if (
    ['blocked', 'failed', 'degraded', 'critical', 'cancelled'].includes(status)
  ) {
    return 'destructive'
  }
  if (['active', 'running', 'retrying', 'queued'].includes(status)) {
    return 'default'
  }
  return 'secondary'
}

function IdentityRow({
  label,
  value,
}: {
  label: string
  value: string | number | null
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2 last:border-0 dark:border-gray-700">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="max-w-[65%] break-all text-right font-mono text-xs text-gray-900 dark:text-gray-100">
        {value ?? 'Not set'}
      </span>
    </div>
  )
}

export function SiteForgeDirector({
  websiteId,
  initialSnapshot,
  initialArea,
}: {
  websiteId: string
  initialSnapshot?: SiteForgeDirectorSnapshot | null
  initialArea?: string | null
}) {
  const [snapshot, setSnapshot] = useState<SiteForgeDirectorSnapshot | null>(
    initialSnapshot || null
  )
  const [tab, setTab] = useState(() =>
    normalizeSiteForgeDirectorArea(initialArea)
  )
  const [loading, setLoading] = useState(!initialSnapshot)
  const [refreshing, setRefreshing] = useState(false)
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasActiveJobs =
    snapshot?.jobs.some(job =>
      ['queued', 'running', 'retrying'].includes(job.lifecycleStatus)
    ) ?? false

  const loadSnapshot = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true)
      else setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/siteforge/director/${websiteId}`, {
          cache: 'no-store',
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(body.error || 'Failed to load SiteForge Director')
        }
        setSnapshot(body as SiteForgeDirectorSnapshot)
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Failed to load SiteForge Director'
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [websiteId]
  )

  useEffect(() => {
    if (initialSnapshot) return
    void loadSnapshot()
  }, [initialSnapshot, loadSnapshot])

  useEffect(() => {
    if (!hasActiveJobs) return
    const timer = window.setInterval(() => void loadSnapshot(true), 10_000)
    return () => window.clearInterval(timer)
  }, [hasActiveJobs, loadSnapshot])

  async function executeCommand(command: SiteForgeDirectorCommand) {
    if (
      !command.available ||
      command.requiredInput.length > 0 ||
      runningCommandId
    ) {
      return
    }
    if (
      command.risk === 'critical' &&
      !window.confirm(
        `${command.label} uses the existing supervised SiteForge workflow. Continue?`
      )
    ) {
      return
    }
    setRunningCommandId(command.id)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(command.target.path, {
        method: command.target.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || `${command.label} failed`)
      }
      setMessage(`${command.label} started through the existing SiteForge path.`)
      await loadSnapshot(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${command.label} failed`)
    } finally {
      setRunningCommandId(null)
    }
  }

  if (loading && !snapshot) {
    return (
      <Card aria-busy="true">
        <CardContent className="flex min-h-48 items-center justify-center gap-2 pt-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Assembling tenant-safe Director snapshot…
        </CardContent>
      </Card>
    )
  }

  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>SiteForge Director unavailable</CardTitle>
          <CardDescription>{error || 'No snapshot was returned.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void loadSnapshot()}>Try again</Button>
        </CardContent>
      </Card>
    )
  }

  const current = snapshot.artifact.current
  const availableCommands = snapshot.commands.filter(command => command.available)

  return (
    <section className="space-y-4" aria-labelledby="siteforge-director-title">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1
              id="siteforge-director-title"
              className="text-2xl font-semibold text-gray-950 dark:text-white"
            >
              Web Director
            </h1>
            <Badge variant={statusVariant(snapshot.stage.status)}>
              {snapshot.stage.label}
            </Badge>
            <Badge variant={statusVariant(snapshot.stage.status)}>
              {snapshot.stage.status}
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-600 dark:text-gray-300">
            {snapshot.stage.detail}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadSnapshot(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      {error ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {message ? (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          role="status"
        >
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Current stage</CardDescription>
            <CardTitle>{snapshot.stage.label}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Blocking issues</CardDescription>
            <CardTitle>
              {
                snapshot.blockers.filter(
                  blocker => blocker.severity === 'blocker'
                ).length
              }
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Pending decisions</CardDescription>
            <CardTitle>{snapshot.pendingDecisions.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Production posture</CardDescription>
            <CardTitle className="capitalize">
              {snapshot.production.status.replaceAll('_', ' ')}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs
        value={tab}
        onValueChange={value => setTab(normalizeSiteForgeDirectorArea(value))}
      >
        <TabsList
          className="h-auto w-full justify-start overflow-x-auto"
          role="tablist"
          aria-label="Web Director workspaces"
        >
          {SITEFORGE_DIRECTOR_AREAS.map(area => (
            <TabsTrigger
              key={area.value}
              id={`siteforge-director-${area.value}-tab`}
              value={area.value}
              role="tab"
              aria-selected={tab === area.value}
              aria-controls={`siteforge-director-${area.value}-panel`}
            >
              {area.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value="overview"
          className="space-y-4"
          {...directorPanelProps('overview')}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Account and collaboration state</CardTitle>
                <CardDescription>
                  Tenant identity and exact brief/direction records.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IdentityRow
                  label="Organization"
                  value={snapshot.collaboration.account.orgId}
                />
                <IdentityRow
                  label="Property"
                  value={snapshot.collaboration.account.propertyId}
                />
                <IdentityRow
                  label="Website"
                  value={snapshot.collaboration.account.websiteId}
                />
                <IdentityRow
                  label="Brief"
                  value={
                    snapshot.collaboration.brief
                      ? `v${snapshot.collaboration.brief.version} · ${snapshot.collaboration.brief.status}`
                      : null
                  }
                />
                <IdentityRow
                  label="Brief hash"
                  value={snapshot.collaboration.brief?.contentHash || null}
                />
                <IdentityRow
                  label="Onboarding snapshot"
                  value={
                    snapshot.collaboration.brief?.onboardingSnapshotId || null
                  }
                />
                <IdentityRow
                  label="Onboarding hash"
                  value={
                    snapshot.collaboration.brief?.onboardingSnapshotHash || null
                  }
                />
                <IdentityRow
                  label="BrandForge asset"
                  value={snapshot.collaboration.brief?.brandAssetId || null}
                />
                <IdentityRow
                  label="BrandForge hash"
                  value={
                    snapshot.collaboration.brief?.brandContractHash || null
                  }
                />
                <IdentityRow
                  label="Direction"
                  value={
                    snapshot.collaboration.direction
                      ? `v${snapshot.collaboration.direction.version} · ${snapshot.collaboration.direction.status}`
                      : null
                  }
                />
                <IdentityRow
                  label="Selected direction"
                  value={
                    snapshot.collaboration.direction?.selectedDirectionName ||
                    null
                  }
                />
                <IdentityRow
                  label="Selected hash"
                  value={
                    snapshot.collaboration.direction?.selectedDirectionHash ||
                    null
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  Exact artifact identity
                </CardTitle>
                <CardDescription>
                  Immutable identifiers used by preview, certification, and release.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IdentityRow label="Artifact" value={current.artifactId} />
                <IdentityRow label="Version" value={current.version} />
                <IdentityRow label="Content hash" value={current.contentHash} />
                <IdentityRow
                  label="Asset manifest"
                  value={current.assetManifestHash}
                />
                <IdentityRow
                  label="Base theme"
                  value={current.baseThemePackageSha256}
                />
                <IdentityRow
                  label="Runtime contract"
                  value={current.runtimeContractVersion}
                />
                <IdentityRow
                  label="Runtime package"
                  value={current.runtimePackageSha256}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Environment binding</CardTitle>
                <CardDescription>
                  Exact means artifact ID and content hash match the current revision.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  snapshot.artifact.preview,
                  snapshot.artifact.staging,
                  snapshot.artifact.production,
                ].map((environment, index) => {
                  const label = ['Preview', 'Staging', 'Production'][index]
                  return (
                    <div
                      key={label}
                      className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {label}
                        </span>
                        <Badge variant={environment.exact ? 'success' : 'secondary'}>
                          {environment.exact ? 'Exact' : 'Not exact'}
                        </Badge>
                      </div>
                      <p className="mt-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {compactIdentity(environment.artifactId)} ·{' '}
                        {compactIdentity(environment.contentHash)}
                      </p>
                      {environment.url ? (
                        <a
                          className="mt-2 inline-flex items-center text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                          href={environment.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open {label.toLowerCase()}
                          <ExternalLink
                            className="ml-1 h-3 w-3"
                            aria-hidden="true"
                          />
                        </a>
                      ) : null}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                Blockers and warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              {snapshot.blockers.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  No derived blockers.
                </div>
              ) : (
                <ul className="space-y-2">
                  {snapshot.blockers.map(blocker => (
                    <li
                      key={`${blocker.code}:${blocker.entityId || ''}`}
                      className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {blocker.message}
                        </p>
                        <p className="mt-1 font-mono text-xs text-gray-500">
                          {blocker.code}
                        </p>
                      </div>
                      <Badge
                        variant={
                          blocker.severity === 'blocker'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {blocker.severity}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plan" {...directorPanelProps('plan')}>
          <SiteForgePlanWorkspace
            websiteId={websiteId}
            propertyId={snapshot.identity.propertyId}
            onSnapshotChanged={() => void loadSnapshot(true)}
          />
        </TabsContent>

        <TabsContent value="review" {...directorPanelProps('review')}>
          <SiteForgeReviewWorkspace
            websiteId={websiteId}
            propertyId={snapshot.identity.propertyId}
            currentArtifact={snapshot.artifact.current}
            previewCertification={snapshot.certification.preview}
          />
        </TabsContent>

        <TabsContent value="delivery" {...directorPanelProps('delivery')}>
          <SiteForgeDeliveryWorkspace
            websiteId={websiteId}
            propertyId={snapshot.identity.propertyId}
          />
        </TabsContent>

        <TabsContent value="ownership" {...directorPanelProps('ownership')}>
          <SiteForgeOwnershipWorkspace
            websiteId={websiteId}
            propertyId={snapshot.identity.propertyId}
          />
        </TabsContent>

        <TabsContent
          value="activity"
          className="space-y-4"
          {...directorPanelProps('activity')}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" aria-hidden="true" />
                Shared jobs
              </CardTitle>
              <CardDescription>
                Existing shared workflows only; Director creates no queue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshot.jobs.length === 0 ? (
                <p className="text-sm text-gray-500">No related jobs.</p>
              ) : (
                <ul className="space-y-2">
                  {snapshot.jobs.map(job => (
                    <li
                      key={job.id}
                      className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs text-gray-700 dark:text-gray-200">
                          {job.domain}
                        </span>
                        <Badge variant={statusVariant(job.lifecycleStatus)}>
                          {job.lifecycleStatus}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-gray-900 dark:text-white">
                        {job.currentStep}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {job.progress}% · attempt {job.attemptCount}/
                        {job.maxAttempts}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pending decisions</CardTitle>
            </CardHeader>
            <CardContent>
              {snapshot.pendingDecisions.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No SiteForge decision is pending.
                </p>
              ) : (
                <ul className="space-y-2">
                  {snapshot.pendingDecisions.map(decision => (
                    <li
                      key={decision.id}
                      className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs">
                          {decision.actionType}
                        </span>
                        <Badge variant="default">approval required</Badge>
                      </div>
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                        {decision.policyReason || 'No policy rationale recorded.'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="control"
          className="space-y-4"
          {...directorPanelProps('control')}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Release and recovery</CardTitle>
              </CardHeader>
              <CardContent>
                <IdentityRow label="Release" value={snapshot.release.id} />
                <IdentityRow label="State" value={snapshot.release.state} />
                <IdentityRow
                  label="Release artifact"
                  value={snapshot.release.artifactId}
                />
                <IdentityRow
                  label="Release hash"
                  value={snapshot.release.contentHash}
                />
                <IdentityRow
                  label="Rollback artifact"
                  value={snapshot.recovery.rollbackArtifactId}
                />
                <IdentityRow
                  label="Rollback hash"
                  value={snapshot.recovery.rollbackContentHash}
                />
                <IdentityRow
                  label="Backup"
                  value={snapshot.recovery.backupId}
                />
                <IdentityRow
                  label="Latest restore"
                  value={snapshot.recovery.latestRestore?.status || null}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Production</CardTitle>
              </CardHeader>
              <CardContent>
                <IdentityRow
                  label="Posture"
                  value={snapshot.production.status}
                />
                <IdentityRow
                  label="Certified"
                  value={formatTime(snapshot.artifact.production.certifiedAt)}
                />
                <IdentityRow
                  label="Last health"
                  value={snapshot.production.lastHealthRun?.status || null}
                />
                <IdentityRow
                  label="Open incidents"
                  value={snapshot.production.openIncidentCount}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TerminalSquare className="h-5 w-5" aria-hidden="true" />
                Typed next commands
              </CardTitle>
              <CardDescription>
                Commands delegate to existing SiteForge routes and services.
                Inputs requiring manager evidence stay explicitly supervised.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {snapshot.commands.map(command => {
                const canRun =
                  command.available && command.requiredInput.length === 0
                return (
                  <div
                    key={command.id}
                    className="flex flex-col justify-between gap-3 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center dark:border-gray-700"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {command.label}
                        </span>
                        <Badge
                          variant={
                            command.available ? 'outline' : 'secondary'
                          }
                        >
                          {command.risk}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {command.available
                          ? command.requiredInput.length
                            ? `Requires: ${command.requiredInput.join(', ')}`
                            : command.description
                          : command.unavailableReason}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={command.risk === 'critical' ? 'outline' : 'default'}
                      disabled={!canRun || Boolean(runningCommandId)}
                      onClick={() => void executeCommand(command)}
                    >
                      {runningCommandId === command.id ? (
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      {canRun ? 'Run' : command.available ? 'Supervised' : 'Unavailable'}
                    </Button>
                  </div>
                )
              })}
              <p className="pt-2 text-xs text-gray-500">
                {availableCommands.length} command
                {availableCommands.length === 1 ? '' : 's'} currently available.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  )
}
