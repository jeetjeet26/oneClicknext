'use client'

import { useState } from 'react'
import { Loader2, ScanSearch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { RenderedAestheticCritiqueReport } from '@/utils/siteforge/critique/contracts'
import { SiteForgeCritiqueReport } from './SiteForgeCritiqueReport'

type CritiqueArtifact = {
  artifactId: string | null
  contentHash: string | null
  version: number | null
}

type CritiqueCertification = {
  id: string
  status: string
  exact: boolean
} | null

export function canRunSiteForgeCritique(
  artifact: CritiqueArtifact,
  certification: CritiqueCertification
): boolean {
  return Boolean(
    artifact.artifactId &&
      artifact.contentHash &&
      certification?.exact &&
      certification.status === 'passed'
  )
}

export function SiteForgeCritiqueWorkspace({
  websiteId,
  artifact,
  certification,
}: {
  websiteId: string
  artifact: CritiqueArtifact
  certification: CritiqueCertification
}) {
  const [report, setReport] =
    useState<RenderedAestheticCritiqueReport | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canRun = canRunSiteForgeCritique(artifact, certification)
  const helpId = 'siteforge-critique-requirements'

  async function runCritique() {
    if (
      !canRun ||
      !artifact.artifactId ||
      !artifact.contentHash ||
      !certification
    ) {
      return
    }
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/siteforge/critique/${websiteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId: artifact.artifactId,
          contentHash: artifact.contentHash,
          certificationEvidenceId: certification.id,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Rendered critique could not be created')
      }
      setReport(body.report as RenderedAestheticCritiqueReport)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Rendered critique could not be created'
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Critique certified evidence</CardTitle>
              <CardDescription id={helpId}>
                Run aesthetic critique only against the exact current artifact
                and its passed browser-certification screenshots.
              </CardDescription>
            </div>
            <Badge variant={canRun ? 'success' : 'outline'}>
              {canRun ? 'Evidence ready' : 'Certification required'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Artifact revision</dt>
              <dd className="font-medium">v{artifact.version ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Artifact ID</dt>
              <dd className="break-all font-mono text-xs">
                {artifact.artifactId || 'Not available'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Certification evidence</dt>
              <dd className="break-all font-mono text-xs">
                {certification?.id || 'Not available'}
              </dd>
            </div>
          </dl>
          <Button
            type="button"
            onClick={() => void runCritique()}
            disabled={!canRun || pending}
            aria-describedby={helpId}
          >
            {pending ? (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <ScanSearch className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {pending ? 'Critiquing evidence…' : 'Run rendered critique'}
          </Button>
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {report ? <SiteForgeCritiqueReport report={report} /> : null}
    </div>
  )
}
