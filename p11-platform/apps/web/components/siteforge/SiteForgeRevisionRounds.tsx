'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { sanitizeSemanticOperations } from '@/utils/siteforge/review/client-preview'

type ArtifactIdentity = {
  id: string
  version: number
  content_hash: string
}

type ReviewComment = {
  id: string
  revision_round_id: string | null
  page_path: string
  section_id: string | null
  body: string
  category: string
  status: string
  disposition_reason: string | null
  semantic_operations: unknown
  resulting_artifact_id: string | null
}

type ReviewRound = {
  id: string
  round_number: number
  status: string
  requested_by_name: string | null
  requested_by_email: string | null
  assigned_to: string | null
  due_at: string | null
  resulting_artifact_id: string | null
  resulting_content_hash: string | null
  disposition: {
    open: number
    accepted: number
    rejected: number
    verified: number
  }
}

type ReviewState = {
  currentArtifact: {
    id: string
    version: number
    contentHash: string
  } | null
  sessions: Array<{
    session: {
      id: string
      artifact_id: string
      artifact_content_hash: string
      title: string
      instructions: string | null
      status: string
      opened_at: string
      closes_at: string | null
    }
    stale: boolean
    rounds: ReviewRound[]
    comments: ReviewComment[]
    decisions: Array<{
      id: string
      decision: string
      rationale: string
      created_at: string
      approvalValid: boolean
    }>
    tokens: Array<{
      id: string
      reviewer_name: string | null
      reviewer_email: string | null
      permissions: string[]
      expires_at: string
      revoked_at: string | null
      last_used_at: string | null
    }>
  }>
}

type TraceDraft = {
  interpretation: string
  operation: string
  target: string
  summary: string
}

const ROUND_STATUSES = [
  'collecting',
  'ready_for_work',
  'in_progress',
  'ready_for_verification',
  'verified',
  'closed',
]

function toDateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function SiteForgeRevisionRounds({
  websiteId,
  currentArtifact,
}: {
  websiteId: string
  currentArtifact: ArtifactIdentity
}) {
  const [state, setState] = useState<ReviewState | null>(null)
  const [title, setTitle] = useState('Client website review')
  const [instructions, setInstructions] = useState('')
  const [reviewerName, setReviewerName] = useState('')
  const [reviewerEmail, setReviewerEmail] = useState('')
  const [permissions, setPermissions] = useState<string[]>([
    'view',
    'comment',
    'decide',
  ])
  const [tokenExpiry, setTokenExpiry] = useState(() =>
    toDateTimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000))
  )
  const [issuedLink, setIssuedLink] = useState<string | null>(null)
  const [roundRequester, setRoundRequester] = useState('')
  const [roundAssignee, setRoundAssignee] = useState('')
  const [roundDueAt, setRoundDueAt] = useState('')
  const [traceDrafts, setTraceDrafts] = useState<Record<string, TraceDraft>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/siteforge/reviews?websiteId=${encodeURIComponent(websiteId)}`,
      { cache: 'no-store' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || 'Review rounds could not be loaded')
    }
    setState(data as ReviewState)
  }, [websiteId])

  useEffect(() => {
    let cancelled = false
    void load().catch(cause => {
      if (!cancelled) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Review rounds could not be loaded'
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const activeSession = useMemo(
    () => {
      const current = state?.sessions.find(
        item =>
          !item.stale &&
          ['open', 'changes_requested'].includes(item.session.status) &&
          item.session.artifact_id === currentArtifact.id &&
          item.session.artifact_content_hash === currentArtifact.content_hash
      )
      if (current) return current
      return (
        state?.sessions.find(
          item =>
            item.stale &&
            item.rounds.some(
              round => !['verified', 'closed'].includes(round.status)
            )
        ) || null
      )
    },
    [currentArtifact.content_hash, currentArtifact.id, state?.sessions]
  )
  const externalReviewActive = Boolean(
    activeSession &&
      !activeSession.stale &&
      activeSession.session.artifact_id === currentArtifact.id &&
      activeSession.session.artifact_content_hash ===
        currentArtifact.content_hash
  )

  async function runAction(action: () => Promise<void>) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Review action could not complete'
      )
    } finally {
      setPending(false)
    }
  }

  async function createSession() {
    await runAction(async () => {
      const response = await fetch('/api/siteforge/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websiteId,
          artifactId: currentArtifact.id,
          contentHash: currentArtifact.content_hash,
          title: title.trim(),
          instructions: instructions.trim() || null,
          clientSafeSummary: {
            revision: currentArtifact.version,
          },
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Review session was not created')
      }
    })
  }

  async function issueToken() {
    if (!activeSession || !externalReviewActive) return
    await runAction(async () => {
      const response = await fetch(
        `/api/siteforge/reviews/${activeSession.session.id}/tokens`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewerName: reviewerName.trim() || null,
            reviewerEmail: reviewerEmail.trim() || null,
            permissions,
            expiresAt: new Date(tokenExpiry).toISOString(),
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Review link was not created')
      }
      setIssuedLink(`${window.location.origin}${data.reviewPath}`)
    })
  }

  async function revokeToken(tokenId: string) {
    if (!activeSession) return
    await runAction(async () => {
      const response = await fetch(
        `/api/siteforge/reviews/${activeSession.session.id}/tokens`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokenId }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Review link was not revoked')
    })
  }

  async function createRound() {
    if (!activeSession || !externalReviewActive) return
    await runAction(async () => {
      const response = await fetch(
        `/api/siteforge/reviews/${activeSession.session.id}/rounds`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestedByName: roundRequester.trim() || null,
            assignedTo: roundAssignee.trim() || null,
            dueAt: roundDueAt
              ? new Date(roundDueAt).toISOString()
              : null,
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Revision round was not created')
      setRoundRequester('')
      setRoundAssignee('')
      setRoundDueAt('')
    })
  }

  async function updateRound(
    round: ReviewRound,
    status: string,
    pinCurrentArtifact = false
  ) {
    if (!activeSession) return
    await runAction(async () => {
      const response = await fetch(
        `/api/siteforge/reviews/${activeSession.session.id}/rounds/${round.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            ...(pinCurrentArtifact
              ? {
                  resultingArtifactId: currentArtifact.id,
                  resultingContentHash: currentArtifact.content_hash,
                }
              : {}),
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Revision round was not updated')
    })
  }

  function traceDraft(commentId: string): TraceDraft {
    return (
      traceDrafts[commentId] || {
        interpretation: '',
        operation: '',
        target: '',
        summary: '',
      }
    )
  }

  function updateTraceDraft(commentId: string, patch: Partial<TraceDraft>) {
    setTraceDrafts(current => ({
      ...current,
      [commentId]: { ...traceDraft(commentId), ...patch },
    }))
  }

  async function saveTrace(comment: ReviewComment, verified: boolean) {
    if (!activeSession) return
    const draft = traceDraft(comment.id)
    await runAction(async () => {
      const response = await fetch(
        `/api/siteforge/reviews/${activeSession.session.id}/comments/${comment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: verified ? 'verified' : 'accepted',
            interpretation: draft.interpretation.trim(),
            semanticOperations: draft.operation.trim()
              ? [
                  {
                    operation: draft.operation.trim(),
                    target: draft.target.trim(),
                    summary: draft.summary.trim() || undefined,
                    pagePath: comment.page_path,
                    sectionId: comment.section_id || undefined,
                  },
                ]
              : [],
            resultingArtifactId: verified ? currentArtifact.id : null,
            resultingContentHash: verified
              ? currentArtifact.content_hash
              : null,
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Comment trace was not saved')
      setTraceDrafts(current => {
        const next = { ...current }
        delete next[comment.id]
        return next
      })
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Client review & revision rounds
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Client decisions are evidence for this exact artifact. They do not
              replace internal deployment approval.
            </p>
          </div>
          <Badge variant={activeSession ? 'success' : 'outline'}>
            {activeSession
              ? activeSession.stale
                ? 'Completing stale revision trace'
                : activeSession.session.status
              : 'No active review'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!activeSession ? (
          <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
            <div>
              <Label htmlFor="review-title">Review title</Label>
              <Textarea
                id="review-title"
                className="mt-1 min-h-10"
                value={title}
                onChange={event => setTitle(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="review-instructions">Client instructions</Label>
              <Textarea
                id="review-instructions"
                className="mt-1 min-h-10"
                value={instructions}
                onChange={event => setInstructions(event.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Button
                type="button"
                size="sm"
                disabled={pending || !title.trim()}
                onClick={() => void createSession()}
              >
                Open review for revision {currentArtifact.version}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {activeSession.stale ? (
              <p
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
              >
                A newer artifact is current. External access and approval for
                this session are invalid, but its revision trace remains open
                until the round is verified or closed.
              </p>
            ) : null}
            <section className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">External review link</h3>
                  <p className="text-xs text-muted-foreground">
                    The raw credential is displayed only when it is created.
                  </p>
                </div>
                <Badge variant="outline">
                  Artifact {activeSession.session.artifact_id}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label htmlFor="reviewer-name">Reviewer name</Label>
                  <Textarea
                    id="reviewer-name"
                    className="mt-1 min-h-10"
                    value={reviewerName}
                    onChange={event => setReviewerName(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="reviewer-email">Reviewer email</Label>
                  <Textarea
                    id="reviewer-email"
                    className="mt-1 min-h-10"
                    value={reviewerEmail}
                    onChange={event => setReviewerEmail(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="review-expiry">Expires</Label>
                  <input
                    id="review-expiry"
                    type="datetime-local"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={tokenExpiry}
                    onChange={event => setTokenExpiry(event.target.value)}
                  />
                </div>
              </div>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="mb-1 text-xs font-medium">Permissions</legend>
                {['view', 'comment', 'decide'].map(permission => (
                  <label key={permission} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={permissions.includes(permission)}
                      disabled={permission === 'view'}
                      onChange={event =>
                        setPermissions(current =>
                          event.target.checked
                            ? [...new Set([...current, permission])]
                            : current.filter(item => item !== permission)
                        )
                      }
                    />
                    {permission}
                  </label>
                ))}
              </fieldset>
              <Button
                type="button"
                size="sm"
                disabled={
                  pending ||
                  !externalReviewActive ||
                  !tokenExpiry ||
                  permissions.length === 0
                }
                onClick={() => void issueToken()}
              >
                {externalReviewActive
                  ? 'Create expiring review link'
                  : 'External access closed for stale artifact'}
              </Button>
              {issuedLink ? (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                  <p className="font-medium">Copy this link now</p>
                  <p className="mt-1 break-all font-mono">{issuedLink}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => void navigator.clipboard.writeText(issuedLink)}
                  >
                    Copy link
                  </Button>
                </div>
              ) : null}
              {activeSession.tokens.map(token => (
                <div
                  key={token.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
                >
                  <div>
                    <p className="font-medium">
                      {token.reviewer_name || 'Unnamed reviewer'}
                    </p>
                    <p className="text-muted-foreground">
                      {token.permissions.join(', ')} · expires{' '}
                      {new Date(token.expires_at).toLocaleString()}
                    </p>
                  </div>
                  {token.revoked_at ? (
                    <Badge variant="outline">Revoked</Badge>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void revokeToken(token.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </section>

            <section className="space-y-3 rounded-lg border p-3">
              <h3 className="text-sm font-semibold">Create revision round</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <Textarea
                  aria-label="Revision requester"
                  className="min-h-10"
                  placeholder="Requester name"
                  value={roundRequester}
                  onChange={event => setRoundRequester(event.target.value)}
                />
                <Textarea
                  aria-label="Revision assignee profile ID"
                  className="min-h-10"
                  placeholder="Assignee profile UUID"
                  value={roundAssignee}
                  onChange={event => setRoundAssignee(event.target.value)}
                />
                <input
                  aria-label="Revision due date"
                  type="datetime-local"
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  value={roundDueAt}
                  onChange={event => setRoundDueAt(event.target.value)}
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={pending || !externalReviewActive}
                onClick={() => void createRound()}
              >
                {externalReviewActive
                  ? 'Add numbered round'
                  : 'New rounds require a current review'}
              </Button>
            </section>

            {activeSession.rounds.map(round => {
              const roundComments = activeSession.comments.filter(
                comment => comment.revision_round_id === round.id
              )
              return (
                <section key={round.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Revision round {round.round_number}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Requested by {round.requested_by_name || 'SiteForge team'}
                        {round.due_at
                          ? ` · due ${new Date(round.due_at).toLocaleString()}`
                          : ''}
                      </p>
                    </div>
                    <Select
                      className="w-56"
                      value={round.status}
                      onValueChange={value =>
                        void updateRound(round, value, value === 'verified')
                      }
                      disabled={pending}
                    >
                      {ROUND_STATUSES.map(status => (
                        <SelectItem key={status} value={status}>
                          {status.replaceAll('_', ' ')}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded bg-muted p-2">
                      Open {round.disposition.open}
                    </div>
                    <div className="rounded bg-muted p-2">
                      Accepted {round.disposition.accepted}
                    </div>
                    <div className="rounded bg-muted p-2">
                      Declined {round.disposition.rejected}
                    </div>
                    <div className="rounded bg-muted p-2">
                      Verified {round.disposition.verified}
                    </div>
                  </div>
                  {round.resulting_artifact_id ? (
                    <div className="rounded border bg-muted/30 p-2 text-xs">
                      <p className="font-medium">Semantic revision diff</p>
                      <p className="mt-1 break-all font-mono">
                        {activeSession.session.artifact_id} →{' '}
                        {round.resulting_artifact_id}
                      </p>
                    </div>
                  ) : null}
                  {roundComments.map(comment => {
                    const operations = sanitizeSemanticOperations(
                      comment.semantic_operations
                    )
                    const draft = traceDraft(comment.id)
                    return (
                      <article
                        key={comment.id}
                        className="space-y-2 rounded border bg-muted/20 p-3 text-sm"
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">
                            {comment.page_path}
                            {comment.section_id ? ` · ${comment.section_id}` : ''}
                          </span>
                          <Badge variant="outline">{comment.status}</Badge>
                        </div>
                        <p className="whitespace-pre-wrap">{comment.body}</p>
                        {comment.disposition_reason ? (
                          <div className="rounded border bg-background p-2 text-xs">
                            <p>
                              <strong>Interpretation:</strong>{' '}
                              {comment.disposition_reason}
                            </p>
                            {operations.map((operation, index) => (
                              <p
                                key={`${operation.operation}-${operation.target}-${index}`}
                                className="mt-1"
                              >
                                <strong>Operation:</strong>{' '}
                                {operation.operation} → {operation.target}
                              </p>
                            ))}
                            <p className="mt-1">
                              <strong>Result:</strong>{' '}
                              {comment.resulting_artifact_id || 'pending'} ·{' '}
                              <strong>Verification:</strong> {comment.status}
                            </p>
                          </div>
                        ) : (
                          <details className="rounded border bg-background p-2">
                            <summary className="cursor-pointer text-xs font-medium">
                              Capture interpretation and semantic diff
                            </summary>
                            <div className="mt-2 grid gap-2">
                              <Textarea
                                aria-label={`Interpretation for comment ${comment.id}`}
                                placeholder="Interpretation"
                                value={draft.interpretation}
                                onChange={event =>
                                  updateTraceDraft(comment.id, {
                                    interpretation: event.target.value,
                                  })
                                }
                              />
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Textarea
                                  aria-label={`Semantic operation for comment ${comment.id}`}
                                  className="min-h-10"
                                  placeholder="Operation, e.g. replace_copy"
                                  value={draft.operation}
                                  onChange={event =>
                                    updateTraceDraft(comment.id, {
                                      operation: event.target.value,
                                    })
                                  }
                                />
                                <Textarea
                                  aria-label={`Semantic target for comment ${comment.id}`}
                                  className="min-h-10"
                                  placeholder="Target"
                                  value={draft.target}
                                  onChange={event =>
                                    updateTraceDraft(comment.id, {
                                      target: event.target.value,
                                    })
                                  }
                                />
                              </div>
                              <Textarea
                                aria-label={`Semantic summary for comment ${comment.id}`}
                                className="min-h-10"
                                placeholder="Change summary"
                                value={draft.summary}
                                onChange={event =>
                                  updateTraceDraft(comment.id, {
                                    summary: event.target.value,
                                  })
                                }
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={pending || !draft.interpretation.trim()}
                                  onClick={() => void saveTrace(comment, false)}
                                >
                                  Accept interpretation
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={
                                    pending ||
                                    !draft.interpretation.trim() ||
                                    !draft.operation.trim() ||
                                    !draft.target.trim()
                                  }
                                  onClick={() => void saveTrace(comment, true)}
                                >
                                  Verify against current artifact
                                </Button>
                              </div>
                            </div>
                          </details>
                        )}
                      </article>
                    )
                  })}
                </section>
              )
            })}

            {activeSession.comments.some(
              comment => !comment.revision_round_id
            ) ? (
              <p className="text-xs text-muted-foreground">
                Unassigned comments will be attached automatically when the
                client requests changes, or when the next revision round begins.
              </p>
            ) : null}
          </>
        )}

        {state?.sessions
          .filter(item => item !== activeSession)
          .map(item => (
            <details key={item.session.id} className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {item.session.title} · {item.session.status}
                {item.stale ? ' · stale artifact' : ''}
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                {item.rounds.length} rounds · {item.comments.length} comments ·{' '}
                {item.decisions.length} client decisions
              </p>
            </details>
          ))}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
