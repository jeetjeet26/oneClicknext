'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    production_url: string | null
    production_certified_at: string | null
    editor_lifecycle_status: string
  }
  releases: Array<{
    id: string
    release_version: number
    state: string
    artifact_id: string
    artifact_content_hash: string
    rollback_artifact_id: string
    rollback_content_hash: string
    created_at: string
  }>
  certifications: Array<{ id: string; environment: string; status: string; created_at: string }>
  restores: Array<{ id: string; status: string; created_at: string }>
  rollbackHistory: Array<{
    id: string
    version: number
    changes_summary: string | null
    created_at: string
  }>
  automaticProductionLaunch: false
  browserCertifierConfigured: boolean
}

type IncidentPayload = {
  incidents: Incident[]
  healthRuns: Array<{ id: string; status: string; trigger_type: string; started_at: string }>
  repairs: Array<{ id: string; status: string; repair_type: string; created_at: string }>
}

export function SiteForgeOperationsPanel({ websiteId }: { websiteId: string }) {
  const [operations, setOperations] = useState<Operations | null>(null)
  const [incidents, setIncidents] = useState<IncidentPayload | null>(null)
  const [rationale, setRationale] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [legalRightsConfirmed, setLegalRightsConfirmed] = useState(false)
  const [promotionToken, setPromotionToken] = useState('')
  const [manualOperationId, setManualOperationId] = useState('')

  const refresh = useCallback(async () => {
    const [operationsResponse, incidentsResponse] = await Promise.all([
      fetch(`/api/siteforge/operations/${websiteId}`, { cache: 'no-store' }),
      fetch(`/api/siteforge/incidents?websiteId=${websiteId}`, { cache: 'no-store' }),
    ])
    const [operationsData, incidentsData] = await Promise.all([
      operationsResponse.json(),
      incidentsResponse.json(),
    ])
    if (!operationsResponse.ok) throw new Error(operationsData.error || 'Operations unavailable')
    if (!incidentsResponse.ok) throw new Error(incidentsData.error || 'Incidents unavailable')
    setOperations(operationsData)
    setIncidents(incidentsData)
  }, [websiteId])

  useEffect(() => {
    void refresh().catch(error =>
      setMessage(error instanceof Error ? error.message : 'Operations unavailable')
    )
  }, [refresh])

  async function postAction(key: string, url: string, body: Record<string, unknown>) {
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
      const previewResponse = await fetch(`/api/siteforge/rollback/${websiteId}`)
      const preview = await previewResponse.json()
      if (!previewResponse.ok || !preview.canRollback) {
        throw new Error(preview.error || preview.message || 'No verified rollback is available')
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

  async function prepareLaunch() {
    if (!operations?.website.staging_artifact_id || !operations.website.staging_content_hash) {
      return
    }
    const previewResponse = await fetch(`/api/siteforge/rollback/${websiteId}`)
    const preview = await previewResponse.json()
    if (!previewResponse.ok || !preview.rollbackToArtifactId || !preview.rollbackToContentHash) {
      setMessage(
        preview.error ||
          preview.message ||
          'A remotely certified rollback artifact is required before launch preparation.'
      )
      return
    }
    await postAction('prepare-launch', '/api/siteforge/launch/prepare', {
      propertyId: operations.website.property_id,
      websiteId,
      artifactId: operations.website.staging_artifact_id,
      contentHash: operations.website.staging_content_hash,
      rollbackArtifactId: preview.rollbackToArtifactId,
      rollbackContentHash: preview.rollbackToContentHash,
    })
  }

  async function approveLaunch() {
    const release = operations?.releases[0]
    if (!release || !legalRightsConfirmed || rationale.trim().length < 10) return
    const result = await postAction('approve-launch', '/api/siteforge/launch/approve', {
      propertyId: operations!.website.property_id,
      releaseId: release.id,
      artifactId: release.artifact_id,
      contentHash: release.artifact_content_hash,
      rollbackArtifactId: release.rollback_artifact_id,
      rollbackContentHash: release.rollback_content_hash,
      rationale: rationale.trim(),
      legalRightsSnapshot: {
        confirmed: true,
        confirmedAt: new Date().toISOString(),
        source: 'siteforge-operator-console',
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    if (typeof result?.promotionToken === 'string') {
      setPromotionToken(result.promotionToken)
      setMessage('Launch approved. Copy or use the one-time promotion token now.')
    }
  }

  async function promoteLaunch() {
    const release = operations?.releases[0]
    if (!release || !promotionToken) return
    const body: Record<string, unknown> = {
      propertyId: operations!.website.property_id,
      releaseId: release.id,
      promotionToken,
    }
    if (manualOperationId.trim()) {
      body.manualConfirmation = { operationId: manualOperationId.trim() }
    }
    const result = await postAction('promote-launch', '/api/siteforge/launch/promote', body)
    if (result?.manualRequired === true) {
      setMessage(String(result.dashboardAction || 'Cloudways requires a manual promotion confirmation.'))
    }
  }

  const activeIncidents =
    incidents?.incidents.filter(incident => incident.status !== 'resolved') || []
  const canCertify =
    operations?.website.staging_certified_at &&
    operations.website.staging_artifact_id &&
    operations.website.staging_content_hash
  const latestRelease = operations?.releases[0]
  const activeRelease =
    latestRelease && !['live', 'failed', 'rolled_back'].includes(latestRelease.state)
      ? latestRelease
      : null

  return (
    <Card className="xl:col-span-2">
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
            <p className="font-medium">{operations?.website.editor_lifecycle_status || 'Loading…'}</p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Certification</p>
            <p className="font-medium">
              {operations?.website.production_certified_at ? 'Production certified' : 'Not certified'}
            </p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Incidents</p>
            <p className="font-medium">{activeIncidents.length} active</p>
          </div>
          <div className="rounded border p-3 text-sm">
            <p className="text-muted-foreground">Latest health</p>
            <p className="font-medium">{incidents?.healthRuns[0]?.status || 'No run'}</p>
          </div>
        </div>

        <Textarea
          value={rationale}
          onChange={event => setRationale(event.target.value)}
          placeholder="Operator rationale for acknowledgement, repair, restore, or rollback…"
          aria-label="Production operation rationale"
        />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={legalRightsConfirmed}
            onChange={event => setLegalRightsConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>
            I confirm the pinned legal text and every production asset’s ownership or
            license for this exact release.
          </span>
        </label>
        {promotionToken || latestRelease?.state === 'launch_approved' || latestRelease?.state === 'backed_up' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-sm">
              One-time promotion token
              <input
                value={promotionToken}
                onChange={event => setPromotionToken(event.target.value)}
                className="mt-1 w-full rounded border bg-background px-3 py-2 font-mono text-xs"
                autoComplete="off"
              />
            </label>
            <label className="text-sm">
              Cloudways operation ID (manual fallback only)
              <input
                value={manualOperationId}
                onChange={event => setManualOperationId(event.target.value)}
                className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
              />
            </label>
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
          {latestRelease?.state === 'promoted' ? (
            <Button
              size="sm"
              disabled={!operations?.browserCertifierConfigured || Boolean(busy)}
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
              Run production certification
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={rationale.trim().length < 10 || Boolean(busy)}
            onClick={() =>
              void postAction('restore', `/api/siteforge/operations/${websiteId}`, {
                action: 'request_restore',
                rationale: rationale.trim(),
              })
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
              <a href={operations.website.production_url} target="_blank" rel="noopener noreferrer">
                Open production
              </a>
            </Button>
          ) : null}
        </div>
        {latestRelease?.state === 'promoted' &&
        !operations?.browserCertifierConfigured ? (
          <p role="alert" className="text-sm text-amber-700">
            Configure the trusted browser certifier before production certification.
          </p>
        ) : null}

        {activeIncidents.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Active incidents</p>
            {activeIncidents.map(incident => (
              <div key={incident.id} className="flex flex-wrap items-center gap-2 rounded border p-3 text-sm">
                <Badge variant={incident.severity === 'critical' ? 'destructive' : 'outline'}>
                  {incident.severity}
                </Badge>
                <span className="font-medium">{incident.category}</span>
                <span className="min-w-[220px] flex-1 text-muted-foreground">{incident.summary}</span>
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
              ...(operations?.releases || []).map(item => `Release ${item.release_version}: ${item.state}`),
              ...(operations?.certifications || []).map(item => `${item.environment}: ${item.status}`),
            ]}
          />
          <History
            title="Restore / rollback"
            rows={[
              ...(operations?.restores || []).map(item => `Restore: ${item.status}`),
              ...(operations?.rollbackHistory || []).map(item => `Rollback revision v${item.version}`),
            ]}
          />
          <History
            title="Repairs"
            rows={(incidents?.repairs || []).map(item => `${item.repair_type}: ${item.status}`)}
          />
        </div>
        {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  )
}

function History({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded border p-3">
      <p className="font-medium">{title}</p>
      {rows.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {rows.slice(0, 6).map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No history yet.</p>
      )}
    </div>
  )
}
