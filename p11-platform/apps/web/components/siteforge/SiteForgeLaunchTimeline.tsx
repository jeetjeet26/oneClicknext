'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'

type LaunchStatus = {
  release: {
    id: string
    release_version: number
    state: string
    artifact_id: string
    artifact_content_hash: string
    backup_id: string | null
    promotion_token_consumed_at: string | null
    production_certified_at: string | null
    live_at: string | null
  }
  events: Array<{
    id: string
    to_state: string
    rationale: string | null
    created_at: string
  }>
  dnsSnapshots: Array<{
    id: string
    provider: string
    domain: string
    captured_at: string
    restored_at: string | null
    propagation_report: unknown
  }>
  restoreDrills: Array<{
    id: string
    status: string
    created_at: string
    completed_at: string | null
  }>
  promotionTokenAvailable: boolean
}

export type SiteForgeLaunchTimelineItem = {
  key: string
  label: string
  status: 'complete' | 'active' | 'pending' | 'recovery'
  detail: string
}

const STATES = [
  'prepared',
  'certified',
  'launch_approved',
  'backed_up',
  'promoted',
  'production_certified',
  'live',
] as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function buildLaunchTimelineItems(
  status: LaunchStatus
): SiteForgeLaunchTimelineItem[] {
  const currentIndex = STATES.indexOf(
    status.release.state as (typeof STATES)[number]
  )
  const eventDates = new Map(
    status.events.map(event => [event.to_state, event.created_at])
  )
  const items: SiteForgeLaunchTimelineItem[] = STATES.map((state, index) => ({
    key: state,
    label: state.replaceAll('_', ' '),
    status:
      status.release.state === 'failed' || status.release.state === 'rolled_back'
        ? ('recovery' as const)
        : index < currentIndex
          ? ('complete' as const)
          : index === currentIndex
            ? ('active' as const)
            : ('pending' as const),
    detail:
      state === 'launch_approved' && status.promotionTokenAvailable
        ? 'One-use promotion authority is available.'
        : eventDates.has(state)
          ? `Recorded ${new Date(eventDates.get(state)!).toLocaleString()}.`
          : state === 'live'
            ? 'Requires public production browser certification.'
            : 'Waiting for the prior gate.',
  }))
  const latestDns = status.dnsSnapshots.at(-1)
  if (latestDns) {
    const report = asRecord(latestDns.propagation_report)
    const propagation = asRecord(report.propagation)
    items.splice(5, 0, {
      key: `dns:${latestDns.id}`,
      label: 'DNS / SSL cutover',
      status:
        latestDns.restored_at || report.phase === 'propagated'
          ? 'complete'
          : report.phase === 'propagation_pending'
            ? 'active'
            : 'pending',
      detail: latestDns.restored_at
        ? `DNS restored ${new Date(latestDns.restored_at).toLocaleString()}.`
        : propagation.propagated === true
          ? `${latestDns.provider} propagated ${latestDns.domain}.`
          : `Rollback snapshot saved for ${latestDns.domain}; propagation is ${
              report.phase === 'propagation_pending' ? 'pending' : 'not started'
            }.`,
    })
  }
  const restore = status.restoreDrills.at(-1)
  if (restore) {
    items.push({
      key: `restore:${restore.id}`,
      label: 'Supervised recovery',
      status: restore.status === 'succeeded' ? 'complete' : 'recovery',
      detail: `Restore ${restore.status.replaceAll('_', ' ')}.`,
    })
  }
  return items
}

export function SiteForgeLaunchTimeline({
  websiteId,
  propertyId,
}: {
  websiteId: string
  propertyId: string
}) {
  const [status, setStatus] = useState<LaunchStatus | null>(null)
  const [message, setMessage] = useState('Loading launch timeline…')

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const load = async () => {
      const response = await fetch(
        `/api/siteforge/launch/status?propertyId=${encodeURIComponent(
          propertyId
        )}&websiteId=${encodeURIComponent(websiteId)}`,
        { cache: 'no-store' }
      )
      const body = await response.json()
      if (cancelled) return
      if (response.status === 404) {
        setStatus(null)
        setMessage('No production release has been prepared.')
        return
      }
      if (!response.ok) {
        setMessage(body.error || 'Launch timeline unavailable.')
        return
      }
      setStatus(body as LaunchStatus)
      setMessage('')
      if (
        !['live', 'rolled_back', 'failed'].includes(
          (body as LaunchStatus).release.state
        )
      ) {
        timer = window.setTimeout(() => void load(), 5_000)
      }
    }
    void load().catch(error => {
      if (!cancelled) {
        setMessage(
          error instanceof Error ? error.message : 'Launch timeline unavailable.'
        )
      }
    })
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [propertyId, websiteId])

  const items = useMemo(
    () => (status ? buildLaunchTimelineItems(status) : []),
    [status]
  )

  return (
    <section
      className="rounded border p-4"
      aria-labelledby="siteforge-launch-timeline-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p id="siteforge-launch-timeline-heading" className="font-medium">
            Launch, cutover, and recovery timeline
          </p>
          <p className="text-xs text-muted-foreground">
            Public live state is withheld until exact browser certification.
          </p>
        </div>
        {status ? (
          <Badge variant={status.release.state === 'live' ? 'success' : 'outline'}>
            Release {status.release.release_version} ·{' '}
            {status.release.state.replaceAll('_', ' ')}
          </Badge>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {message}
        </p>
      ) : (
        <ol className="mt-4 grid gap-2 md:grid-cols-2">
          {items.map(item => (
            <li key={item.key} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">{item.label}</span>
                <Badge
                  variant={
                    item.status === 'recovery'
                      ? 'destructive'
                      : item.status === 'complete'
                        ? 'success'
                        : 'outline'
                  }
                >
                  {item.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
