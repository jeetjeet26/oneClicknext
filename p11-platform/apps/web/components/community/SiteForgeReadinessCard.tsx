'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'

type DomainStatus = 'missing' | 'conflicted' | 'needs_review' | 'ready' | 'stale'

type DomainReport = {
  status: DomainStatus
  blocking: boolean
  messages: string[]
  sourceIds: string[]
}

type ReadinessSnapshot = {
  id: string
  content_hash: string
  status: 'draft' | 'needs_review' | 'ready' | 'approved' | 'stale'
  domain_reports: Record<string, DomainReport>
  unresolved_conflicts: unknown[]
  approved_at?: string | null
  created_at: string
}

const remediation: Record<string, string> = {
  identity: '/dashboard/properties',
  brand: '/dashboard/brandforge',
  assets: '/dashboard/community',
  facts: '/dashboard/community',
  units: '/dashboard/community',
  neighborhood: '/dashboard/community',
  legal: '/dashboard/community',
  integrations: '/dashboard/settings/crm',
}

export function SiteForgeReadinessCard({ propertyId }: { propertyId: string }) {
  const [snapshot, setSnapshot] = useState<ReadinessSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!propertyId) return
    const response = await fetch(
      `/api/onboarding/readiness?propertyId=${encodeURIComponent(propertyId)}`
    )
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || 'Could not load readiness')
    setSnapshot(body?.snapshots?.[0] || null)
  }, [propertyId])

  useEffect(() => {
    void load().catch(cause =>
      setError(cause instanceof Error ? cause.message : 'Could not load readiness')
    )
  }, [load])

  async function build() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/onboarding/readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Readiness check failed')
      setSnapshot(body.snapshot)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Readiness check failed')
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (!snapshot) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        `/api/onboarding/readiness/${snapshot.id}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId,
            rationale: 'Approved from Community Setup readiness review',
          }),
        }
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Readiness approval failed')
      setSnapshot(body.snapshot)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Readiness approval failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">SiteForge readiness</h3>
          <p className="mt-1 text-sm text-slate-500">
            Freeze approved property, brand, legal, asset, and integration truth
            before creating a SiteForge plan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void build()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Check readiness
        </button>
      </div>

      {snapshot ? (
        <>
          <div className="flex items-center gap-2 text-sm">
            {snapshot.status === 'approved' || snapshot.status === 'ready' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            )}
            <span className="font-medium capitalize">
              {snapshot.status.replace('_', ' ')}
            </span>
            <span className="font-mono text-xs text-slate-400">
              {snapshot.content_hash.slice(0, 12)}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(snapshot.domain_reports || {}).map(([domain, report]) => (
              <div key={domain} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium capitalize text-slate-900">
                    {domain}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    report.status === 'ready'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {report.status.replace('_', ' ')}
                  </span>
                </div>
                {report.messages.map(message => (
                  <p key={message} className="mt-1 text-xs text-slate-500">{message}</p>
                ))}
                {report.status !== 'ready' && (
                  <a
                    href={domain === 'brand'
                      ? `/dashboard/brandforge/${propertyId}`
                      : remediation[domain] || '/dashboard/community'}
                    className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline"
                  >
                    Resolve {domain}
                  </a>
                )}
              </div>
            ))}
          </div>
          {snapshot.status === 'ready' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void approve()}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Approve and freeze readiness snapshot
            </button>
          )}
        </>
      ) : (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
          No readiness snapshot has been built for this property.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
