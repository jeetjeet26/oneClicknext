'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'

type DomainStatus = 'missing' | 'conflicted' | 'needs_review' | 'ready' | 'stale'

type DomainReport = {
  state: DomainStatus
  blocking: boolean
  approvalPolicy?: 'required' | 'manager_override' | 'advisory'
  reasons: string[]
  sourceIds: string[]
}

type SiteForgeCapability = 'crm' | 'tours' | 'chatbot' | 'analytics'

type ReadinessSnapshot = {
  id: string
  content_hash: string
  status: 'draft' | 'needs_review' | 'ready' | 'approved' | 'stale'
  domain_reports: Record<string, DomainReport>
  unresolved_conflicts: unknown[]
  snapshot_payload?: {
    requestedCapabilities?: SiteForgeCapability[]
    enabledCapabilities?: SiteForgeCapability[]
  } | null
  approved_at?: string | null
  created_at: string
  approvalEligibility?: {
    canApprove: boolean
    requiresManagerOverride: boolean
  }
}

const remediation: Record<string, string> = {
  identityContact: '/dashboard/properties',
  brand: '/dashboard/brandforge',
  assets: '/dashboard/community',
  propertyFacts: '/dashboard/community',
  units: '/dashboard/community',
  neighborhood: '/dashboard/community',
  legal: '/dashboard/community',
  integrations: '/dashboard/settings/crm',
}

export function readinessRemediationUrl(
  domain: string,
  propertyId: string,
): string {
  return domain === 'brand'
    ? `/dashboard/brandforge/${propertyId}`
    : remediation[domain] || '/dashboard/community'
}

export const SITEFORGE_CAPABILITIES: Array<{
  value: SiteForgeCapability
  label: string
}> = [
  { value: 'crm', label: 'CRM lead delivery' },
  { value: 'tours', label: 'Tour scheduling' },
  { value: 'chatbot', label: 'Property chatbot' },
  { value: 'analytics', label: 'Analytics and tag manager' },
]

export function SiteForgeReadinessCard({
  propertyId,
  onChanged,
}: {
  propertyId: string
  onChanged?: () => void
}) {
  const [snapshot, setSnapshot] = useState<ReadinessSnapshot | null>(null)
  const [enabledCapabilities, setEnabledCapabilities] = useState<
    SiteForgeCapability[]
  >([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [overrideRationale, setOverrideRationale] = useState('')

  const load = useCallback(async () => {
    if (!propertyId) return
    const response = await fetch(
      `/api/onboarding/readiness?propertyId=${encodeURIComponent(propertyId)}`
    )
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || 'Could not load readiness')
    const latest = body?.snapshots?.[0] || null
    setSnapshot(latest)
    setEnabledCapabilities(
      latest?.snapshot_payload?.requestedCapabilities ||
      latest?.snapshot_payload?.enabledCapabilities ||
      []
    )
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
        body: JSON.stringify({ propertyId, enabledCapabilities }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Readiness check failed')
      setSnapshot(body.snapshot)
      onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Readiness check failed')
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (!snapshot) return
    const requiresManagerOverride =
      snapshot.approvalEligibility?.requiresManagerOverride === true
    if (!requiresManagerOverride) return
    const rationale = overrideRationale.trim()
    if (requiresManagerOverride && rationale.length < 10) {
      setError('Enter a manager override rationale of at least 10 characters')
      return
    }
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
            rationale,
            allowManagerOverride: requiresManagerOverride,
          }),
        }
      )
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Readiness approval failed')
      setSnapshot(body.snapshot)
      onChanged?.()
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

      <fieldset
        className="space-y-2 rounded-lg border border-slate-200 p-3"
        disabled={busy}
      >
        <legend className="px-1 text-sm font-medium text-slate-800">
          Enabled SiteForge capabilities
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SITEFORGE_CAPABILITIES.map(capability => (
            <label
              key={capability.value}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={enabledCapabilities.includes(capability.value)}
                onChange={event =>
                  setEnabledCapabilities(current =>
                    event.target.checked
                      ? [...current, capability.value]
                      : current.filter(value => value !== capability.value)
                  )
                }
              />
              {capability.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          These selections are validated against configured integrations and
          frozen into the snapshot. A fully ready check is approved immediately;
          warnings still require an explicit manager override.
        </p>
      </fieldset>

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
                    report.state === 'ready'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {report.state === 'ready'
                      ? 'ready'
                      : report.approvalPolicy === 'manager_override'
                        ? 'manager warning'
                        : report.approvalPolicy === 'advisory'
                          ? 'advisory'
                          : 'required'}
                  </span>
                </div>
                {report.reasons.map(reason => (
                  <p key={reason} className="mt-1 text-xs text-slate-500">{reason}</p>
                ))}
                {report.state !== 'ready' && (
                  <a
                    href={readinessRemediationUrl(domain, propertyId)}
                    className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline"
                  >
                    Resolve {domain}
                  </a>
                )}
              </div>
            ))}
          </div>
          {snapshot.approvalEligibility?.requiresManagerOverride && (
            <label className="block space-y-1 text-sm font-medium text-slate-800">
              Manager override rationale
              <textarea
                value={overrideRationale}
                onChange={event => setOverrideRationale(event.target.value)}
                rows={3}
                maxLength={2_000}
                placeholder="Explain why the remaining operational warnings are acceptable."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>
          )}
          {snapshot.approvalEligibility?.requiresManagerOverride && (
            <button
              type="button"
              disabled={
                busy ||
                (snapshot.approvalEligibility.requiresManagerOverride &&
                  overrideRationale.trim().length < 10)
              }
              onClick={() => void approve()}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Approve with manager override
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
