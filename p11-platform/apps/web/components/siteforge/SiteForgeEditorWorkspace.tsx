'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { WebsitePreview } from './WebsitePreview'
import { SiteForgeOperationsPanel } from './SiteForgeOperationsPanel'
import type { WebsiteStatusResponse } from '@/types/siteforge'
import {
  classifyWebsiteStatus,
  isExactArtifactPreview,
  responseErrorMessage,
  siteForgeStatusEndpoint,
} from './orchestration'

type EditorMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  content: string
  resulting_artifact_id: string | null
  progress: unknown
  created_at: string
}

type EditorSessionPayload = {
  session: {
    id: string
    property_id: string
    active_artifact_id: string
  }
  messages: EditorMessage[]
  currentArtifact?: {
    id: string
    version: number
    content_hash: string
  }
  previews?: {
    lifecycleStatus: string
    wordpress: string | null
    wordpressArtifactId: string | null
    wordpressContentHash: string | null
    certificationStatus: string | null
    renderJob: {
      id: string
      lifecycle_status: string
      stage: string
      progress: number
      current_step: string
      status_reason: string | null
      error_message: string | null
    } | null
    staging: string | null
    stagingArtifactId: string | null
    stagingCertifiedAt: string | null
    cloudwaysDashboard: string | null
  }
  runtimeExtensionsEnabled?: boolean
  extensionRequests?: Array<{
    id: string
    capability: string
    reason: string
    requested_behavior: string
    status: string
    created_at: string
    review: {
      sourceArtifact: {
        id: string
        version: number
        content_hash: string
        created_at: string
      } | null
      packageSha256: string | null
      manifest: {
        manifestVersion: number
        contentHash: string
        files: Array<{
          path: string
          contentHash: string
          bytes: number
          mediaType: string
        }>
      } | null
      validationReport: unknown
      screenshotReport: unknown
      files: Array<{
        path: string
        content: string
        contentHash: string
        bytes: number
        mediaType: string
        contentDigestVerified: boolean
      }>
      sourceIsCurrent: boolean
      reviewComplete: boolean
      reviewError: string | null
    }
  }>
}

type ExtensionDecision = 'approved' | 'rejected'

type EditJobFailure = {
  jobId: string
  status: 'failed' | 'cancelled'
  statusReason: string | null
  errorMessage: string | null
}

type PropertyAsset = {
  id: string
  url: string
  filename: string
  category?: string
  altText?: string
}

type PreviewSource = 'p11' | 'wordpress'
type Viewport = 'mobile' | 'tablet' | 'desktop'

const VIEWPORT_WIDTH: Record<Viewport, number | '100%'> = {
  mobile: 390,
  tablet: 768,
  desktop: '100%',
}

export function SiteForgeEditorWorkspace({ websiteId }: { websiteId: string }) {
  const [payload, setPayload] = useState<EditorSessionPayload | null>(null)
  const [intent, setIntent] = useState('')
  const [elementContext, setElementContext] = useState('')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [previewSource, setPreviewSource] = useState<PreviewSource>('p11')
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [assets, setAssets] = useState<PropertyAsset[]>([])
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [previewingWordPress, setPreviewingWordPress] = useState(false)
  const [previewStep, setPreviewStep] = useState<string | null>(null)
  const [deployingStaging, setDeployingStaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editJobFailure, setEditJobFailure] = useState<EditJobFailure | null>(
    null
  )
  const [extensionDecisionReasons, setExtensionDecisionReasons] = useState<
    Record<string, string>
  >({})
  const [pendingExtensionDecision, setPendingExtensionDecision] = useState<{
    requestId: string
    decision: ExtensionDecision
  } | null>(null)
  const [extensionDecisionErrors, setExtensionDecisionErrors] = useState<
    Record<string, string>
  >({})
  const [previewRevision, setPreviewRevision] = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const previewingWordPressRef = useRef(false)

  const openSession = useCallback(async () => {
    const response = await fetch('/api/siteforge/editor/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteId }),
    })
    const data = await response.json()
    if (!response.ok)
      throw new Error(data.error || 'Failed to open editor session')
    setPayload(data as EditorSessionPayload)
    return data as EditorSessionPayload
  }, [websiteId])

  useEffect(() => {
    let cancelled = false
    void openSession()
      .then((session) => {
        if (cancelled) return
        return fetch(
          `/api/siteforge/assets?propertyId=${session.session.property_id}`
        )
      })
      .then(async (response) => {
        if (!response || cancelled || !response.ok) return
        const data = await response.json()
        setAssets(Array.isArray(data.assets) ? data.assets : [])
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : 'Failed to open editor'
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [openSession])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [payload?.messages])

  const renderWordPressPreview = useCallback(
    async (current: EditorSessionPayload, runBrowserQa = false) => {
      const artifact = current?.currentArtifact
      if (!artifact || previewingWordPressRef.current) return
      previewingWordPressRef.current = true
      setPreviewingWordPress(true)
      setPreviewStep(
        runBrowserQa ? 'Preparing full browser QA' : 'Publishing revision'
      )
      setError(null)
      try {
        const startResponse = await fetch(
          `/api/siteforge/canonical-preview/${websiteId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              artifactId: artifact.id,
              contentHash: artifact.content_hash,
              retry: true,
              runBrowserQa,
            }),
          }
        )
        const startData = await startResponse.json()
        if (!startResponse.ok && startResponse.status !== 202) {
          throw new Error(startData.error || 'WordPress preview failed')
        }
        if (startData.status === 'ready') {
          await openSession()
          return
        }
        if (!startData.jobId) {
          throw new Error('WordPress preview did not return a job identity')
        }
        const maxAttempts = runBrowserQa ? 360 : 80
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          const response = await fetch(
            `/api/siteforge/canonical-preview/${websiteId}?jobId=${encodeURIComponent(startData.jobId)}`,
            { cache: 'no-store' }
          )
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data.error || 'Checking WordPress preview failed')
          }
          setPreviewStep(
            data.currentStep || data.stage || 'Applying WordPress transaction'
          )
          if (data.status === 'succeeded') {
            await openSession()
            return
          }
          if (['failed', 'cancelled'].includes(data.status)) {
            throw new Error(data.error || 'WordPress preview failed')
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000))
        }
        throw new Error('WordPress preview timed out')
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'WordPress preview failed'
        )
      } finally {
        previewingWordPressRef.current = false
        setPreviewingWordPress(false)
        setPreviewStep(null)
      }
    },
    [openSession, websiteId]
  )

  useEffect(() => {
    if (!activeJobId) return
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/siteforge/editor/jobs/${activeJobId}`,
          {
            cache: 'no-store',
          }
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(
            responseErrorMessage(
              response.status,
              data,
              'checking edit progress'
            )
          )
        }
        if (cancelled) return
        setPayload((current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === data.message?.id ? data.message : message
                ),
              }
            : current
        )
        if (
          ['succeeded', 'failed', 'cancelled'].includes(
            data.job.lifecycle_status
          )
        ) {
          const terminalStatus = data.job.lifecycle_status
          if (terminalStatus === 'failed' || terminalStatus === 'cancelled') {
            setEditJobFailure({
              jobId: activeJobId,
              status: terminalStatus,
              statusReason: data.job.status_reason || null,
              errorMessage: data.job.error_message || null,
            })
          } else {
            setEditJobFailure(null)
          }
          setActiveJobId(null)
          setSubmitting(false)
          const refreshed = await openSession()
          setPreviewRevision((value) => value + 1)
          if (
            data.job.lifecycle_status === 'succeeded' &&
            data.message?.resulting_artifact_id
          ) {
            setPayload(refreshed)
            if (previewSource === 'wordpress') {
              void renderWordPressPreview(refreshed)
            }
          }
          return
        }
        timeout = setTimeout(poll, 1_500)
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : 'Edit progress failed'
          )
          setSubmitting(false)
          setActiveJobId(null)
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [activeJobId, openSession, previewSource, renderWordPressPreview])

  async function submitTurn() {
    const userIntent = intent.trim()
    const artifact = payload?.currentArtifact
    if (!payload || !artifact || !userIntent || submitting) return
    setSubmitting(true)
    setError(null)
    setEditJobFailure(null)
    const contextualIntent = elementContext.trim()
      ? `${userIntent}\n\nOptional page/element context: ${elementContext.trim()}`
      : userIntent
    try {
      const response = await fetch(
        `/api/siteforge/editor/sessions/${payload.session.id}/turns`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIntent: contextualIntent,
            expectedArtifactId: artifact.id,
            expectedContentHash: artifact.content_hash,
            clientRequestId: crypto.randomUUID(),
          }),
        }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit edit')
      if (data.duplicate) {
        await openSession()
        setIntent('')
        setElementContext('')
        if (['succeeded', 'failed', 'cancelled'].includes(data.status)) {
          setSubmitting(false)
        } else {
          setActiveJobId(data.jobId)
        }
        return
      }
      setIntent('')
      setElementContext('')
      setPayload((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: data.userMessageId,
                  role: 'user',
                  status: 'complete',
                  content: contextualIntent,
                  resulting_artifact_id: null,
                  progress: [],
                  created_at: new Date().toISOString(),
                },
                {
                  id: data.assistantMessageId,
                  role: 'assistant',
                  status: 'queued',
                  content: 'Preparing your edit…',
                  resulting_artifact_id: null,
                  progress: [],
                  created_at: new Date().toISOString(),
                },
              ],
            }
          : current
      )
      setActiveJobId(data.jobId)
    } catch (cause) {
      setSubmitting(false)
      setError(cause instanceof Error ? cause.message : 'Failed to submit edit')
    }
  }

  async function cancelTurn() {
    if (!activeJobId) return
    const response = await fetch(`/api/siteforge/jobs/${activeJobId}/cancel`, {
      method: 'POST',
    })
    const data = await response.json()
    if (!response.ok) setError(data.error || 'Failed to cancel edit')
  }

  async function undoLastRevision() {
    if (!payload?.currentArtifact || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/siteforge/editor/sessions/${payload.session.id}/undo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedArtifactId: payload.currentArtifact.id,
            idempotencyKey: crypto.randomUUID(),
          }),
        }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to undo revision')
      await openSession()
      setPreviewRevision((value) => value + 1)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to undo revision'
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function deployToStaging() {
    if (deployingStaging) return
    setDeployingStaging(true)
    setError(null)
    try {
      const response = await fetch(`/api/siteforge/deploy/${websiteId}`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok)
        throw new Error(data.error || 'Failed to deploy staging')
      if (data.status === 'ready') {
        await openSession()
        return
      }
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const statusResponse = await fetch(siteForgeStatusEndpoint(websiteId), {
          cache: 'no-store',
        })
        const statusPayload = await statusResponse.json().catch(() => ({}))
        if (!statusResponse.ok) {
          throw new Error(
            responseErrorMessage(
              statusResponse.status,
              statusPayload,
              'checking staging deployment progress'
            )
          )
        }
        const outcome = classifyWebsiteStatus(
          statusPayload as WebsiteStatusResponse,
          'deployment'
        )
        if (outcome.terminal && outcome.succeeded) {
          await openSession()
          return
        }
        if (outcome.terminal && !outcome.succeeded) {
          throw new Error(outcome.message)
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      throw new Error('Cloudways staging deployment timed out')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Staging deployment failed'
      )
    } finally {
      setDeployingStaging(false)
    }
  }

  async function decideExtension(
    requestId: string,
    decision: ExtensionDecision
  ) {
    if (pendingExtensionDecision) return
    const reason = extensionDecisionReasons[requestId]?.trim() || ''
    if (!reason) {
      setExtensionDecisionErrors((current) => ({
        ...current,
        [requestId]: 'Enter a decision reason before approving or rejecting.',
      }))
      return
    }

    setPendingExtensionDecision({ requestId, decision })
    setExtensionDecisionErrors((current) => {
      const next = { ...current }
      delete next[requestId]
      return next
    })
    let decisionSaved = false
    try {
      const response = await fetch(
        `/api/siteforge/extensions/${requestId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, reason }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          data.error ||
            `Failed to ${
              decision === 'approved' ? 'approve' : 'reject'
            } extension`
        )
      }
      decisionSaved = true
      await openSession()
      setExtensionDecisionReasons((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
    } catch (cause) {
      setExtensionDecisionErrors((current) => ({
        ...current,
        [requestId]: decisionSaved
          ? 'Decision saved, but the editor could not refresh. Reload to see the updated request status.'
          : cause instanceof Error
            ? cause.message
            : 'Failed to review runtime extension request',
      }))
    } finally {
      setPendingExtensionDecision(null)
    }
  }

  function referenceAsset(asset: PropertyAsset) {
    setElementContext(
      `Use approved asset ${asset.id} (${asset.filename})${
        asset.altText ? `, alt text: ${asset.altText}` : ''
      }`
    )
    setAssetPickerOpen(false)
  }

  if (loading) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Opening semantic editor…
      </div>
    )
  }
  if (!payload) {
    return (
      <div role="alert" className="p-8 text-sm text-red-600">
        {error || 'Editor unavailable'}
      </div>
    )
  }

  const previewMatches = isExactArtifactPreview({
    currentArtifactId: payload.currentArtifact?.id,
    currentContentHash: payload.currentArtifact?.content_hash,
    previewArtifactId: payload.previews?.wordpressArtifactId,
    previewContentHash: payload.previews?.wordpressContentHash,
  })
  const stagingMatches =
    payload.previews?.stagingArtifactId === payload.currentArtifact?.id

  return (
    <div className="grid min-h-[calc(100vh-8rem)] items-start gap-4 xl:grid-cols-[minmax(320px,380px)_1fr]">
      <Card className="flex h-[calc(100dvh-14rem)] min-h-[420px] max-h-[760px] flex-col self-start overflow-hidden xl:sticky xl:top-4 xl:h-[calc(100dvh-6rem)] xl:min-h-[480px]">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">SiteForge editor</CardTitle>
            <Badge variant="outline">Fable 5</Badge>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">
              v{payload.currentArtifact?.version || '—'}
            </Badge>
            <Badge variant={previewMatches ? 'success' : 'outline'}>
              {previewMatches
                ? 'Exact WordPress revision'
                : 'WordPress preview stale'}
            </Badge>
            {payload.previews?.certificationStatus === 'failed' ? (
              <Badge variant="outline">Browser QA warning · non-blocking</Badge>
            ) : null}
            {payload.previews?.certificationStatus === 'passed' ? (
              <Badge variant="success">Browser QA passed</Badge>
            ) : null}
            {previewMatches && !payload.previews?.certificationStatus ? (
              <Badge variant="outline">Browser QA not run · optional</Badge>
            ) : null}
            {payload.previews?.renderJob &&
            !['succeeded', 'failed', 'cancelled'].includes(
              payload.previews.renderJob.lifecycle_status
            ) ? (
              <Badge variant="outline">
                {payload.previews.renderJob.current_step}
              </Badge>
            ) : null}
            <Badge variant={stagingMatches ? 'success' : 'outline'}>
              {stagingMatches ? 'Staging fresh' : 'Staging not current'}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!previewMatches || deployingStaging}
              onClick={() => void deployToStaging()}
            >
              {deployingStaging ? 'Deploying staging…' : 'Deploy to staging'}
            </Button>
            {payload.previews?.staging && stagingMatches ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={payload.previews.staging}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open staging
                </a>
              </Button>
            ) : null}
            {payload.previews?.cloudwaysDashboard ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={payload.previews.cloudwaysDashboard}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Cloudways dashboard
                </a>
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Production promotion requires a separate, expiring manager launch
            approval. Cloudways dashboard confirmation is used only when
            provider automation is unavailable.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
            aria-live="polite"
          >
            {payload.messages.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Ask for any site-wide change. Selecting a field or ACF block is
                never required.
              </div>
            ) : null}
            {payload.extensionRequests?.length ? (
              <section
                aria-labelledby="runtime-extension-review-heading"
                className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950"
              >
                <div>
                  <h2
                    id="runtime-extension-review-heading"
                    className="text-sm font-semibold"
                  >
                    Runtime extension review
                  </h2>
                  <p className="mt-1 text-xs">
                    Exact WordPress preview and certification are required
                    before custom behavior can release.
                  </p>
                </div>
                {payload.extensionRequests.map((request) => {
                  const reasonId = `extension-decision-reason-${request.id}`
                  const errorId = `extension-decision-error-${request.id}`
                  const isPending =
                    pendingExtensionDecision?.requestId === request.id
                  const isProposed = request.status === 'proposed'
                  const canApprove = isProposed && request.review.reviewComplete

                  return (
                    <article
                      key={request.id}
                      aria-busy={isPending}
                      className="space-y-2 rounded border border-amber-300 bg-background/80 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">
                            Capability: {request.capability}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            Source request{' '}
                            <span className="break-all font-mono">
                              {request.id}
                            </span>
                          </p>
                          <p className="text-muted-foreground">
                            Submitted{' '}
                            {new Date(request.created_at).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant="outline">{request.status}</Badge>
                      </div>
                      <div>
                        <p className="font-medium">Proposed change</p>
                        <p className="mt-1 whitespace-pre-wrap">
                          {request.requested_behavior}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium">Request rationale</p>
                        <p className="mt-1 whitespace-pre-wrap">
                          {request.reason}
                        </p>
                      </div>
                      <div className="space-y-1 rounded border bg-muted/30 p-2">
                        <p className="font-medium">Exact source revision</p>
                        {request.review.sourceArtifact ? (
                          <>
                            <p>
                              Version {request.review.sourceArtifact.version}{' '}
                              {request.review.sourceIsCurrent
                                ? '· current'
                                : '· stale'}
                            </p>
                            <p className="break-all font-mono">
                              {request.review.sourceArtifact.id}
                            </p>
                            <p className="break-all font-mono">
                              Content{' '}
                              {request.review.sourceArtifact.content_hash}
                            </p>
                          </>
                        ) : (
                          <p>Source identity unavailable</p>
                        )}
                        <p className="break-all font-mono">
                          Package {request.review.packageSha256 || 'unverified'}
                        </p>
                        <p className="break-all font-mono">
                          Manifest{' '}
                          {request.review.manifest?.contentHash || 'unverified'}
                        </p>
                      </div>
                      {request.review.files.length ? (
                        <div className="space-y-2">
                          <p className="font-medium">Generated file review</p>
                          {request.review.files.map((file) => (
                            <details
                              key={file.path}
                              className="rounded border bg-background p-2"
                            >
                              <summary className="cursor-pointer font-mono">
                                New file · {file.path} · {file.bytes} bytes
                              </summary>
                              <p className="mt-2 break-all font-mono text-[10px]">
                                SHA-256 {file.contentHash}{' '}
                                {file.contentDigestVerified
                                  ? '· verified'
                                  : '· mismatch'}
                              </p>
                              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-[11px]">
                                {file.content}
                              </pre>
                            </details>
                          ))}
                        </div>
                      ) : null}
                      <details className="rounded border bg-background p-2">
                        <summary className="cursor-pointer font-medium">
                          Sandbox validation checks
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px]">
                          {JSON.stringify(
                            request.review.validationReport,
                            null,
                            2
                          )}
                        </pre>
                      </details>
                      <details className="rounded border bg-background p-2">
                        <summary className="cursor-pointer font-medium">
                          Screenshot certification report
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px]">
                          {JSON.stringify(
                            request.review.screenshotReport,
                            null,
                            2
                          )}
                        </pre>
                      </details>
                      {!request.review.reviewComplete ? (
                        <p role="alert" className="font-medium text-red-700">
                          Approval blocked:{' '}
                          {request.review.reviewError ||
                            'package or validation data is incomplete'}
                        </p>
                      ) : null}
                      {isProposed ? (
                        <>
                          <div>
                            <label htmlFor={reasonId} className="font-medium">
                              Decision reason
                            </label>
                            <Textarea
                              id={reasonId}
                              className="mt-1 min-h-20 bg-background"
                              value={extensionDecisionReasons[request.id] || ''}
                              onChange={(event) => {
                                const value = event.target.value
                                setExtensionDecisionReasons((current) => ({
                                  ...current,
                                  [request.id]: value,
                                }))
                                if (extensionDecisionErrors[request.id]) {
                                  setExtensionDecisionErrors((current) => {
                                    const next = { ...current }
                                    delete next[request.id]
                                    return next
                                  })
                                }
                              }}
                              disabled={isPending}
                              aria-describedby={
                                extensionDecisionErrors[request.id]
                                  ? errorId
                                  : undefined
                              }
                              placeholder="Explain why this custom behavior should or should not proceed…"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                void decideExtension(request.id, 'approved')
                              }
                              disabled={
                                Boolean(pendingExtensionDecision) || !canApprove
                              }
                              aria-label={`Approve ${request.capability} extension request`}
                            >
                              {isPending &&
                              pendingExtensionDecision?.decision === 'approved'
                                ? 'Approving…'
                                : 'Approve'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                void decideExtension(request.id, 'rejected')
                              }
                              disabled={Boolean(pendingExtensionDecision)}
                              aria-label={`Reject ${request.capability} extension request`}
                            >
                              {isPending &&
                              pendingExtensionDecision?.decision === 'rejected'
                                ? 'Rejecting…'
                                : 'Reject'}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p className="font-medium">
                          This request has already been {request.status}.
                        </p>
                      )}
                      {extensionDecisionErrors[request.id] ? (
                        <p id={errorId} role="alert" className="text-red-700">
                          {extensionDecisionErrors[request.id]}
                        </p>
                      ) : null}
                    </article>
                  )
                })}
              </section>
            ) : null}
            {payload.messages.map((message, messageIndex) => (
              <div
                key={message.id}
                className={`rounded-lg p-3 text-sm ${
                  message.role === 'user'
                    ? 'ml-6 bg-primary text-primary-foreground'
                    : 'mr-6 border bg-muted/40'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.status !== 'complete' ? (
                  <p className="mt-2 text-xs opacity-70">{message.status}</p>
                ) : null}
                {message.resulting_artifact_id ? (
                  <p className="mt-2 truncate text-xs opacity-70">
                    Revision {message.resulting_artifact_id}
                  </p>
                ) : null}
                {message.role === 'assistant' &&
                message.status === 'failed' &&
                payload.messages[messageIndex - 1]?.role === 'user' ? (
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setIntent(payload.messages[messageIndex - 1].content)
                    }
                  >
                    Retry as a new turn
                  </Button>
                ) : null}
              </div>
            ))}
            {editJobFailure ? (
              <div
                role="alert"
                className="mr-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950"
              >
                <p className="font-semibold">Edit {editJobFailure.status}</p>
                {editJobFailure.errorMessage ? (
                  <p className="mt-1 whitespace-pre-wrap font-medium">
                    {editJobFailure.errorMessage}
                  </p>
                ) : null}
                {editJobFailure.statusReason ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs">
                    Status reason: {editJobFailure.statusReason}
                  </p>
                ) : null}
                <p className="mt-2 text-xs">
                  {editJobFailure.status === 'cancelled'
                    ? 'The edit stopped before producing a revision. Update the request if needed, then send it again.'
                    : 'No revision was applied. Correct the request or its context, then send it again. If this repeats, share the preserved error code and job ID with support.'}
                </p>
                <p className="mt-1 break-all font-mono text-xs">
                  Job {editJobFailure.jobId}
                </p>
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>

          <div className="space-y-2 border-t p-4">
            {elementContext ? (
              <div className="flex items-start justify-between gap-2 rounded border bg-muted/40 p-2 text-xs">
                <span>{elementContext}</span>
                <button
                  type="button"
                  onClick={() => setElementContext('')}
                  aria-label="Clear edit context"
                >
                  ×
                </button>
              </div>
            ) : null}
            {assetPickerOpen ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2">
                {assets.length ? (
                  assets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => referenceAsset(asset)}
                      className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                    >
                      {asset.filename}{' '}
                      {asset.category ? `· ${asset.category}` : ''}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No approved assets available.
                  </p>
                )}
              </div>
            ) : null}
            <Textarea
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submitTurn()
                }
              }}
              placeholder="Describe any site-wide change…"
              disabled={submitting}
              aria-label="Site edit request"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAssetPickerOpen((value) => !value)}
              >
                Approved assets
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={undoLastRevision}
                disabled={submitting}
              >
                Undo
              </Button>
              <div className="flex-1" />
              {activeJobId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={cancelTurn}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={submitTurn}
                disabled={!intent.trim() || submitting}
              >
                {submitting ? 'Working…' : 'Send'}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex gap-2"
              role="tablist"
              aria-label="Preview source"
            >
              <Button
                size="sm"
                variant={previewSource === 'p11' ? 'default' : 'outline'}
                onClick={() => setPreviewSource('p11')}
              >
                P11 preview
              </Button>
              <Button
                size="sm"
                variant={previewSource === 'wordpress' ? 'default' : 'outline'}
                onClick={() => setPreviewSource('wordpress')}
              >
                WordPress preview
              </Button>
              {previewSource === 'wordpress' ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={previewingWordPress}
                    onClick={() =>
                      payload && void renderWordPressPreview(payload)
                    }
                  >
                    {previewingWordPress
                      ? previewStep || 'Rendering…'
                      : 'Render exact revision'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!previewMatches || previewingWordPress}
                    onClick={() =>
                      payload && void renderWordPressPreview(payload, true)
                    }
                  >
                    {previewingWordPress
                      ? previewStep || 'Running QA…'
                      : 'Run full browser QA'}
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex gap-2" aria-label="Preview viewport">
              {(['mobile', 'tablet', 'desktop'] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={viewport === option ? 'default' : 'outline'}
                  onClick={() => setViewport(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-auto bg-muted/40 p-3">
          <div
            className="mx-auto min-h-[720px] overflow-auto bg-background transition-[width]"
            style={{ width: VIEWPORT_WIDTH[viewport] }}
          >
            {previewSource === 'wordpress' ? (
              payload.previews?.wordpress && previewMatches ? (
                <iframe
                  title="Exact WordPress preview"
                  src={payload.previews.wordpress}
                  sandbox="allow-scripts allow-same-origin"
                  className="h-[780px] w-full border-0 bg-white"
                />
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <p>
                    {payload.previews?.wordpress
                      ? 'The available WordPress render belongs to an older artifact. Render this exact revision before reviewing it.'
                      : 'Render an exact WordPress preview for this revision.'}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    disabled={previewingWordPress}
                    onClick={() =>
                      payload && void renderWordPressPreview(payload)
                    }
                  >
                    {previewingWordPress
                      ? previewStep || 'Rendering…'
                      : 'Render WordPress preview'}
                  </Button>
                </div>
              )
            ) : (
              <WebsitePreview
                key={`${previewRevision}-${viewport}`}
                websiteId={websiteId}
                readOnly
              />
            )}
          </div>
        </CardContent>
      </Card>
      <SiteForgeOperationsPanel websiteId={websiteId} />
    </div>
  )
}
