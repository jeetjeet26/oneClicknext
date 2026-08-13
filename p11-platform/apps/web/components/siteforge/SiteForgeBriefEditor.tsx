'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  RepeatableSection,
  StringListInput,
  StructuredInput,
  TagInput,
} from './SiteForgeStructuredInputs'
import type {
  SiteForgeBrief,
  SiteForgeBriefContradiction,
} from '@/utils/siteforge/briefs/contracts'
import type { PersistedSiteForgeBrief } from '@/utils/siteforge/briefs/repository'

type Objective = SiteForgeBrief['objectives'][number]
type Audience = SiteForgeBrief['audiences'][number]
type Stakeholder = SiteForgeBrief['stakeholders'][number]
type Approver = SiteForgeBrief['approvers'][number]
type Constraint = SiteForgeBrief['legalConstraints'][number]
type Reference = SiteForgeBrief['references'][number]
type Kpi = SiteForgeBrief['kpis'][number]

const EMPTY_OBJECTIVE: Objective = {
  statement: '',
  priority: 'primary',
  successSignal: '',
}
const EMPTY_AUDIENCE: Audience = { segment: '', needs: [], objections: [] }
const EMPTY_STAKEHOLDER: Stakeholder = {
  name: '',
  role: '',
  decisionRights: [],
}
const EMPTY_APPROVER: Approver = { name: '', role: '' }
const EMPTY_CONSTRAINT: Constraint = {
  name: '',
  requirement: '',
  blocking: true,
}
const EMPTY_REFERENCE: Reference = { label: '' }
const EMPTY_KPI: Kpi = { name: '', target: '', measurement: '' }

export const EMPTY_SITEFORGE_BRIEF: SiteForgeBrief = {
  title: '',
  summary: '',
  objectives: [{ ...EMPTY_OBJECTIVE }],
  audiences: [{ ...EMPTY_AUDIENCE }],
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

export function updateBriefItem<T>(
  items: T[],
  index: number,
  changes: Partial<T>
): T[] {
  return items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...changes } : item
  )
}

export function removeBriefItem<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index)
}

export function hydrateBriefEditorContent(saved: PersistedSiteForgeBrief) {
  return {
    brief: saved.brief,
    contradictions: saved.unresolvedContradictions,
  }
}

export function briefHasUnresolvedContradictions(
  contradictions: SiteForgeBriefContradiction[]
): boolean {
  return contradictions.length > 0
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function SiteForgeBriefEditor({
  websiteId,
  onChanged,
}: {
  websiteId: string
  onChanged?: () => void
}) {
  const [briefs, setBriefs] = useState<PersistedSiteForgeBrief[]>([])
  const [brief, setBrief] = useState<SiteForgeBrief>(EMPTY_SITEFORGE_BRIEF)
  const [contradictions, setContradictions] = useState<
    SiteForgeBriefContradiction[]
  >([])
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

  function resume(saved: PersistedSiteForgeBrief) {
    const content = hydrateBriefEditorContent(saved)
    setBrief(content.brief)
    setContradictions(content.contradictions)
    setMessage(
      `Resumed brief version ${saved.version}. Saving creates a new immutable version.`
    )
  }

  function currentContent() {
    return { brief, unresolvedContradictions: contradictions }
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
                  modifiedBrief: brief,
                  unresolvedContradictions: contradictions,
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
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700"
        >
          {message}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            Durable website brief
            {current ? (
              <Badge variant="outline">
                v{current.version} · {current.status}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StructuredInput
              label="Title"
              value={brief.title}
              onChange={title => setBrief(value => ({ ...value, title }))}
              placeholder="The Aurora website brief"
              required
            />
            <StructuredInput
              label="Primary conversion"
              value={brief.conversion.primaryAction}
              onChange={primaryAction =>
                setBrief(value => ({
                  ...value,
                  conversion: { ...value.conversion, primaryAction },
                }))
              }
              placeholder="Schedule a tour"
              required
            />
          </div>

          <Field label="Summary">
            <Textarea
              value={brief.summary}
              onChange={event =>
                setBrief(value => ({ ...value, summary: event.target.value }))
              }
              placeholder="Describe the website's purpose and positioning."
              required
            />
          </Field>

          <RepeatableSection
            label="Objectives"
            description="Define what the website should accomplish and how you will recognize success."
            addLabel="Add objective"
            items={brief.objectives}
            onAdd={() =>
              setBrief(value => ({
                ...value,
                objectives: [...value.objectives, { ...EMPTY_OBJECTIVE }],
              }))
            }
            onRemove={index =>
              setBrief(value => ({
                ...value,
                objectives: removeBriefItem(value.objectives, index),
              }))
            }
            renderItem={index => {
              const objective = brief.objectives[index]
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  <StructuredInput
                    label="Objective"
                    value={objective.statement}
                    onChange={statement =>
                      setBrief(value => ({
                        ...value,
                        objectives: updateBriefItem(value.objectives, index, {
                          statement,
                        }),
                      }))
                    }
                    placeholder="Increase qualified tour requests"
                    required
                  />
                  <StructuredInput
                    label="Success signal"
                    value={objective.successSignal}
                    onChange={successSignal =>
                      setBrief(value => ({
                        ...value,
                        objectives: updateBriefItem(value.objectives, index, {
                          successSignal,
                        }),
                      }))
                    }
                    placeholder="15% more completed requests"
                    required
                  />
                  <Field label="Priority">
                    <select
                      className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                      value={objective.priority}
                      onChange={event =>
                        setBrief(value => ({
                          ...value,
                          objectives: updateBriefItem(value.objectives, index, {
                            priority: event.target.value as Objective['priority'],
                          }),
                        }))
                      }
                    >
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                    </select>
                  </Field>
                </div>
              )
            }}
          />

          <RepeatableSection
            label="Audiences"
            description="Describe each audience separately; add needs and objections as tags."
            addLabel="Add audience"
            items={brief.audiences}
            onAdd={() =>
              setBrief(value => ({
                ...value,
                audiences: [...value.audiences, { ...EMPTY_AUDIENCE }],
              }))
            }
            onRemove={index =>
              setBrief(value => ({
                ...value,
                audiences: removeBriefItem(value.audiences, index),
              }))
            }
            renderItem={index => {
              const audience = brief.audiences[index]
              return (
                <div className="space-y-3">
                  <StructuredInput
                    label="Audience segment"
                    value={audience.segment}
                    onChange={segment =>
                      setBrief(value => ({
                        ...value,
                        audiences: updateBriefItem(value.audiences, index, {
                          segment,
                        }),
                      }))
                    }
                    placeholder="Downtown renters"
                    required
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TagInput
                      label="Needs"
                      values={audience.needs}
                      onChange={needs =>
                        setBrief(value => ({
                          ...value,
                          audiences: updateBriefItem(value.audiences, index, {
                            needs,
                          }),
                        }))
                      }
                      placeholder="Availability"
                    />
                    <TagInput
                      label="Objections"
                      values={audience.objections}
                      onChange={objections =>
                        setBrief(value => ({
                          ...value,
                          audiences: updateBriefItem(value.audiences, index, {
                            objections,
                          }),
                        }))
                      }
                      placeholder="Parking cost"
                    />
                  </div>
                </div>
              )
            }}
          />

          <div className="grid gap-3 lg:grid-cols-3">
            <StringListInput
              label="Included pages"
              addLabel="Add page"
              values={brief.scope.includedPages}
              onChange={includedPages =>
                setBrief(value => ({
                  ...value,
                  scope: { ...value.scope, includedPages },
                }))
              }
              placeholder="Floor Plans"
              required
            />
            <StringListInput
              label="Excluded scope"
              addLabel="Add excluded item"
              values={brief.scope.excludedItems}
              onChange={excludedItems =>
                setBrief(value => ({
                  ...value,
                  scope: { ...value.scope, excludedItems },
                }))
              }
              placeholder="Resident portal"
            />
            <StringListInput
              label="Secondary actions"
              addLabel="Add action"
              values={brief.conversion.secondaryActions}
              onChange={secondaryActions =>
                setBrief(value => ({
                  ...value,
                  conversion: { ...value.conversion, secondaryActions },
                }))
              }
              placeholder="View availability"
            />
          </div>

          <Field label="Conversion funnel notes">
            <Textarea
              value={brief.conversion.funnelNotes}
              onChange={event =>
                setBrief(value => ({
                  ...value,
                  conversion: {
                    ...value.conversion,
                    funnelNotes: event.target.value,
                  },
                }))
              }
              placeholder="Explain how visitors should progress toward the primary action."
              required
            />
          </Field>

          <PeopleFields
            brief={brief}
            setBrief={setBrief}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Launch date">
              <input
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                type="date"
                value={brief.launchTarget.targetDate || ''}
                onChange={event =>
                  setBrief(value => ({
                    ...value,
                    launchTarget: {
                      ...value.launchTarget,
                      targetDate: event.target.value || null,
                    },
                  }))
                }
              />
            </Field>
            <StructuredInput
              label="Timezone"
              value={brief.launchTarget.timezone}
              onChange={timezone =>
                setBrief(value => ({
                  ...value,
                  launchTarget: { ...value.launchTarget, timezone },
                }))
              }
              placeholder="America/Los_Angeles"
              required
            />
            <Field label="Flexibility">
              <select
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={brief.launchTarget.flexibility}
                onChange={event =>
                  setBrief(value => ({
                    ...value,
                    launchTarget: {
                      ...value.launchTarget,
                      flexibility: event.target
                        .value as SiteForgeBrief['launchTarget']['flexibility'],
                    },
                  }))
                }
              >
                <option value="fixed">Fixed</option>
                <option value="target">Target</option>
                <option value="flexible">Flexible</option>
              </select>
            </Field>
          </div>

          <ConstraintFields brief={brief} setBrief={setBrief} />
          <ReferenceFields brief={brief} setBrief={setBrief} />
          <KpiFields brief={brief} setBrief={setBrief} />

          <RepeatableSection
            label="Unresolved contradictions"
            description="Record conflicts between trusted sources. Approval is blocked until this list is empty."
            addLabel="Add contradiction"
            items={contradictions}
            onAdd={() =>
              setContradictions(value => [
                ...value,
                {
                  id: `contradiction-${Date.now()}`,
                  field: '',
                  description: '',
                  sources: [],
                  resolutionNeeded: '',
                },
              ])
            }
            onRemove={index =>
              setContradictions(value => removeBriefItem(value, index))
            }
            renderItem={index => {
              const contradiction = contradictions[index]
              return (
                <div className="space-y-3">
                  <StructuredInput
                    label="Affected field"
                    value={contradiction.field}
                    onChange={field =>
                      setContradictions(value =>
                        updateBriefItem(value, index, { field })
                      )
                    }
                    required
                  />
                  <Field label="Conflict description">
                    <Textarea
                      value={contradiction.description}
                      onChange={event =>
                        setContradictions(value =>
                          updateBriefItem(value, index, {
                            description: event.target.value,
                          })
                        )
                      }
                      required
                    />
                  </Field>
                  <TagInput
                    label="Conflicting sources (at least two)"
                    values={contradiction.sources}
                    onChange={sources =>
                      setContradictions(value =>
                        updateBriefItem(value, index, { sources })
                      )
                    }
                    placeholder="Approved readiness snapshot"
                  />
                  <Field label="Resolution needed">
                    <Textarea
                      value={contradiction.resolutionNeeded}
                      onChange={event =>
                        setContradictions(value =>
                          updateBriefItem(value, index, {
                            resolutionNeeded: event.target.value,
                          })
                        )
                      }
                      required
                    />
                  </Field>
                </div>
              )
            }}
          />

          {contradictions.length ? (
            <p className="flex items-center gap-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              Approval remains blocked until every contradiction is resolved.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void save('draft')}
            >
              <Save className="mr-2 h-4 w-4" />
              Save draft
            </Button>
            <Button
              disabled={busy}
              onClick={() => void save('ready_for_review')}
            >
              <Check className="mr-2 h-4 w-4" />
              Save for review
            </Button>
          </div>
        </CardContent>
      </Card>

      {current?.status === 'ready_for_review' ? (
        <Card>
          <CardHeader>
            <CardTitle>Shared approval decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={decisionReason}
              onChange={event => setDecisionReason(event.target.value)}
              placeholder="Required rationale"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  busy ||
                  !decisionReason.trim() ||
                  briefHasUnresolvedContradictions(
                    current.unresolvedContradictions
                  )
                }
                onClick={() => void decide('approved')}
              >
                Approve exact brief
              </Button>
              <Button
                variant="outline"
                disabled={busy || !decisionReason.trim()}
                onClick={() => void decide('modified')}
              >
                Save fields as modification
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !decisionReason.trim()}
                onClick={() => void decide('denied')}
              >
                Deny
              </Button>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {briefs.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {briefs.map(saved => (
              <button
                key={saved.id}
                type="button"
                onClick={() => resume(saved)}
                className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-gray-50"
              >
                <span>
                  v{saved.version} · {saved.brief.title}
                </span>
                <Badge variant="secondary">{saved.status}</Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function PeopleFields({
  brief,
  setBrief,
}: {
  brief: SiteForgeBrief
  setBrief: React.Dispatch<React.SetStateAction<SiteForgeBrief>>
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RepeatableSection
        label="Stakeholders"
        addLabel="Add stakeholder"
        items={brief.stakeholders}
        onAdd={() =>
          setBrief(value => ({
            ...value,
            stakeholders: [...value.stakeholders, { ...EMPTY_STAKEHOLDER }],
          }))
        }
        onRemove={index =>
          setBrief(value => ({
            ...value,
            stakeholders: removeBriefItem(value.stakeholders, index),
          }))
        }
        renderItem={index => {
          const person = brief.stakeholders[index]
          return (
            <div className="space-y-3">
              <StructuredInput
                label="Name"
                value={person.name}
                onChange={name =>
                  setBrief(value => ({
                    ...value,
                    stakeholders: updateBriefItem(value.stakeholders, index, {
                      name,
                    }),
                  }))
                }
                required
              />
              <StructuredInput
                label="Role"
                value={person.role}
                onChange={role =>
                  setBrief(value => ({
                    ...value,
                    stakeholders: updateBriefItem(value.stakeholders, index, {
                      role,
                    }),
                  }))
                }
                required
              />
              <StructuredInput
                label="Email"
                type="email"
                value={person.email || ''}
                onChange={email =>
                  setBrief(value => ({
                    ...value,
                    stakeholders: updateBriefItem(value.stakeholders, index, {
                      email: email || undefined,
                    }),
                  }))
                }
              />
              <TagInput
                label="Decision rights"
                values={person.decisionRights}
                onChange={decisionRights =>
                  setBrief(value => ({
                    ...value,
                    stakeholders: updateBriefItem(value.stakeholders, index, {
                      decisionRights,
                    }),
                  }))
                }
                placeholder="Brand"
              />
            </div>
          )
        }}
      />
      <RepeatableSection
        label="Approvers"
        addLabel="Add approver"
        items={brief.approvers}
        onAdd={() =>
          setBrief(value => ({
            ...value,
            approvers: [...value.approvers, { ...EMPTY_APPROVER }],
          }))
        }
        onRemove={index =>
          setBrief(value => ({
            ...value,
            approvers: removeBriefItem(value.approvers, index),
          }))
        }
        renderItem={index => {
          const person = brief.approvers[index]
          return (
            <div className="space-y-3">
              <StructuredInput
                label="Name"
                value={person.name}
                onChange={name =>
                  setBrief(value => ({
                    ...value,
                    approvers: updateBriefItem(value.approvers, index, { name }),
                  }))
                }
                required
              />
              <StructuredInput
                label="Role"
                value={person.role}
                onChange={role =>
                  setBrief(value => ({
                    ...value,
                    approvers: updateBriefItem(value.approvers, index, { role }),
                  }))
                }
                required
              />
              <StructuredInput
                label="Email"
                type="email"
                value={person.email || ''}
                onChange={email =>
                  setBrief(value => ({
                    ...value,
                    approvers: updateBriefItem(value.approvers, index, {
                      email: email || undefined,
                    }),
                  }))
                }
              />
            </div>
          )
        }}
      />
    </div>
  )
}

function ConstraintFields({
  brief,
  setBrief,
}: {
  brief: SiteForgeBrief
  setBrief: React.Dispatch<React.SetStateAction<SiteForgeBrief>>
}) {
  function section(
    label: string,
    key: 'legalConstraints' | 'integrationConstraints'
  ) {
    const constraints = brief[key]
    return (
      <RepeatableSection
        label={label}
        addLabel={`Add ${label.toLowerCase().replace(/s$/, '')}`}
        items={constraints}
        onAdd={() =>
          setBrief(value => ({
            ...value,
            [key]: [...value[key], { ...EMPTY_CONSTRAINT }],
          }))
        }
        onRemove={index =>
          setBrief(value => ({
            ...value,
            [key]: removeBriefItem(value[key], index),
          }))
        }
        renderItem={index => {
          const constraint = constraints[index]
          return (
            <div className="space-y-3">
              <StructuredInput
                label="Name"
                value={constraint.name}
                onChange={name =>
                  setBrief(value => ({
                    ...value,
                    [key]: updateBriefItem(value[key], index, { name }),
                  }))
                }
                required
              />
              <Field label="Requirement">
                <Textarea
                  value={constraint.requirement}
                  onChange={event =>
                    setBrief(value => ({
                      ...value,
                      [key]: updateBriefItem(value[key], index, {
                        requirement: event.target.value,
                      }),
                    }))
                  }
                  required
                />
              </Field>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={constraint.blocking}
                  onChange={event =>
                    setBrief(value => ({
                      ...value,
                      [key]: updateBriefItem(value[key], index, {
                        blocking: event.target.checked,
                      }),
                    }))
                  }
                />
                Blocks approval or launch
              </label>
            </div>
          )
        }}
      />
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {section('Legal constraints', 'legalConstraints')}
      {section('Integration constraints', 'integrationConstraints')}
    </div>
  )
}

function ReferenceFields({
  brief,
  setBrief,
}: {
  brief: SiteForgeBrief
  setBrief: React.Dispatch<React.SetStateAction<SiteForgeBrief>>
}) {
  return (
    <RepeatableSection
      label="References"
      addLabel="Add reference"
      items={brief.references}
      onAdd={() =>
        setBrief(value => ({
          ...value,
          references: [...value.references, { ...EMPTY_REFERENCE }],
        }))
      }
      onRemove={index =>
        setBrief(value => ({
          ...value,
          references: removeBriefItem(value.references, index),
        }))
      }
      renderItem={index => {
        const reference = brief.references[index]
        function update(changes: Partial<Reference>) {
          setBrief(value => ({
            ...value,
            references: updateBriefItem(value.references, index, changes),
          }))
        }
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <StructuredInput
              label="Label"
              value={reference.label}
              onChange={label => update({ label })}
              required
            />
            <StructuredInput
              label="URL"
              type="url"
              value={reference.url || ''}
              onChange={url => update({ url: url || undefined })}
              placeholder="https://"
            />
            <StructuredInput
              label="Source ID"
              value={reference.sourceId || ''}
              onChange={sourceId =>
                update({ sourceId: sourceId || undefined })
              }
            />
            <StructuredInput
              label="Notes"
              value={reference.notes || ''}
              onChange={notes => update({ notes: notes || undefined })}
            />
          </div>
        )
      }}
    />
  )
}

function KpiFields({
  brief,
  setBrief,
}: {
  brief: SiteForgeBrief
  setBrief: React.Dispatch<React.SetStateAction<SiteForgeBrief>>
}) {
  return (
    <RepeatableSection
      label="KPIs"
      addLabel="Add KPI"
      items={brief.kpis}
      onAdd={() =>
        setBrief(value => ({
          ...value,
          kpis: [...value.kpis, { ...EMPTY_KPI }],
        }))
      }
      onRemove={index =>
        setBrief(value => ({
          ...value,
          kpis: removeBriefItem(value.kpis, index),
        }))
      }
      renderItem={index => {
        const kpi = brief.kpis[index]
        function update(changes: Partial<Kpi>) {
          setBrief(value => ({
            ...value,
            kpis: updateBriefItem(value.kpis, index, changes),
          }))
        }
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <StructuredInput
              label="Metric"
              value={kpi.name}
              onChange={name => update({ name })}
              placeholder="Tour requests"
              required
            />
            <StructuredInput
              label="Target"
              value={kpi.target}
              onChange={target => update({ target })}
              placeholder="+15%"
              required
            />
            <StructuredInput
              label="Measurement"
              value={kpi.measurement}
              onChange={measurement => update({ measurement })}
              placeholder="Submitted tour forms"
              required
            />
            <StructuredInput
              label="Owner"
              value={kpi.owner || ''}
              onChange={owner => update({ owner: owner || undefined })}
              placeholder="Leasing"
            />
          </div>
        )
      }}
    />
  )
}
