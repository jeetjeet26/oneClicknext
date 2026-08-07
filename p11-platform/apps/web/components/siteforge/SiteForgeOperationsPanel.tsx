'use client'

import { useCallback, useEffect, useState } from 'react'
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

type Incident = {
  id: string
  category: string
  severity: string
  status: string
  summary: string
  created_at: string
}

type Operations = {
  website: {
    property_id: string
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
  automaticProductionLaunch: false
  browserCertifierConfigured: boolean
}

type IncidentPayload = {
  incidents: Incident[]
  healthRuns: Array<{
    id: string
    status: string
    trigger_type: string
    started_at: string
  }>
  repairs: Array<{
    id: string
    status: string
    repair_type: string
    created_at: string
  }>
}

type PendingConfirmation =
  | 'prepare-first-launch'
  | 'approve-first-launch'
  | 'provision-production'
  | null

export function SiteForgeOperationsPanel({ websiteId }: { websiteId: string }) {
  const [operations, setOperations] = useState<Operations | null>(null)
  const [incidents, setIncidents] = useState<IncidentPayload | null>(null)
  const [rationale, setRationale] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [legalRightsConfirmed, setLegalRightsConfirmed] = useState(false)
  const [promotionToken, setPromotionToken] = useState('')
  const [manualOperationId, setManualOperationId] = useState('')
  const [manualBackupId, setManualBackupId] = useState('')
  const [targetDomain, setTargetDomain] = useState('')
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>(null)

  const refresh = useCallback(async () => {
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
    setOperations(operationsData)
    setTargetDomain((current) => current || operationsData.website.target_domain || '')
    setIncidents(incidentsData)
  }, [websiteId])

  useEffect(() => {
    void refresh().catch((error) =>
      setMessage(
        error instanceof Error ? error.message : 'Operations unavailable'
      )
    )
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

  async function submitLaunchPreparation(
    rollback:
      | { artifactId: string; contentHash: string }
      | null
  ) {
    if (
      !operations?.website.staging_artifact_id ||
      !operations.website.staging_content_hash
    ) {
      return
    }
    await postAction('prepare-launch', '/api/siteforge/launch/prepare', {
      propertyId: operations.website.property_id,
      websiteId,
      artifactId: operations.website.staging_artifact_id,
      contentHash: operations.website.staging_content_hash,
      ...(rollback
        ? {
            rollbackArtifactId: rollback.artifactId,
            rollbackContentHash: rollback.contentHash,
          }
        : {}),
    })
  }

  async function prepareLaunch() {
    if (
      !operations?.website.staging_artifact_id ||
      !operations.website.staging_content_hash
    ) {
      return
    }
    // Production launch rollback must be the certified production artifact
    // itself; the editor's blueprint rollback preview points at staging
    // revisions and is rejected by the launch service.
    const isFirstLaunch =
      !operations.website.production_artifact_id &&
      !operations.website.production_certified_at
    if (isFirstLaunch) {
      setPendingConfirmation('prepare-first-launch')
      return
    }
    if (
      !operations.website.production_artifact_id ||
      !operations.website.production_content_hash
    ) {
      setMessage(
        'A certified production rollback artifact is required before launch preparation.'
      )
      return
    }
    await submitLaunchPreparation({
      artifactId: operations.website.production_artifact_id,
      contentHash: operations.website.production_content_hash,
    })
  }

  async function submitLaunchApproval(firstLaunchAcknowledged: boolean) {
    const release = operations?.releases[0]
    if (!release || !legalRightsConfirmed || rationale.trim().length < 10)
      return
    const result = await postAction(
      'approve-launch',
      '/api/siteforge/launch/approve',
      {
        propertyId: operations!.website.property_id,
        releaseId: release.id,
        artifactId: release.artifact_id,
        contentHash: release.artifact_content_hash,
        rollbackArtifactId: release.rollback_artifact_id,
        rollbackContentHash: release.rollback_content_hash,
        ...(firstLaunchAcknowledged ? { firstLaunchAcknowledged: true } : {}),
        rationale: rationale.trim(),
        legalRightsSnapshot: {
          confirmed: true,
          confirmedAt: new Date().toISOString(),
          source: 'siteforge-operator-console',
        },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }
    )
    if (typeof result?.promotionToken === 'string') {
      setPromotionToken(result.promotionToken)
      setMessage(
        'Launch approved. Copy or use the one-time promotion token now.'
      )
    }
  }

  async function approveLaunch() {
    const release = operations?.releases[0]
    if (!release || !legalRightsConfirmed || rationale.trim().length < 10)
      return
    if (!release.rollback_artifact_id) {
      setPendingConfirmation('approve-first-launch')
      return
    }
    await submitLaunchApproval(false)
  }

  async function promoteLaunch() {
    const release = operations?.releases[0]
    if (!release || !promotionToken || busy) return
    const body: Record<string, unknown> = {
      propertyId: operations!.website.property_id,
      releaseId: release.id,
      promotionToken,
    }
    if (
      release.state === 'launch_approved' &&
      manualOperationId.trim() &&
      manualBackupId.trim()
    ) {
      body.backupConfirmation = {
        operationId: manualOperationId.trim(),
        backupId: manualBackupId.trim(),
      }
    } else if (manualOperationId.trim()) {
      body.manualConfirmation = { operationId: manualOperationId.trim() }
    }
    setBusy('promote-launch')
    setMessage(null)
    try {
      const response = await fetch('/api/siteforge/launch/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      // The promote service intentionally answers 409 with operator
      // instructions when a Cloudways dashboard confirmation is required.
      if (data?.manualRequired === true) {
        setMessage(
          String(
            data.dashboardAction ||
              'Cloudways requires a manual promotion confirmation.'
          )
        )
        await refresh()
        return
      }
      if (!response.ok) throw new Error(data.error || 'Action failed')
      setManualOperationId('')
      setManualBackupId('')
      setMessage('Action recorded successfully.')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed')
    } finally {
      setBusy(null)
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
    if (action === 'prepare-first-launch') {
      await submitLaunchPreparation(null)
    } else if (action === 'approve-first-launch') {
      await submitLaunchApproval(true)
    } else {
      await submitProductionProvisioning()
    }
  }

  async function saveTargetDomain() {
    if (!targetDomain.trim()) {
      setMessage('Enter the production domain first.')
      return
    }
    await postAction('save-domain', `/api/siteforge/domains/${websiteId}`, {
      targetDomain: targetDomain.trim(),
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
  const activeRelease =
    latestRelease &&
    !['live', 'failed', 'rolled_back'].includes(latestRelease.state)
      ? latestRelease
      : null
  const confirmationCopy =
    pendingConfirmation === 'prepare-first-launch'
      ? {
          title: 'Prepare first production launch?',
          description:
            'No certified production rollback artifact exists yet. Recovery will rely on the pre-promotion Cloudways backup.',
          confirmLabel: 'Prepare release',
        }
      : pendingConfirmation === 'approve-first-launch'
        ? {
            title: 'Approve first production launch?',
            description:
              'This release has no certified production rollback artifact. If launch fails, recovery will rely on the pre-promotion Cloudways backup.',
            confirmLabel: 'Approve release',
          }
        : {
            title: 'Provision production WordPress?',
            description:
              'This creates a billable Cloudways application and cannot be safely duplicated.',
            confirmLabel: 'Provision application',
          }

  return (
    <>
      <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Production operations</CardTitle>
          <Badge variant="outline">Human launch gate enforced</Badge>
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
                  : 'Warnings · non-blocking'
                : 'Not run · optional'}
            </p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Incidents</p>
            <p className="font-medium">{activeIncidents.length} active</p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Latest health</p>
            <p className="font-medium">
              {incidents?.healthRuns[0]?.status || 'No run'}
            </p>
          </div>
        </div>

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
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1 text-sm">
              Production domain
              <input
                value={targetDomain}
                onChange={(event) => setTargetDomain(event.target.value)}
                placeholder="www.example.com"
                className="mt-1 w-full rounded border bg-background px-3 py-2"
              />
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
            After saving, point the domain’s A record to the Cloudways server.
            Domain attachment and SSL run only after the staged release is
            certified for production.
          </p>
        </section>

        <Textarea
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Operator rationale for acknowledgement, repair, restore, or rollback…"
          aria-label="Production operation rationale"
        />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={legalRightsConfirmed}
            onChange={(event) => setLegalRightsConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>
            I confirm the pinned legal text and every production asset’s
            ownership or license for this exact release.
          </span>
        </label>
        {promotionToken ||
        latestRelease?.state === 'launch_approved' ||
        latestRelease?.state === 'backed_up' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-sm">
              One-time promotion token
              <input
                value={promotionToken}
                onChange={(event) => setPromotionToken(event.target.value)}
                className="mt-1 w-full rounded border bg-background px-3 py-2 font-mono text-xs"
                autoComplete="off"
              />
            </label>
            <label className="text-sm">
              Cloudways operation ID (manual fallback only)
              <input
                value={manualOperationId}
                onChange={(event) => setManualOperationId(event.target.value)}
                className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
              />
            </label>
            {latestRelease?.state === 'launch_approved' ? (
              <label className="text-sm">
                Cloudways backup restore point (backup confirmation)
                <input
                  value={manualBackupId}
                  onChange={(event) => setManualBackupId(event.target.value)}
                  className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
                  placeholder="e.g. 7/8/2026 7:45 AM restore point timestamp"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!canCertify || Boolean(activeRelease) || Boolean(busy)}
            onClick={() => void prepareLaunch()}
          >
            Prepare launch release
          </Button>
          {latestRelease?.state === 'certified' ? (
            <Button
              size="sm"
              disabled={
                !legalRightsConfirmed ||
                rationale.trim().length < 10 ||
                Boolean(busy)
              }
              onClick={() => void approveLaunch()}
            >
              Approve exact production launch
            </Button>
          ) : null}
          {latestRelease &&
          ['launch_approved', 'backed_up'].includes(latestRelease.state) ? (
            <Button
              size="sm"
              disabled={!promotionToken || Boolean(busy)}
              onClick={() => void promoteLaunch()}
            >
              Backup & promote approved release
            </Button>
          ) : null}
          {latestRelease?.state === 'live' ? (
            <Button
              size="sm"
              disabled={
                !operations?.browserCertifierConfigured || Boolean(busy)
              }
              onClick={() =>
                void postAction(
                  'certify',
                  `/api/siteforge/production/${websiteId}/certify`,
                  {
                    releaseId: latestRelease.id,
                    promotedArtifactId: latestRelease.artifact_id,
                    promotedContentHash: latestRelease.artifact_content_hash,
                  }
                )
              }
            >
              Run full browser QA
            </Button>
          ) : null}
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
        {latestRelease?.state === 'live' &&
        !operations?.browserCertifierConfigured ? (
          <p role="alert" className="text-sm text-amber-700">
            Browser QA is unavailable until the optional certifier is
            configured.
          </p>
        ) : null}

        {activeIncidents.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Active incidents</p>
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
                <span className="font-medium">{incident.category}</span>
                <span className="min-w-[220px] flex-1 text-muted-foreground">
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
