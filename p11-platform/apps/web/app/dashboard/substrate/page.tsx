'use client'

import { useEffect, useState } from 'react'
import { usePropertyContext } from '@/components/layout/PropertyContext'

type SharedApproval = {
  id: string
  actionType: string
  executionStatus: string
  policyReason: string | null
  proposedAt: string
}

type SharedOutcome = {
  id: string
  kpi_name: string
  observed_value: number | null
  delta_value: number | null
  outcome_status: string
  measured_at: string
}

type SharedAction = {
  id: string
  action_type: string
  lifecycle_status: string
  proposal_decision_status: string
  execution_status: string
  policy_reason: string | null
  confidence_score: number | null
  error_message: string | null
  shared_approvals?: Array<{
    id: string
    decision_status: string
    decision_reason: string
    created_at: string
  }>
  shared_experiment_outcomes?: SharedOutcome[]
}

type SharedJob = {
  id: string
  domain: string
  subject_type: string
  subject_id: string | null
  lifecycle_status: string
  status_reason: string | null
  attempt_count: number
  max_attempts: number
  error_message: string | null
  created_at: string
  shared_context_snapshots?: { id: string; source_domain: string; created_at: string }[] | null
  shared_action_attempts?: SharedAction[]
}

type ContextBridge = {
  asOf: string
  citations: Array<{ domain: string; tables: string[] }>
  knowledge: { sourceCount: number; documentCount: number }
  substrate: { sharedJobCount: number; latestJobAt: string | null }
}

export default function SubstrateDashboardPage() {
  const { currentProperty } = usePropertyContext()
  const [jobs, setJobs] = useState<SharedJob[]>([])
  const [approvals, setApprovals] = useState<SharedApproval[]>([])
  const [contextBridge, setContextBridge] = useState<ContextBridge | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!currentProperty?.id) return

    setLoading(true)
    setError(null)
    try {
      const [jobsRes, approvalsRes, contextRes] = await Promise.all([
        fetch(`/api/substrate/jobs?propertyId=${currentProperty.id}`, { cache: 'no-store' }),
        fetch(`/api/substrate/approvals?propertyId=${currentProperty.id}`, { cache: 'no-store' }),
        fetch(`/api/substrate/context-bridge?propertyId=${currentProperty.id}`, { cache: 'no-store' }),
      ])

      const jobsJson = await jobsRes.json().catch(() => ({}))
      const approvalsJson = await approvalsRes.json().catch(() => ({}))
      const contextJson = await contextRes.json().catch(() => ({}))

      if (!jobsRes.ok) {
        throw new Error(typeof jobsJson.error === 'string' ? jobsJson.error : 'Failed to load jobs')
      }
      if (!approvalsRes.ok) {
        throw new Error(
          typeof approvalsJson.error === 'string' ? approvalsJson.error : 'Failed to load approvals'
        )
      }
      if (!contextRes.ok) {
        throw new Error(
          typeof contextJson.error === 'string' ? contextJson.error : 'Failed to load context bridge'
        )
      }

      setJobs(Array.isArray(jobsJson.jobs) ? jobsJson.jobs : [])
      setApprovals(Array.isArray(approvalsJson.approvals) ? approvalsJson.approvals : [])
      setContextBridge(contextJson.context || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load substrate activity')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [currentProperty?.id])

  const handleDecision = async (approval: SharedApproval, decisionStatus: 'approved' | 'denied' | 'modified') => {
    if (!currentProperty?.id) return
    const reason = window.prompt(`Reason for marking ${approval.actionType} as ${decisionStatus}:`, '')
    if (!reason) return

    let modifiedPayload: Record<string, unknown> | undefined
    if (decisionStatus === 'modified') {
      const rawPayload = window.prompt(
        'Optional modified payload JSON. Leave blank to cancel.',
        '{"connectionIds":[]}'
      )
      if (!rawPayload) return
      modifiedPayload = JSON.parse(rawPayload) as Record<string, unknown>
    }

    const response = await fetch('/api/substrate/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: currentProperty.id,
        actionAttemptId: approval.id,
        decisionStatus,
        decisionReason: reason,
        modifiedPayload,
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(payload.error || 'Approval update failed')
      return
    }

    await refresh()
  }

  const handleReplay = async (actionAttemptId: string) => {
    const response = await fetch(`/api/substrate/actions/${actionAttemptId}/replay`, {
      method: 'POST',
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(payload.error || 'Replay failed')
      return
    }

    await refresh()
  }

  const handleRecordOutcome = async (actionAttemptId: string) => {
    if (!currentProperty?.id) return
    const kpiName = window.prompt('KPI name (for example: tours_booked, qualified_leads, lease_conversion)', '')
    if (!kpiName) return
    const observedRaw = window.prompt('Observed value', '1')
    if (!observedRaw) return
    const observedValue = Number(observedRaw)
    if (!Number.isFinite(observedValue)) {
      window.alert('Observed value must be numeric')
      return
    }

    const response = await fetch('/api/substrate/outcomes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        propertyId: currentProperty.id,
        actionAttemptId,
        kpiName,
        observedValue,
        outcomeStatus: observedValue > 0 ? 'positive' : 'neutral',
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(payload.error || 'Outcome recording failed')
      return
    }

    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Shared Substrate</h1>
          <p className="text-sm text-slate-600">
            Jobs, approvals, replay, context snapshots, and delayed outcomes for the current property.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {!currentProperty?.id ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Select a property to inspect shared substrate activity.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {contextBridge ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Context Bridge Health</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="text-slate-500">Last snapshot basis</div>
              <div className="mt-1 font-medium text-slate-900">{contextBridge.asOf}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="text-slate-500">Knowledge sources / documents</div>
              <div className="mt-1 font-medium text-slate-900">
                {contextBridge.knowledge.sourceCount} / {contextBridge.knowledge.documentCount}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="text-slate-500">Shared jobs / latest job</div>
              <div className="mt-1 font-medium text-slate-900">
                {contextBridge.substrate.sharedJobCount}
                {contextBridge.substrate.latestJobAt ? ` / ${contextBridge.substrate.latestJobAt}` : ''}
              </div>
            </div>
          </div>
          <div className="mt-3 text-sm text-slate-600">
            Citations: {contextBridge.citations.map(citation => `${citation.domain}(${citation.tables.join(', ')})`).join(' · ')}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Pending Approvals</h2>
        <div className="mt-3 space-y-3">
          {approvals.length === 0 ? (
            <div className="text-sm text-slate-500">No pending approvals for this property.</div>
          ) : null}
          {approvals.map(approval => (
            <div key={approval.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium text-slate-900">{approval.actionType}</div>
                  <div className="text-sm text-slate-500">
                    proposed {approval.proposedAt} · state {approval.executionStatus}
                  </div>
                  {approval.policyReason ? (
                    <div className="mt-1 text-sm text-slate-600">Policy reason: {approval.policyReason}</div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDecision(approval, 'approved')}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecision(approval, 'modified')}
                    className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white"
                  >
                    Modify
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecision(approval, 'denied')}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white"
                  >
                    Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Shared Jobs</h2>
        <div className="mt-3 space-y-4">
          {jobs.length === 0 ? (
            <div className="text-sm text-slate-500">No shared jobs recorded for this property yet.</div>
          ) : null}
          {jobs.map(job => (
            <div key={job.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-col gap-1">
                <div className="font-medium text-slate-900">
                  {job.domain} · {job.subject_type}
                  {job.subject_id ? ` · ${job.subject_id}` : ''}
                </div>
                <div className="text-sm text-slate-500">
                  {job.lifecycle_status} · attempts {job.attempt_count}/{job.max_attempts}
                  {job.status_reason ? ` · ${job.status_reason}` : ''}
                </div>
                {job.error_message ? (
                  <div className="text-sm text-red-600">Job error: {job.error_message}</div>
                ) : null}
                {job.shared_context_snapshots?.[0] ? (
                  <div className="text-sm text-slate-600">
                    Context snapshot: {job.shared_context_snapshots[0].id} from{' '}
                    {job.shared_context_snapshots[0].source_domain}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {(job.shared_action_attempts || []).map(action => (
                  <div key={action.id} className="rounded-lg bg-slate-50 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="font-medium text-slate-900">
                          {action.action_type} · {action.proposal_decision_status} · {action.execution_status}
                        </div>
                        <div className="text-sm text-slate-500">
                          lifecycle {action.lifecycle_status}
                          {action.policy_reason ? ` · ${action.policy_reason}` : ''}
                          {typeof action.confidence_score === 'number'
                            ? ` · confidence ${action.confidence_score}`
                            : ''}
                        </div>
                        {action.error_message ? (
                          <div className="mt-1 text-sm text-red-600">Action error: {action.error_message}</div>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReplay(action.id)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                        >
                          Replay
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRecordOutcome(action.id)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                        >
                          Record Outcome
                        </button>
                      </div>
                    </div>

                    {action.shared_approvals?.length ? (
                      <div className="mt-3 space-y-1 text-sm text-slate-600">
                        {action.shared_approvals.map(approval => (
                          <div key={approval.id}>
                            Approval: {approval.decision_status} · {approval.decision_reason}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {action.shared_experiment_outcomes?.length ? (
                      <div className="mt-3 space-y-1 text-sm text-slate-600">
                        {action.shared_experiment_outcomes.map(outcome => (
                          <div key={outcome.id}>
                            Outcome: {outcome.kpi_name} · {outcome.outcome_status}
                            {typeof outcome.observed_value === 'number' ? ` · observed ${outcome.observed_value}` : ''}
                            {typeof outcome.delta_value === 'number' ? ` · delta ${outcome.delta_value}` : ''}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
