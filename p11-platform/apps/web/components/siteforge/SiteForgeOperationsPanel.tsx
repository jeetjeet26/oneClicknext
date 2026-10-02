'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { healthAlertDescription } from '@/utils/siteforge/health-alert-state'
import { healthEvidenceState, summarizeHealthChecks } from '@/utils/siteforge/health-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { SiteForgeLaunchTimeline } from './SiteForgeLaunchTimeline'

type Incident = {
  id: string
  category: string
  severity: string
  status: string
  summary: string
  created_at: string
  owner_id?: string | null
  evidence?: { notification?: { state?: string; failureCode?: string } }
}

type Operations = {
  website: {
    property_id: string
    canonical_preview_url: string | null
    canonical_preview_artifact_id: string | null
    canonical_preview_content_hash: string | null
    staging_artifact_id: string | null
    staging_content_hash: string | null
    staging_certified_at: string | null
    production_artifact_id: string | null
    production_content_hash: string | null
    production_url: string | null
    production_certified_at: string | null
    editor_lifecycle_status: string
    wordpress_credential_ref: string | null
    production_target_id: string | null
    target_domain: string | null
    domain_status: string
    ssl_status: string
  }
  releases: Array<{
    id: string
    release_version: number
    state: string
    artifact_id: string
    artifact_content_hash: string
    rollback_artifact_id: string | null
    rollback_content_hash: string | null
    created_at: string
  }>
  certifications: Array<{
    id: string
    environment: string
    status: string
    created_at: string
  }>
  restores: Array<{ id: string; status: string; created_at: string }>
  rollbackHistory: Array<{
    id: string
    version: number
    changes_summary: string | null
    created_at: string
  }>
  productionTarget: {
    id: string
    status: string
    site_url: string | null
    admin_url: string | null
    dashboard_url: string | null
    provider_application_id: string | null
    provider_server_id: string | null
    credential_ref: string | null
  } | null
  productionProvisioningJob: {
    id: string
    lifecycle_status: string
    stage: string
    progress: number
    current_step: string
    error_message: string | null
    workflow_run_id: string | null
    updated_at: string
  } | null
  automaticProductionLaunch: boolean
  browserCertifierConfigured: boolean
}

type IncidentPayload = {
  activeIncidentCount?: number | null
  incidents: Incident[]
  healthRuns: Array<{
    id: string
    status: string
    trigger_type: string
    started_at: string
    completed_at?: string | null
    checks?: Record<string, { state?: string; passed?: boolean; summary?: string }>
    evidence?: { purpose?: string; error?: string }
  }>
  repairs: Array<{
    id: string
    status: string
    repair_type: string
    created_at: string
  }>
}

type PendingConfirmation =
  | 'provision-production'
  | null

export function SiteForgeOperationsPanel({ websiteId }: { websiteId: string }) {
  return <SiteForgeOperationsContent key={websiteId} websiteId={websiteId} />
}

function SiteForgeOperationsContent({ websiteId }: { websiteId: string }) {
  const requestVersion = useRef(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(true)
  const [operations, setOperations] = useState<Operations | null>(null)
  const [incidents, setIncidents] = useState<IncidentPayload | null>(null)
  const [rationale, setRationale] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [targetDomain, setTargetDomain] = useState('')
  const [apexWwwPolicy, setApexWwwPolicy] = useState<
    'apex' | 'www' | 'custom'
  >('custom')
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>(null)

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    setRefreshing(true)
    setLoadError(null)
    try {
    const [operationsResponse, incidentsResponse] = await Promise.all([
      fetch(`/api/siteforge/operations/${websiteId}`, { cache: 'no-store' }),
      fetch(`/api/siteforge/incidents?websiteId=${websiteId}`, {
        cache: 'no-store',
      }),
    ])
    const [operationsData, incidentsData] = await Promise.all([
      operationsResponse.json(),
      incidentsResponse.json(),
    ])
    if (!operationsResponse.ok)
      throw new Error(operationsData.error || 'Operations unavailable')
    if (!incidentsResponse.ok)
      throw new Error(incidentsData.error || 'Incidents unavailable')
    if (version !== requestVersion.current) return
    if (!Array.isArray(incidentsData.incidents) || !Array.isArray(incidentsData.healthRuns) || !Array.isArray(incidentsData.repairs)) throw new Error('Monitoring history response is incomplete')
    setOperations(operationsData)
    setTargetDomain(
      current => current || operationsData.website.target_domain || ''
    )
    if (operationsData.website.target_domain) {
      const domain = String(operationsData.website.target_domain)
      setApexWwwPolicy(
        domain.startsWith('www.')
          ? 'www'
          : domain.split('.').length === 2
            ? 'apex'
            : 'custom'
      )
    }
    setIncidents(incidentsData)
    } catch (error) {
      if (version !== requestVersion.current) return
      setLoadError(error instanceof Error ? error.message : 'Monitoring history unavailable')
      setOperations(null)
      setIncidents(null)
      throw error
    } finally {
      if (version === requestVersion.current) setRefreshing(false)
    }
  }, [websiteId])

  useEffect(() => {
    const versionRef = requestVersion
    void refresh().catch((error) =>
      setMessage(
        error instanceof Error ? error.message : 'Operations unavailable'
      )
    )
    return () => { versionRef.current++ }
  }, [refresh])

  useEffect(() => {
    const status = operations?.productionProvisioningJob?.lifecycle_status
    if (!status || !['queued', 'running', 'retrying'].includes(status)) return
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 3_000)
    return () => window.clearInterval(timer)
  }, [operations?.productionProvisioningJob?.lifecycle_status, refresh])

  async function postAction(
    key: string,
    url: string,
    body: Record<string, unknown>
  ) {
    if (busy) return
    setBusy(key)
    setMessage(null)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Action failed')
      setMessage('Action recorded successfully.')
      await refresh()
      return data as Record<string, unknown>
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed')
    } finally {
      setBusy(null)
    }
    return null
  }

  async function launchCertifiedRelease() {
    if (!operations) return
    const release = operations.releases[0]
    const result = await postAction(
      'owner-launch',
      '/api/siteforge/launch/solo/execute',
      {
        propertyId: operations.website.property_id,
        websiteId,
        ...(release &&
        !['live', 'failed', 'rolled_back'].includes(release.state)
          ? { releaseId: release.id }
          : {}),
      }
    )
    if (result) {
      setMessage(
        result.certificationQueued
          ? 'Launch started. Production certification will complete automatically; failed certification triggers recovery.'
          : 'Launch is already in progress.'
      )
    }
  }

  async function createRollbackRevision() {
    if (rationale.trim().length < 10) {
      setMessage('Enter at least 10 characters of operator rationale.')
      return
    }
    try {
      const previewResponse = await fetch(
        `/api/siteforge/rollback/${websiteId}`
      )
      const preview = await previewResponse.json()
      if (!previewResponse.ok || !preview.canRollback) {
        throw new Error(
          preview.error ||
            preview.message ||
            'No verified rollback is available'
        )
      }
      await postAction('rollback', `/api/siteforge/rollback/${websiteId}`, {
        expectedCurrentArtifactId: preview.currentArtifact.id,
        targetArtifactId: preview.rollbackToArtifactId,
        targetContentHash: preview.rollbackToContentHash,
        decisionReason: rationale.trim(),
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Rollback failed')
    }
  }

  async function submitProductionProvisioning() {
    const result = await postAction(
      'provision-production',
      `/api/siteforge/provision-production/${websiteId}`,
      {}
    )
    if (result) {
      setMessage(
        'Production WordPress provisioning started. Progress will update automatically.'
      )
    }
  }

  function provisionProductionWordPress() {
    setPendingConfirmation('provision-production')
  }

  async function confirmPendingAction() {
    const action = pendingConfirmation
    if (!action || busy) return
    setPendingConfirmation(null)
    await submitProductionProvisioning()
  }

  async function saveTargetDomain() {
    if (!targetDomain.trim()) {
      setMessage('Enter the production domain first.')
      return
    }
    await postAction('save-domain', `/api/siteforge/domains/${websiteId}`, {
      targetDomain: targetDomain.trim(),
      apexWwwPolicy,
    })
  }

  const activeIncidents =
    incidents?.incidents.filter((incident) => incident.status !== 'resolved') ||
    []
  const canCertify =
    operations?.website.staging_certified_at &&
    operations.website.staging_artifact_id &&
    operations.website.staging_content_hash
  const latestRelease = operations?.releases[0]
  const latestProductionQa = operations?.certifications.find(
    (certification) => certification.environment === 'production'
  )
  const confirmationCopy = {
    title: 'Provision production WordPress?',
    description:
      'This creates a billable Cloudways application and cannot be safely duplicated.',
    confirmLabel: 'Provision application',
  }

  const latestHealth = incidents?.healthRuns[0]
  const counts = summarizeHealthChecks(latestHealth?.checks || {})
  const healthLabel = !latestHealth ? 'No recorded run'
    : latestHealth.status === 'running' ? 'Checking…'
      : latestHealth.status === 'failed' ? 'Check could not complete'
        : counts.failed ? 'Needs attention'
          : counts.unobservable || !counts.healthy ? 'Evidence incomplete'
            : 'Verified checks passed'

  if (!operations || !incidents) return (
    <Card>
      <CardHeader><CardTitle className="text-base">Production operations</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p role={loadError ? 'alert' : 'status'}>
          {loadError ? `Monitoring history unavailable. ${loadError}` : 'Loading monitoring history…'}
        </p>
        <p className="text-sm text-muted-foreground">{loadError ? 'Current incident counts and health have not been verified.' : 'Waiting for saved incident and health records.'}</p>
        <Button variant="outline" disabled={refreshing} onClick={() => void refresh().catch(() => undefined)}>
          {refreshing ? 'Loading…' : 'Retry loading history'}
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <>
      <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Production operations</CardTitle>
          <Badge variant="outline">Owner launch · exact release</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Lifecycle</p>
            <p className="font-medium">
              {operations?.website.editor_lifecycle_status || 'Loading…'}
            </p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Browser QA</p>
            <p className="font-medium">
              {latestProductionQa
                ? latestProductionQa.status === 'passed'
                  ? 'Passed'
                  : 'Failed · recovery required'
                : 'Required before live'}
            </p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Incidents</p>
            <p className="font-medium">{incidents.activeIncidentCount ?? activeIncidents.length} active</p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Latest health</p>
            <p className="font-medium">
              {healthLabel}
            </p>
          </div>
        </div>

        <section className="space-y-2 rounded border p-4" aria-label="Monitoring evidence">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Monitoring evidence</p>
            <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh().catch(() => undefined)}>
              {refreshing ? 'Refreshing…' : 'Refresh history'}
            </Button>
          </div>
          {latestHealth ? <>
            <p className="text-sm text-muted-foreground">
              Target: {latestHealth.evidence?.purpose || 'Unknown'} · Last check: {new Date(latestHealth.completed_at || latestHealth.started_at).toLocaleString()}
            </p>
            <p className="text-sm">{counts.healthy} verified · {counts.failed} failed · {counts.unobservable} unavailable · {counts.not_configured} not applicable</p>
            {latestHealth.evidence?.error ? <p role="alert" className="text-sm">{latestHealth.evidence.error}</p> : null}
            <p className="text-sm text-muted-foreground">Checks cover the homepage and up to 10 linked or declared pages. HTML checks exclude feeds. Form markup does not verify inquiry delivery.</p>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Check details</summary>
              <ul className="mt-3 space-y-3">
                {Object.entries(latestHealth.checks || {}).map(([name, check]) => (
                  <li key={name} className="break-words">
                    <span className="font-medium">{name.replaceAll('_', ' ')}</span> · {({ healthy: 'Verified', failed: 'Failed', unobservable: 'Unavailable', not_configured: 'Not applicable' })[healthEvidenceState(check)]}
                    <p className="text-muted-foreground">{check.summary || 'No check summary recorded.'}</p>
                  </li>
                ))}
              </ul>
            </details>
          </> : <p className="text-sm text-muted-foreground">No health run has been recorded. This does not establish that the website is healthy.</p>}
        </section>

        <section
          className="space-y-3 rounded border p-4"
          aria-labelledby="production-wordpress-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p id="production-wordpress-heading" className="font-medium">
                Production WordPress
              </p>
              <p className="text-sm text-muted-foreground">
                Dedicated Cloudways parent application for this property.
              </p>
            </div>
            <Badge
              variant={
                operations?.productionTarget?.status === 'ready'
                  ? 'success'
                  : 'outline'
              }
            >
              {operations?.productionTarget?.status ||
                (operations?.website.wordpress_credential_ref
                  ? 'Linked'
                  : 'Not provisioned')}
            </Badge>
          </div>
          {operations?.productionProvisioningJob &&
          ['queued', 'running', 'retrying', 'failed'].includes(
            operations.productionProvisioningJob.lifecycle_status
          ) ? (
            <div className="rounded bg-muted/50 p-3 text-sm">
              <p className="font-medium">
                {operations.productionProvisioningJob.current_step}
              </p>
              <p className="text-muted-foreground">
                {operations.productionProvisioningJob.progress}% ·{' '}
                {operations.productionProvisioningJob.lifecycle_status}
              </p>
              {operations.productionProvisioningJob.error_message ? (
                <p role="alert" className="mt-1 text-destructive">
                  {operations.productionProvisioningJob.error_message}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!operations?.website.wordpress_credential_ref ? (
              <Button
                size="sm"
                disabled={
                  Boolean(busy) ||
                  ['queued', 'running', 'retrying'].includes(
                    operations?.productionProvisioningJob?.lifecycle_status || ''
                  )
                }
                onClick={() => void provisionProductionWordPress()}
              >
                {busy === 'provision-production'
                  ? 'Starting…'
                  : 'Provision production WordPress'}
              </Button>
            ) : null}
            {operations?.productionTarget?.site_url ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={operations.productionTarget.site_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open production WordPress
                </a>
              </Button>
            ) : null}
            {operations?.productionTarget?.admin_url ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={operations.productionTarget.admin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Production wp-admin
                </a>
              </Button>
            ) : null}
            {operations?.productionTarget?.dashboard_url ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={operations.productionTarget.dashboard_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Cloudways application
                </a>
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
            <label className="min-w-0 flex-1 text-sm">
              Production domain
              <input
                value={targetDomain}
                onChange={(event) => setTargetDomain(event.target.value)}
                placeholder="www.example.com"
                className="mt-1 w-full rounded border bg-background px-3 py-2"
              />
            </label>
            <label className="text-sm">
              Apex / WWW policy
              <select
                value={apexWwwPolicy}
                onChange={event =>
                  setApexWwwPolicy(
                    event.target.value as 'apex' | 'www' | 'custom'
                  )
                }
                className="mt-1 w-full rounded border bg-background px-3 py-2"
              >
                <option value="apex">Apex canonical</option>
                <option value="www">WWW canonical</option>
                <option value="custom">Custom host only</option>
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              className="self-end"
              disabled={!targetDomain.trim() || Boolean(busy)}
              onClick={() => void saveTargetDomain()}
            >
              Save domain
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Saving performs a read-only provider inventory and persists the
            rollback manifest. Cutover lowers intended TTL to 300 seconds,
            tracks propagation, and keeps production protected until browser
            certification passes.
          </p>
        </section>

        <section className="rounded border p-4" aria-labelledby="owner-launch-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p id="owner-launch-heading" className="font-medium">
                Release ready to launch
              </p>
              <p className="text-sm text-muted-foreground">
                Exact canonical WordPress preview and staging certification are
                preserved. Launch binds the staged artifact, brand and plan
                policy, production domain, and rollback identity.
              </p>
            </div>
            <Button
              disabled={
                !canCertify ||
                !operations?.browserCertifierConfigured ||
                Boolean(busy) ||
                latestRelease?.state === 'live'
              }
              onClick={() => void launchCertifiedRelease()}
            >
              {busy === 'owner-launch' ? 'Launching…' : 'Launch'}
            </Button>
          </div>
          {operations?.website.staging_artifact_id ? (
            <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <p>
                Release:{' '}
                {latestRelease
                  ? `v${latestRelease.release_version}`
                  : 'new certified release'}
              </p>
              <p>
                Artifact:{' '}
                <span className="font-mono">
                  {operations.website.staging_artifact_id}
                </span>
              </p>
              <p>
                Staging certified:{' '}
                {operations.website.staging_certified_at
                  ? new Date(
                      operations.website.staging_certified_at
                    ).toLocaleString()
                  : 'not yet'}
              </p>
              <p>
                Rollback:{' '}
                {operations.website.production_artifact_id
                  ? 'certified production revision'
                  : 'pre-promotion provider backup'}
              </p>
            </div>
          ) : null}
        </section>

        <Textarea
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Rationale for recovery, incident repair, or rollback…"
          aria-label="Recovery operation rationale"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={rationale.trim().length < 10 || Boolean(busy)}
            onClick={() =>
              void postAction(
                'restore',
                `/api/siteforge/operations/${websiteId}`,
                {
                  action: 'request_restore',
                  rationale: rationale.trim(),
                }
              )
            }
          >
            Request supervised restore
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={rationale.trim().length < 10 || Boolean(busy)}
            onClick={() => void createRollbackRevision()}
          >
            Create rollback revision
          </Button>
          {operations?.website.production_url ? (
            <Button size="sm" variant="outline" asChild>
              <a
                href={operations.website.production_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open production
              </a>
            </Button>
          ) : null}
        </div>
        {latestRelease?.state === 'promoted' &&
        !operations?.browserCertifierConfigured ? (
          <p role="alert" className="text-sm text-amber-700">
            Production cannot become live until the public browser certifier is
            configured.
          </p>
        ) : null}

        {activeIncidents.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Active incidents</p>
            {(incidents.activeIncidentCount || 0) > activeIncidents.length ? <p className="text-sm text-muted-foreground">Showing the latest {activeIncidents.length} of {incidents.activeIncidentCount} active incidents. Older records remain saved.</p> : null}
            {activeIncidents.map((incident) => (
              <div
                key={incident.id}
                className="flex flex-wrap items-center gap-2 rounded border p-3 text-sm"
              >
                <Badge
                  variant={
                    incident.severity === 'critical' ? 'destructive' : 'outline'
                  }
                >
                  {incident.severity}
                </Badge>
                <span className="font-medium">{incident.category.replaceAll('_', ' ')}</span>
                <span className="text-muted-foreground">{incident.owner_id ? 'Assigned' : 'Unassigned'} · {incident.status}</span>
                {incident.evidence?.notification?.state ? <span className="basis-full text-xs text-muted-foreground">{
                  healthAlertDescription(incident.evidence.notification)
                }</span> : null}
                <span className="min-w-0 basis-full break-words text-muted-foreground sm:basis-auto sm:flex-1">
                  {incident.summary}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rationale.trim().length < 5 || Boolean(busy)}
                  onClick={() =>
                    void postAction(
                      `ack-${incident.id}`,
                      `/api/siteforge/incidents/${incident.id}/acknowledge`,
                      { rationale: rationale.trim() }
                    )
                  }
                >
                  Acknowledge
                </Button>
                <Button
                  size="sm"
                  disabled={rationale.trim().length < 10 || Boolean(busy)}
                  onClick={() =>
                    void postAction(
                      `repair-${incident.id}`,
                      `/api/siteforge/incidents/${incident.id}/repair`,
                      { rationale: rationale.trim(), confirmOnePass: true }
                    )
                  }
                >
                  One-pass repair
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 text-sm md:grid-cols-3">
          <History
            title="Launch / certification"
            rows={[
              ...(operations?.releases || []).map(
                (item) => `Release ${item.release_version}: ${item.state}`
              ),
              ...(operations?.certifications || []).map(
                (item) => `${item.environment}: ${item.status}`
              ),
            ]}
          />
          <History
            title="Restore / rollback"
            rows={[
              ...(operations?.restores || []).map(
                (item) => `Restore: ${item.status}`
              ),
              ...(operations?.rollbackHistory || []).map(
                (item) => `Rollback revision v${item.version}`
              ),
            ]}
          />
          <History
            title="Repairs"
            rows={(incidents?.repairs || []).map(
              (item) => `${item.repair_type}: ${item.status}`
            )}
          />
        </div>
        {message ? (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        ) : null}
        {operations ? (
          <SiteForgeLaunchTimeline
            websiteId={websiteId}
            propertyId={operations.website.property_id}
          />
        ) : null}
      </CardContent>
      </Card>
      <Dialog
        open={pendingConfirmation !== null}
        onOpenChange={open => {
          if (!open && !busy) setPendingConfirmation(null)
        }}
      >
        <DialogContent role="alertdialog" aria-labelledby="siteforge-confirm-title">
          <DialogHeader>
            <DialogTitle id="siteforge-confirm-title">
              {confirmationCopy.title}
            </DialogTitle>
            <DialogDescription>{confirmationCopy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(busy)}
              onClick={() => setPendingConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={Boolean(busy)}
              onClick={() => void confirmPendingAction()}
            >
              {busy ? 'Working…' : confirmationCopy.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function History({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded border p-3">
      <p className="font-medium">{title}</p>
      {rows.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {rows.slice(0, 6).map((row, index) => (
            <li key={`${row}-${index}`}>{row}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No history yet.</p>
      )}
    </div>
  )
}
