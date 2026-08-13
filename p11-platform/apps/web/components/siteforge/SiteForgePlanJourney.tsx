'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { SiteForgeReadinessCard } from '@/components/community/SiteForgeReadinessCard'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { buildGenerationRequest } from './orchestration'
import type { PersistedPlanRevision } from '@/utils/siteforge/plans/repository'

type ReadinessSummary = {
  status: 'draft' | 'needs_review' | 'ready' | 'approved' | 'stale'
  snapshot_payload?: {
    enabledCapabilities?: Array<'crm' | 'tours' | 'chatbot' | 'analytics'>
  } | null
}

export function canCreateSiteForgePlan(
  readiness: Pick<ReadinessSummary, 'status'> | null,
): boolean {
  return readiness?.status === 'approved'
}

export function directorPlanFromResponse(
  value: PersistedPlanRevision & { planState?: PersistedPlanRevision['status'] },
): PersistedPlanRevision {
  return {
    ...value,
    status: value.status || value.planState || 'ready_for_review',
    approvalActionAttemptId: value.approvalActionAttemptId || null,
  }
}

export function SiteForgePlanJourney({
  websiteId,
  propertyId,
  onChanged,
}: {
  websiteId: string
  propertyId: string
  onChanged: () => void
}) {
  const [readiness, setReadiness] = useState<ReadinessSummary | null>(null)
  const [plan, setPlan] = useState<PersistedPlanRevision | null>(null)
  const [direction, setDirection] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [readinessResponse, planResponse] = await Promise.all([
      fetch(
        `/api/onboarding/readiness?propertyId=${encodeURIComponent(propertyId)}`,
        { cache: 'no-store' },
      ),
      fetch(`/api/siteforge/plan?propertyId=${encodeURIComponent(propertyId)}`, {
        cache: 'no-store',
      }),
    ])
    const readinessBody = await readinessResponse.json().catch(() => ({}))
    const planBody = await planResponse.json().catch(() => ({}))
    if (!readinessResponse.ok) {
      throw new Error(readinessBody.error || 'Could not load onboarding readiness')
    }
    if (!planResponse.ok) {
      throw new Error(planBody.error || 'Could not load the SiteForge plan')
    }
    setReadiness(readinessBody.snapshots?.[0] || null)
    setPlan(planBody.plan || null)
  }, [propertyId])

  useEffect(() => {
    void load().catch(cause =>
      setError(cause instanceof Error ? cause.message : 'Could not load planning')
    )
  }, [load])

  async function savePlan() {
    if (!canCreateSiteForgePlan(readiness)) return
    setBusyAction('save')
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/siteforge/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          planId: plan?.planId,
          expectedRevision: plan?.revision,
          conversationHistory: [],
          userMessage: direction.trim() || null,
          preferences: {
            ctaPriority: 'contact',
            enabledCapabilities:
              readiness?.snapshot_payload?.enabledCapabilities || [],
          },
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not save plan')
      setPlan(
        directorPlanFromResponse(
          body as PersistedPlanRevision & {
            planState?: PersistedPlanRevision['status']
          },
        ),
      )
      setDirection('')
      setMessage(
        plan
          ? `Plan revision ${body.revision} is ready for review.`
          : 'The SiteForge plan is ready for review.',
      )
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save plan')
    } finally {
      setBusyAction(null)
    }
  }

  async function approvePlan() {
    if (!plan || !plan.readiness.ready) return
    setBusyAction('approve')
    setError('')
    setMessage('')
    try {
      const response = await fetch(
        `/api/siteforge/plans/${plan.planId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId,
            expectedRevision: plan.revision,
            contentHash: plan.contentHash,
            decisionStatus: 'approved',
            decisionReason: 'Approved in the SiteForge Web Director.',
          }),
        },
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not approve plan')
      setPlan(current =>
        current ? { ...current, status: 'confirmed' } : current
      )
      setMessage('Plan approved. Generation can now be started.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not approve plan')
    } finally {
      setBusyAction(null)
    }
  }

  async function startGeneration() {
    if (!plan || plan.status !== 'confirmed') return
    setBusyAction('generate')
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/siteforge/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildGenerationRequest(websiteId, plan, crypto.randomUUID()),
        ),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Could not start website generation')
      }
      setPlan(current =>
        current ? { ...current, status: 'consumed' } : current
      )
      setMessage('Website generation started. Track progress in Jobs & decisions.')
      onChanged()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not start generation',
      )
    } finally {
      setBusyAction(null)
    }
  }

  const readinessApproved = canCreateSiteForgePlan(readiness)
  const planCanBeEdited = !plan || plan.status !== 'consumed'

  return (
    <div className="space-y-4">
      <SiteForgeReadinessCard
        propertyId={propertyId}
        onChanged={() => void load()}
      />

      <Card>
        <CardHeader>
          <CardTitle>Create, revise, and approve the website plan</CardTitle>
          <CardDescription>
            Web Director is the authoritative planning path. Every revision is
            bound to the approved readiness snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!readinessApproved ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            >
              Resolve the readiness items above, rebuild the snapshot, and have
              a manager approve it before creating a plan.
            </div>
          ) : null}

          {plan ? (
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">Revision {plan.revision}</span>
                <span className="capitalize">
                  {plan.status.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-2 text-muted-foreground">{plan.plan.summary}</p>
              {plan.readiness.issues.map(issue => (
                <p
                  key={issue.code}
                  className={
                    issue.severity === 'blocker'
                      ? 'mt-2 text-red-700'
                      : 'mt-2 text-amber-700'
                  }
                >
                  {issue.message}
                </p>
              ))}
            </div>
          ) : null}

          {planCanBeEdited ? (
            <div className="space-y-2">
              <label htmlFor="siteforge-director-plan-direction" className="text-sm font-medium">
                {plan ? 'Revision direction' : 'Planning direction (optional)'}
              </label>
              <Textarea
                id="siteforge-director-plan-direction"
                value={direction}
                onChange={event => setDirection(event.target.value)}
                placeholder={
                  plan
                    ? 'Describe what should change in the next revision.'
                    : 'Add any operator direction; verified property truth remains authoritative.'
                }
                disabled={Boolean(busyAction) || !readinessApproved}
              />
            </div>
          ) : null}

          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          {message ? <p role="status" className="text-sm text-emerald-700">{message}</p> : null}

          <div className="flex flex-wrap justify-end gap-2">
            {planCanBeEdited ? (
              <Button
                variant="outline"
                disabled={
                  Boolean(busyAction) ||
                  !readinessApproved ||
                  Boolean(plan && !direction.trim())
                }
                onClick={() => void savePlan()}
              >
                {busyAction === 'save' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {plan ? 'Save new revision' : 'Create plan'}
              </Button>
            ) : null}
            {plan?.status === 'ready_for_review' ? (
              <Button
                disabled={Boolean(busyAction) || !plan.readiness.ready}
                onClick={() => void approvePlan()}
              >
                {busyAction === 'approve' ? 'Approving…' : 'Approve plan'}
              </Button>
            ) : null}
            {plan?.status === 'confirmed' ? (
              <Button
                disabled={Boolean(busyAction)}
                onClick={() => void startGeneration()}
              >
                {busyAction === 'generate'
                  ? 'Starting generation…'
                  : 'Start generation'}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
