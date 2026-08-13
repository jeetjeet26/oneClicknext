'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { SiteForgeReporting } from './SiteForgeReporting'

type IncidentSummary = {
  id: string
  title: string
  severity: string
  status: string
  category: string
}

type OwnershipSnapshot = {
  incidents: IncidentSummary[]
  policy: { mode?: string } | null
  evidence: {
    evaluatedRuns: number
    completedJobs: number
    supervisedSuccesses: number
    incidentRate: number
    rollbackVerified: boolean
    providerEvidenceRuns: number
    outcomeMeasurements: number
  } | null
}

export function SiteForgeOwnership({
  websiteId,
  propertyId,
  actionScope = 'siteforge.incident:resolve_after_verified_recheck',
}: {
  websiteId: string
  propertyId: string
  actionScope?: string
}) {
  const [snapshot, setSnapshot] = useState<OwnershipSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadOwnership = useCallback(async () => {
    setError(null)
    try {
      const [incidentResponse, autonomyResponse] = await Promise.all([
        fetch(
          `/api/siteforge/incidents?websiteId=${encodeURIComponent(websiteId)}`,
          { cache: 'no-store' }
        ),
        fetch(
          `/api/siteforge/autonomy?propertyId=${encodeURIComponent(
            propertyId
          )}&actionScope=${encodeURIComponent(actionScope)}`,
          { cache: 'no-store' }
        ),
      ])
      const [incidentBody, autonomyBody] = await Promise.all([
        incidentResponse.json().catch(() => ({})),
        autonomyResponse.json().catch(() => ({})),
      ])
      if (!incidentResponse.ok) {
        throw new Error(incidentBody.error || 'Failed to load incidents')
      }
      if (!autonomyResponse.ok) {
        throw new Error(autonomyBody.error || 'Failed to load autonomy evidence')
      }
      setSnapshot({
        incidents: incidentBody.incidents || [],
        policy: autonomyBody.policy || null,
        evidence: autonomyBody.evidence || null,
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to load ownership state'
      )
    }
  }, [actionScope, propertyId, websiteId])

  useEffect(() => {
    void loadOwnership()
  }, [loadOwnership])

  const openIncidents =
    snapshot?.incidents.filter(incident => incident.status !== 'resolved') || []

  return (
    <section className="space-y-6" aria-labelledby="siteforge-ownership-title">
      <div>
        <h2 id="siteforge-ownership-title" className="text-2xl font-semibold">
          Site ownership
        </h2>
        <p className="text-sm text-gray-500">
          Production health, incidents, outcomes, and durable autonomy evidence.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-red-300 p-3 text-sm">
          {error}
        </div>
      ) : null}

      {!snapshot && !error ? (
        <div role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading ownership evidence…
        </div>
      ) : null}

      {snapshot ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                {openIncidents.length ? (
                  <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
                )}
                <CardTitle>Incident ownership</CardTitle>
              </div>
              <CardDescription>
                {openIncidents.length} open incident
                {openIncidents.length === 1 ? '' : 's'}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {openIncidents.slice(0, 8).map(incident => (
                  <li
                    key={incident.id}
                    className="flex items-start justify-between gap-3 rounded-md border p-2"
                  >
                    <span>
                      <span className="block font-medium">{incident.title}</span>
                      <span className="text-xs text-gray-500">
                        {incident.category}
                      </span>
                    </span>
                    <Badge
                      variant={
                        ['critical', 'high'].includes(incident.severity)
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {incident.severity}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                <CardTitle>Autonomy evidence</CardTitle>
              </div>
              <CardDescription>
                Caller assertions are ignored; promotion uses durable ledgers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Mode:{' '}
                <Badge variant="outline">
                  {snapshot.policy?.mode || 'not configured'}
                </Badge>
              </p>
              <p>Evaluated actions: {snapshot.evidence?.evaluatedRuns || 0}</p>
              <p>Completed jobs: {snapshot.evidence?.completedJobs || 0}</p>
              <p>
                Supervised successes: {snapshot.evidence?.supervisedSuccesses || 0}
              </p>
              <p>
                Provider evidence runs: {snapshot.evidence?.providerEvidenceRuns || 0}
              </p>
              <p>
                Delayed outcomes: {snapshot.evidence?.outcomeMeasurements || 0}
              </p>
              <p>
                Rollback verified:{' '}
                {snapshot.evidence?.rollbackVerified ? 'yes' : 'no'}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <SiteForgeReporting websiteId={websiteId} />
    </section>
  )
}
