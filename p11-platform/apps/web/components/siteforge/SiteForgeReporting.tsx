'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { SiteForgeOwnershipReport } from '@/utils/siteforge/operations/analytics'

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

export function SiteForgeReporting({ websiteId }: { websiteId: string }) {
  const [report, setReport] = useState<SiteForgeOwnershipReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [saving, setSaving] = useState(false)

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/siteforge/reporting?websiteId=${encodeURIComponent(websiteId)}`,
        { cache: 'no-store' }
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to load reporting')
      setReport(body as SiteForgeOwnershipReport)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load reporting')
    } finally {
      setLoading(false)
    }
  }, [websiteId])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  async function createSubscription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/siteforge/reporting/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          recipientEmail,
          cadence,
          sections: [
            'funnels',
            'versions',
            'freshness',
            'gaps',
            'incidents',
            'outcomes',
            'recommendations',
          ],
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Failed to save report subscription')
      }
      setRecipientEmail('')
      await loadReport()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to save report subscription'
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading && !report) {
    return (
      <div role="status" className="flex items-center gap-2 py-8 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading ownership reporting…
      </div>
    )
  }

  return (
    <section className="space-y-4" aria-labelledby="siteforge-reporting-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="siteforge-reporting-title" className="text-xl font-semibold">
            Post-launch reporting
          </h2>
          <p className="text-sm text-gray-500">
            Artifact-aware sessions, conversion, attribution, outcomes, and
            instrumentation evidence.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadReport()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/siteforge/reporting?websiteId=${encodeURIComponent(
                websiteId
              )}&format=csv`}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-red-300 p-3 text-sm">
          {error}
        </div>
      ) : null}

      {report ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {report.funnels.map(funnel => (
              <Card key={funnel.artifactId || 'unattributed'}>
                <CardHeader>
                  <CardTitle className="truncate text-sm">
                    {funnel.artifactId || 'Unattributed'}
                  </CardTitle>
                  <CardDescription>{funnel.metrics.sessions} sessions</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p>CTA {percent(funnel.metrics.ctaConversionRate)}</p>
                  <p>Lead {percent(funnel.metrics.leadConversionRate)}</p>
                  <p>Tour {percent(funnel.metrics.tourConversionRate)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Instrumentation and consent</CardTitle>
                <CardDescription>
                  Gaps are explicit and excluded from confident attribution.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Consent-gap events: {report.gaps.consentGapEvents}</p>
                <p>Sessions without page views: {report.gaps.sessionsWithoutPageView}</p>
                <p>Unattributed events: {report.gaps.unattributedEvents}</p>
                <Badge variant={report.gaps.noTelemetry ? 'destructive' : 'success'}>
                  {report.gaps.noTelemetry ? 'No telemetry' : 'Telemetry present'}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recommendations</CardTitle>
                <CardDescription>Deterministic ownership next steps.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.recommendations.length ? (
                  <ul className="list-disc space-y-2 pl-5 text-sm">
                    {report.recommendations.map(recommendation => (
                      <li key={recommendation}>{recommendation}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No current recommendations.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Scheduled report subscriptions</CardTitle>
              <CardDescription>
                Saves delivery intent only. This screen does not send email or
                invoke a provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={createSubscription}
              >
                <label className="sr-only" htmlFor="siteforge-report-email">
                  Recipient email
                </label>
                <input
                  id="siteforge-report-email"
                  type="email"
                  required
                  value={recipientEmail}
                  onChange={event => setRecipientEmail(event.target.value)}
                  placeholder="owner@example.com"
                  className="min-h-9 flex-1 rounded-md border bg-transparent px-3 text-sm"
                />
                <label className="sr-only" htmlFor="siteforge-report-cadence">
                  Cadence
                </label>
                <select
                  id="siteforge-report-cadence"
                  value={cadence}
                  onChange={event =>
                    setCadence(
                      event.target.value as 'daily' | 'weekly' | 'monthly'
                    )
                  }
                  className="min-h-9 rounded-md border bg-transparent px-3 text-sm"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Subscribe'}
                </Button>
              </form>
              <ul className="space-y-2 text-sm">
                {report.subscriptions.map(subscription => (
                  <li
                    key={subscription.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <span>{subscription.recipient_email}</span>
                    <span>
                      {subscription.cadence} · {subscription.status}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : null}
    </section>
  )
}
