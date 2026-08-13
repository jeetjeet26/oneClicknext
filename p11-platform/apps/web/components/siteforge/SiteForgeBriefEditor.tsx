'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type {
  SiteForgeBrief,
  SiteForgeBriefContradiction,
} from '@/utils/siteforge/briefs/contracts'
import type { PersistedSiteForgeBrief } from '@/utils/siteforge/briefs/repository'

function lines(value: string): string[] {
  return value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
}

function cells(value: string): string[][] {
  return lines(value).map(line => line.split('|').map(item => item.trim()))
}

export const EMPTY_SITEFORGE_BRIEF: SiteForgeBrief = {
  title: '',
  summary: '',
  objectives: [{ statement: '', priority: 'primary', successSignal: '' }],
  audiences: [{ segment: '', needs: [], objections: [] }],
  conversion: { primaryAction: '', secondaryActions: [], funnelNotes: '' },
  scope: { includedPages: ['Home'], excludedItems: [] },
  stakeholders: [],
  approvers: [],
  launchTarget: {
    targetDate: null,
    timezone: 'America/Los_Angeles',
    flexibility: 'target',
  },
  legalConstraints: [],
  integrationConstraints: [],
  references: [],
  kpis: [],
}

export function buildBriefFromEditorFields(input: {
  base: SiteForgeBrief
  objectives: string
  audiences: string
  stakeholders: string
  approvers: string
  legalConstraints: string
  integrationConstraints: string
  references: string
  kpis: string
}): SiteForgeBrief {
  return {
    ...input.base,
    objectives: cells(input.objectives).map(
      ([statement = '', successSignal = '', priority = 'secondary']) => ({
        statement,
        successSignal,
        priority: priority === 'primary' ? 'primary' : 'secondary',
      })
    ),
    audiences: cells(input.audiences).map(
      ([segment = '', needs = '', objections = '']) => ({
        segment,
        needs: needs.split(',').map(item => item.trim()).filter(Boolean),
        objections: objections
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
      })
    ),
    stakeholders: cells(input.stakeholders).map(
      ([name = '', role = '', email = '', rights = '']) => ({
        name,
        role,
        ...(email ? { email } : {}),
        decisionRights: rights
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
      })
    ),
    approvers: cells(input.approvers).map(
      ([name = '', role = '', email = '']) => ({
        name,
        role,
        ...(email ? { email } : {}),
      })
    ),
    legalConstraints: cells(input.legalConstraints).map(
      ([name = '', requirement = '', blocking = 'true']) => ({
        name,
        requirement,
        blocking: blocking !== 'false',
      })
    ),
    integrationConstraints: cells(input.integrationConstraints).map(
      ([name = '', requirement = '', blocking = 'true']) => ({
        name,
        requirement,
        blocking: blocking !== 'false',
      })
    ),
    references: cells(input.references).map(
      ([label = '', url = '', sourceId = '', notes = '']) => ({
        label,
        ...(url ? { url } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(notes ? { notes } : {}),
      })
    ),
    kpis: cells(input.kpis).map(
      ([name = '', target = '', measurement = '', owner = '']) => ({
        name,
        target,
        measurement,
        ...(owner ? { owner } : {}),
      })
    ),
  }
}

function joinRows(rows: Array<Array<string | undefined>>): string {
  return rows.map(row => row.map(value => value || '').join(' | ')).join('\n')
}

export function SiteForgeBriefEditor({
  websiteId,
  onChanged,
}: {
  websiteId: string
  onChanged?: () => void
}) {
  const [briefs, setBriefs] = useState<PersistedSiteForgeBrief[]>([])
  const [base, setBase] = useState<SiteForgeBrief>(EMPTY_SITEFORGE_BRIEF)
  const [objectives, setObjectives] = useState('')
  const [audiences, setAudiences] = useState('')
  const [stakeholders, setStakeholders] = useState('')
  const [approvers, setApprovers] = useState('')
  const [legal, setLegal] = useState('')
  const [integrations, setIntegrations] = useState('')
  const [references, setReferences] = useState('')
  const [kpis, setKpis] = useState('')
  const [contradictions, setContradictions] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/siteforge/briefs?websiteId=${encodeURIComponent(websiteId)}`,
      { cache: 'no-store' }
    )
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || 'Failed to load briefs')
    setBriefs(body.briefs || [])
  }, [websiteId])

  useEffect(() => {
    void load().catch(cause =>
      setError(cause instanceof Error ? cause.message : 'Failed to load briefs')
    )
  }, [load])

  function resume(brief: PersistedSiteForgeBrief) {
    setBase(brief.brief)
    setObjectives(
      joinRows(
        brief.brief.objectives.map(item => [
          item.statement,
          item.successSignal,
          item.priority,
        ])
      )
    )
    setAudiences(
      joinRows(
        brief.brief.audiences.map(item => [
          item.segment,
          item.needs.join(', '),
          item.objections.join(', '),
        ])
      )
    )
    setStakeholders(
      joinRows(
        brief.brief.stakeholders.map(item => [
          item.name,
          item.role,
          item.email,
          item.decisionRights.join(', '),
        ])
      )
    )
    setApprovers(
      joinRows(
        brief.brief.approvers.map(item => [
          item.name,
          item.role,
          item.email,
        ])
      )
    )
    setLegal(
      joinRows(
        brief.brief.legalConstraints.map(item => [
          item.name,
          item.requirement,
          String(item.blocking),
        ])
      )
    )
    setIntegrations(
      joinRows(
        brief.brief.integrationConstraints.map(item => [
          item.name,
          item.requirement,
          String(item.blocking),
        ])
      )
    )
    setReferences(
      joinRows(
        brief.brief.references.map(item => [
          item.label,
          item.url,
          item.sourceId,
          item.notes,
        ])
      )
    )
    setKpis(
      joinRows(
        brief.brief.kpis.map(item => [
          item.name,
          item.target,
          item.measurement,
          item.owner,
        ])
      )
    )
    setContradictions(
      joinRows(
        brief.unresolvedContradictions.map(item => [
          item.field,
          item.description,
          item.sources.join(', '),
          item.resolutionNeeded,
        ])
      )
    )
    setMessage(`Resumed brief version ${brief.version}. Saving creates a new immutable version.`)
  }

  function currentContent() {
    const brief = buildBriefFromEditorFields({
      base,
      objectives,
      audiences,
      stakeholders,
      approvers,
      legalConstraints: legal,
      integrationConstraints: integrations,
      references,
      kpis,
    })
    const unresolvedContradictions: SiteForgeBriefContradiction[] = cells(
      contradictions
    ).map(([field = '', description = '', sources = '', resolutionNeeded = ''], index) => ({
      id: `contradiction-${index + 1}`,
      field,
      description,
      sources: sources.split(',').map(item => item.trim()).filter(Boolean),
      resolutionNeeded,
    }))
    return { brief, unresolvedContradictions }
  }

  async function save(status: 'draft' | 'ready_for_review') {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/siteforge/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          expectedVersion: briefs[0]?.version || 0,
          status,
          ...currentContent(),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to save brief')
      setMessage(
        status === 'draft'
          ? 'Saved a new immutable draft.'
          : 'Saved a new version ready for review.'
      )
      await load()
      onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save brief')
    } finally {
      setBusy(false)
    }
  }

  async function decide(
    decisionStatus: 'approved' | 'denied' | 'modified'
  ) {
    const current = briefs[0]
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/siteforge/briefs/${current.id}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: current.propertyId,
            contentHash: current.contentHash,
            decisionStatus,
            decisionReason,
            ...(decisionStatus === 'modified'
              ? {
                  modifiedBrief: currentContent().brief,
                  unresolvedContradictions:
                    currentContent().unresolvedContradictions,
                }
              : {}),
          }),
        }
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to decide brief')
      setMessage(`Brief decision recorded: ${decisionStatus}.`)
      setDecisionReason('')
      await load()
      onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to decide brief')
    } finally {
      setBusy(false)
    }
  }

  const current = briefs[0]
  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            Durable website brief
            {current ? <Badge variant="outline">v{current.version} · {current.status}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title"><input className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={base.title} onChange={event => setBase(value => ({ ...value, title: event.target.value }))} /></Field>
            <Field label="Primary conversion"><input className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={base.conversion.primaryAction} onChange={event => setBase(value => ({ ...value, conversion: { ...value.conversion, primaryAction: event.target.value } }))} /></Field>
          </div>
          <Field label="Summary"><Textarea value={base.summary} onChange={event => setBase(value => ({ ...value, summary: event.target.value }))} /></Field>
          <StructuredField label="Objectives" hint="statement | success signal | primary/secondary" value={objectives} onChange={setObjectives} />
          <StructuredField label="Audiences" hint="segment | comma-separated needs | comma-separated objections" value={audiences} onChange={setAudiences} />
          <div className="grid gap-3 sm:grid-cols-2">
            <StructuredField label="Included pages" hint="one per line" value={base.scope.includedPages.join('\n')} onChange={value => setBase(currentBase => ({ ...currentBase, scope: { ...currentBase.scope, includedPages: lines(value) } }))} />
            <StructuredField label="Excluded scope" hint="one per line" value={base.scope.excludedItems.join('\n')} onChange={value => setBase(currentBase => ({ ...currentBase, scope: { ...currentBase.scope, excludedItems: lines(value) } }))} />
          </div>
          <Field label="Conversion funnel notes"><Textarea value={base.conversion.funnelNotes} onChange={event => setBase(value => ({ ...value, conversion: { ...value.conversion, funnelNotes: event.target.value } }))} /></Field>
          <StructuredField label="Secondary actions" hint="one per line" value={base.conversion.secondaryActions.join('\n')} onChange={value => setBase(currentBase => ({ ...currentBase, conversion: { ...currentBase.conversion, secondaryActions: lines(value) } }))} />
          <StructuredField label="Stakeholders" hint="name | role | email | decision rights" value={stakeholders} onChange={setStakeholders} />
          <StructuredField label="Approvers" hint="name | role | email" value={approvers} onChange={setApprovers} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Launch date"><input className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" type="date" value={base.launchTarget.targetDate || ''} onChange={event => setBase(value => ({ ...value, launchTarget: { ...value.launchTarget, targetDate: event.target.value || null } }))} /></Field>
            <Field label="Timezone"><input className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={base.launchTarget.timezone} onChange={event => setBase(value => ({ ...value, launchTarget: { ...value.launchTarget, timezone: event.target.value } }))} /></Field>
            <Field label="Flexibility">
              <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={base.launchTarget.flexibility} onChange={event => setBase(value => ({ ...value, launchTarget: { ...value.launchTarget, flexibility: event.target.value as SiteForgeBrief['launchTarget']['flexibility'] } }))}>
                <option value="fixed">Fixed</option><option value="target">Target</option><option value="flexible">Flexible</option>
              </select>
            </Field>
          </div>
          <StructuredField label="Legal constraints" hint="name | requirement | true/false blocking" value={legal} onChange={setLegal} />
          <StructuredField label="Integration constraints" hint="name | requirement | true/false blocking" value={integrations} onChange={setIntegrations} />
          <StructuredField label="References" hint="label | URL | source ID | notes" value={references} onChange={setReferences} />
          <StructuredField label="KPIs" hint="name | target | measurement | owner" value={kpis} onChange={setKpis} />
          <StructuredField label="Unresolved contradictions" hint="field | description | source A, source B | resolution needed" value={contradictions} onChange={setContradictions} />
          {lines(contradictions).length ? (
            <p className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Approval remains blocked until every contradiction is resolved.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void save('draft')}><Save className="mr-2 h-4 w-4" />Save draft</Button>
            <Button disabled={busy} onClick={() => void save('ready_for_review')}><Check className="mr-2 h-4 w-4" />Save for review</Button>
          </div>
        </CardContent>
      </Card>
      {current?.status === 'ready_for_review' ? (
        <Card>
          <CardHeader><CardTitle>Shared approval decision</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={decisionReason} onChange={event => setDecisionReason(event.target.value)} placeholder="Required rationale" />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !decisionReason.trim() || current.unresolvedContradictions.length > 0} onClick={() => void decide('approved')}>Approve exact brief</Button>
              <Button variant="outline" disabled={busy || !decisionReason.trim()} onClick={() => void decide('modified')}>Save fields as modification</Button>
              <Button variant="destructive" disabled={busy || !decisionReason.trim()} onClick={() => void decide('denied')}>Deny</Button>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {briefs.length ? (
        <Card>
          <CardHeader><CardTitle>Version history</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {briefs.map(brief => (
              <button key={brief.id} type="button" onClick={() => resume(brief)} className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-gray-50">
                <span>v{brief.version} · {brief.brief.title}</span>
                <Badge variant="secondary">{brief.status}</Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5 text-sm font-medium"><span>{label}</span>{children}</label>
}

function StructuredField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><Textarea value={value} onChange={event => onChange(event.target.value)} placeholder={hint} rows={3} /><span className="block text-xs font-normal text-gray-500">{hint}</span></Field>
}
