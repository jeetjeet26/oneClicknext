'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type ConnectorSummary = {
  id: string
  provider: string
  capability: string
  status: string
  credential_ref: 'configured' | null
  source_watermark: string | null
  health: {
    state: string
    verified: boolean
    message: string | null
    diagnostics: string[]
    retry: { attempts: number; maxAttempts: number; nextRetryAt: string | null }
    deadLetters: unknown[]
    reconciliation: { status?: string } | null
  }
  freshness: {
    state: string
    stale: boolean
    ageSeconds: number | null
    reason: string
  }
}

type AnalyticsDestination = {
  id: string
  destination_type: 'ga4' | 'gtm' | 'webhook'
  destination_identity: string
  consent_mode: 'required' | 'not_required'
  enabled: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function SiteForgeConnectors({
  websiteId,
  propertyId,
}: {
  websiteId: string
  propertyId: string
}) {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [destinations, setDestinations] = useState<AnalyticsDestination[]>([])
  const [destinationType, setDestinationType] = useState<'ga4' | 'gtm'>('ga4')
  const [destinationIdentity, setDestinationIdentity] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [consentMode, setConsentMode] =
    useState<'required' | 'not_required'>('required')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [response, analyticsResponse] = await Promise.all([
        fetch(
          `/api/siteforge/connectors/${websiteId}?propertyId=${encodeURIComponent(propertyId)}`,
          { cache: 'no-store' }
        ),
        fetch(
          `/api/siteforge/analytics/destinations?websiteId=${encodeURIComponent(websiteId)}`,
          { cache: 'no-store' }
        ),
      ])
      const [body, analyticsBody]: unknown[] = await Promise.all([
        response.json(),
        analyticsResponse.json(),
      ])
      if (!response.ok) {
        throw new Error(
          record(body).error?.toString() || 'Failed to load connector diagnostics'
        )
      }
      const rows = record(body).connectors
      setConnectors(Array.isArray(rows) ? (rows as ConnectorSummary[]) : [])
      if (!analyticsResponse.ok) {
        throw new Error(
          record(analyticsBody).error?.toString() ||
            'Failed to load analytics destinations'
        )
      }
      const destinationRows = record(analyticsBody).destinations
      setDestinations(
        Array.isArray(destinationRows)
          ? (destinationRows as AnalyticsDestination[])
          : []
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to load connector diagnostics'
      )
    } finally {
      setLoading(false)
    }
  }, [propertyId, websiteId])

  async function saveDestination() {
    if (!destinationIdentity.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/siteforge/analytics/destinations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          destination: {
            destinationType,
            destinationIdentity: destinationIdentity.trim(),
            configuration:
              destinationType === 'ga4'
                ? { apiSecret: apiSecret.trim() }
                : { dataLayerName: 'dataLayer' },
            consentMode,
            enabled: true,
          },
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Analytics destination was not saved')
      }
      setDestinationIdentity('')
      setApiSecret('')
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Analytics destination was not saved'
      )
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Connector operations</CardTitle>
          <CardDescription>
            Capability mappings, durable checkpoints, freshness, retries,
            dead letters, and reconciliation diagnostics.
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
        {!loading && connectors.length === 0 ? (
          <p className="text-sm text-gray-500">
            No connector configs exist. Provider success remains unknown until
            explicit verification evidence records a checkpoint.
          </p>
        ) : null}
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-medium">First-client conversion setup</h3>
              <p className="text-sm text-muted-foreground">
                P11 contact capture is native and requires no external API.
              </p>
            </div>
            <Badge variant="success">P11 contact · available</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
              <input type="radio" checked readOnly className="mr-2" />
              Contact form → P11 leads
            </label>
            <label className="rounded border bg-muted/30 p-3 text-sm text-muted-foreground">
              <input type="radio" disabled className="mr-2" />
              Direct tour booking
              <span className="mt-1 block text-xs">
                Unavailable until a supported tour provider is configured.
              </span>
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="font-medium">GA4 / GTM destinations</h3>
            <p className="text-sm text-muted-foreground">
              Readiness is configured only after a validated destination is
              persisted with an explicit consent mode.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              Destination
              <select
                className="mt-1 w-full rounded border bg-background px-3 py-2"
                value={destinationType}
                onChange={event =>
                  setDestinationType(event.target.value as 'ga4' | 'gtm')
                }
              >
                <option value="ga4">Google Analytics 4</option>
                <option value="gtm">Google Tag Manager</option>
              </select>
            </label>
            <label className="text-sm">
              {destinationType === 'ga4' ? 'Measurement ID' : 'Container ID'}
              <input
                className="mt-1 w-full rounded border bg-background px-3 py-2"
                value={destinationIdentity}
                onChange={event => setDestinationIdentity(event.target.value)}
                placeholder={destinationType === 'ga4' ? 'G-XXXXXXXX' : 'GTM-XXXXXX'}
              />
            </label>
            {destinationType === 'ga4' ? (
              <label className="text-sm">
                Measurement Protocol API secret
                <input
                  type="password"
                  autoComplete="off"
                  className="mt-1 w-full rounded border bg-background px-3 py-2"
                  value={apiSecret}
                  onChange={event => setApiSecret(event.target.value)}
                />
              </label>
            ) : null}
            <label className="text-sm">
              Consent mode
              <select
                className="mt-1 w-full rounded border bg-background px-3 py-2"
                value={consentMode}
                onChange={event =>
                  setConsentMode(
                    event.target.value as 'required' | 'not_required'
                  )
                }
              >
                <option value="required">Consent required</option>
                <option value="not_required">Consent not required</option>
              </select>
            </label>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void saveDestination()}
            disabled={
              saving ||
              !destinationIdentity.trim() ||
              (destinationType === 'ga4' && apiSecret.trim().length < 8)
            }
          >
            {saving ? 'Saving…' : 'Save analytics destination'}
          </Button>
          <div className="space-y-2">
            {destinations.filter(item =>
              ['ga4', 'gtm'].includes(item.destination_type)
            ).map(item => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
              >
                <span>
                  {item.destination_type.toUpperCase()} ·{' '}
                  {item.destination_identity}
                </span>
                <Badge variant={item.enabled ? 'success' : 'outline'}>
                  {item.enabled
                    ? `Configured · consent ${item.consent_mode.replace('_', ' ')}`
                    : 'Disabled'}
                </Badge>
              </div>
            ))}
            {!loading &&
            !destinations.some(item =>
              ['ga4', 'gtm'].includes(item.destination_type)
            ) ? (
              <p className="text-sm text-muted-foreground">
                Not configured. Analytics destination readiness is false.
              </p>
            ) : null}
          </div>
        </section>
        {connectors.map(connector => (
          <section
            key={connector.id}
            className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
            aria-label={`${connector.provider} ${connector.capability} connector`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {connector.freshness.stale ? (
                  <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
                ) : (
                  <Activity className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                )}
                <h3 className="font-medium">{connector.provider}</h3>
                <Badge variant="outline">{connector.capability}</Badge>
                <Badge
                  variant={
                    connector.status === 'active'
                      ? 'success'
                      : connector.status === 'error'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {connector.status}
                </Badge>
              </div>
              <span className="text-xs text-gray-500">
                Health {connector.health.verified ? 'verified' : 'unverified'}
              </span>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Credential reference</dt>
                <dd>{connector.credential_ref || 'Not configured'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Freshness</dt>
                <dd title={connector.freshness.reason}>{connector.freshness.state}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Source watermark</dt>
                <dd>{connector.source_watermark || 'No checkpoint'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Retry state</dt>
                <dd>
                  {connector.health.retry.attempts}/{connector.health.retry.maxAttempts}
                  {connector.health.retry.nextRetryAt
                    ? ` · next ${connector.health.retry.nextRetryAt}`
                    : ''}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Dead letters</dt>
                <dd>{connector.health.deadLetters.length}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Reconciliation</dt>
                <dd>{connector.health.reconciliation?.status || 'Not run'}</dd>
              </div>
            </dl>
            {connector.health.diagnostics.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-300">
                {connector.health.diagnostics.map(message => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
