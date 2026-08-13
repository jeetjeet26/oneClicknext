'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type MigrationManifestSummary = {
  id: string
  version: number
  status: string
  source_url: string
  source_read_only: boolean
  content_hash: string
  parity_report: unknown
  unmigrated_items: unknown
  dns_snapshot: unknown
  post_launch_crawl: unknown
  updated_at: string
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

export function SiteForgeMigration({
  websiteId,
  propertyId,
}: {
  websiteId: string
  propertyId: string
}) {
  const [manifests, setManifests] = useState<MigrationManifestSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/siteforge/migration/${websiteId}?propertyId=${encodeURIComponent(propertyId)}`,
        { cache: 'no-store' }
      )
      const body: unknown = await response.json()
      if (!response.ok) {
        throw new Error(
          objectValue(body).error?.toString() || 'Failed to load migration manifests'
        )
      }
      const rows = objectValue(body).manifests
      setManifests(Array.isArray(rows) ? (rows as MigrationManifestSummary[]) : [])
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to load migration manifests'
      )
    } finally {
      setLoading(false)
    }
  }, [propertyId, websiteId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Existing-site migration</CardTitle>
          <CardDescription>
            Read-only source crawl, parity evidence, redirects, approval, and
            post-launch verification.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
        {!loading && manifests.length === 0 ? (
          <p className="text-sm text-gray-500">
            No migration manifest has been captured for this website.
          </p>
        ) : null}
        {manifests.map(manifest => {
          const parity = objectValue(manifest.parity_report)
          const dns = objectValue(manifest.dns_snapshot)
          const postLaunch = objectValue(manifest.post_launch_crawl)
          const unresolved = Array.isArray(manifest.unmigrated_items)
            ? manifest.unmigrated_items.filter(item => {
                const row = objectValue(item)
                return row.status === 'requires_operator_review'
              }).length
            : arrayCount(manifest.unmigrated_items)
          return (
            <section
              key={manifest.id}
              className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
              aria-label={`Migration manifest version ${manifest.version}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {manifest.source_read_only ? (
                    <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
                  )}
                  <h3 className="font-medium">Manifest v{manifest.version}</h3>
                  <Badge variant={manifest.status === 'verified' ? 'success' : 'secondary'}>
                    {manifest.status}
                  </Badge>
                </div>
                <span className="font-mono text-xs text-gray-500">
                  {manifest.content_hash.slice(0, 12)}…
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-gray-500">Source</dt>
                  <dd className="break-all">{manifest.source_url}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Source access</dt>
                  <dd>{manifest.source_read_only ? 'Read-only enforced' : 'Blocked'}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Parity</dt>
                  <dd>{String(parity.status || 'pending')}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">DNS snapshot</dt>
                  <dd>{String(dns.status || 'not_captured')} (read-only)</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Unresolved items</dt>
                  <dd>{unresolved}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Post-launch crawl</dt>
                  <dd className="flex items-center gap-1">
                    {postLaunch.status === 'passed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    ) : null}
                    {String(postLaunch.status || 'pending')}
                  </dd>
                </div>
              </dl>
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}
