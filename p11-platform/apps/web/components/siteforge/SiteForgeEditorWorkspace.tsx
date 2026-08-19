'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type {
  SiteBlueprint,
  WebsiteStatusResponse,
} from '@/types/siteforge'
import { siteForgeEditorPostMessageSchema } from '@/utils/siteforge/element-targeting'
import type { SiteForgePageManagerAction } from '@/utils/siteforge/editor/page-manager'
import { SiteForgePageManager } from './SiteForgePageManager'
import {
  classifyWebsiteStatus,
  isExactArtifactPreview,
  responseErrorMessage,
  siteForgeStatusEndpoint,
} from './orchestration'

function formatEditorModelLabel(model?: string): string {
  if (!model) return 'SiteForge AI'
  return model.split('/').at(-1)?.replaceAll('-', ' ') || model
}

function messageModelLabel(summary: unknown): string | null {
  if (!Array.isArray(summary)) return null
  const selected = summary.find(
    item =>
      item &&
      typeof item === 'object' &&
      'tool' in item &&
      item.tool === 'routeEditorModel' &&
      'detail' in item &&
      typeof item.detail === 'string' &&
      item.detail.startsWith('Selected ')
  ) as { detail?: string } | undefined
  return selected?.detail
    ? formatEditorModelLabel(selected.detail.slice('Selected '.length))
    : null
}

function wordpressPageUrl(baseUrl: string | null | undefined, slug: string): string {
  if (!baseUrl) return ''
  const url = new URL(baseUrl)
  url.pathname = slug === 'home' ? '/' : `/${slug}/`
  url.search = ''
  url.hash = ''
  return url.toString()
}

type EditorMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  content: string
  resulting_artifact_id: string | null
  progress: unknown
  tool_summary?: unknown
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
    deployment_decision?: string | null
  }
  previewBlueprint?: SiteBlueprint
  revisions?: EditorRevision[]
  attachments?: EditorAttachment[]
  activeJobs?: {
    semanticEdit: DurableEditorJob | null
    preview: DurableEditorJob | null
  }
  editorModel?: string
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
      heartbeat_at?: string | null
      attempt_count?: number
      max_attempts?: number
      queued_at?: string
      started_at?: string | null
      finished_at?: string | null
      updated_at?: string
    } | null
    staging: string | null
    stagingAdmin: string | null
    stagingArtifactId: string | null
    stagingCertifiedAt: string | null
    cloudwaysDashboard: string | null
  }
  runtimeExtensionsEnabled?: boolean
  brand?: {
    pinnedContractHash: string | null
    pinnedContractVersion: string | null
    liveContractHash: string | null
    liveContractVersion: string | null
    staleSincePinned: boolean
  }
  capabilities?: {
    'siteforge.owner_operator'?: boolean
  }
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

type EditJobFailure = {
  jobId: string
  status: 'failed' | 'cancelled'
  statusReason: string | null
  errorMessage: string | null
}

type DurableEditorJob = {
  id: string
  lifecycle_status: string
  status_reason: string | null
  stage: string
  progress: number
  current_step: string
  error_message: string | null
  heartbeat_at: string | null
  attempt_count: number
  max_attempts: number
  queued_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
  elapsed_ms?: number
}

type EditorAttachment = {
  id: string
  user_message_id: string | null
  artifact_id: string
  artifact_content_hash: string
  page_slug: string
  viewport: string
  mime_type: string
  file_size_bytes: number
  original_filename: string
  width: number | null
  height: number | null
  created_at: string
  signedUrl: string
}

type EditorRevision = {
  id: string
  version: number
  content_hash: string
  parent_version_id: string | null
  change_type: string
  changes_summary: string | null
  edit_intent: string | null
  created_at: string
}

type PropertyAsset = {
  id: string
  url: string
  filename: string
  category?: string
  altText?: string
}

type Viewport = 'mobile' | 'tablet' | 'desktop'
type SelectedElement = {
  pageSlug: string
  sectionId: string
  blockType?: string
  label: string
}

const VIEWPORT_WIDTH: Record<Viewport, number> = {
  mobile: 390,
  tablet: 768,
  desktop: 1440,
}

const ACTIVE_JOB_STATUSES = ['queued', 'running', 'retrying']

function isActiveJob(job: DurableEditorJob | null | undefined): boolean {
  return Boolean(job && ACTIVE_JOB_STATUSES.includes(job.lifecycle_status))
}

function jobElapsed(job: DurableEditorJob, now: number): string {
  const start = Date.parse(job.started_at || job.queued_at)
  const end = job.finished_at ? Date.parse(job.finished_at) : now
  const seconds = Math.max(0, Math.floor((end - start) / 1_000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

function jobHeartbeat(job: DurableEditorJob): string {
  if (!job.heartbeat_at) return 'waiting for first heartbeat'
  return `heartbeat ${new Date(job.heartbeat_at).toLocaleTimeString()}`
}

async function imageDimensions(
  file: File
): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () =>
        resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve(null)
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function SiteForgeEditorWorkspace({
  websiteId,
  propertyId,
}: {
  websiteId: string
  propertyId: string
}) {
  const [payload, setPayload] = useState<EditorSessionPayload | null>(null)
  const [intent, setIntent] = useState('')
  const [elementContext, setElementContext] = useState('')
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(
    null
  )
  const [wholeSiteEdit, setWholeSiteEdit] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<DurableEditorJob | null>(null)
  const [activeJobStep, setActiveJobStep] = useState<string | null>(null)
  const [previewJobId, setPreviewJobId] = useState<string | null>(null)
  const [previewJob, setPreviewJob] = useState<DurableEditorJob | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<
    EditorAttachment[]
  >([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [jobClock, setJobClock] = useState(() => Date.now())
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [wordpressSelectionMode, setWordpressSelectionMode] = useState(true)
  const [selectedPreviewPage, setSelectedPreviewPage] = useState('')
  const [assets, setAssets] = useState<PropertyAsset[]>([])
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [previewingWordPress, setPreviewingWordPress] = useState(false)
  const [previewStep, setPreviewStep] = useState<string | null>(null)
  const [deployingStaging, setDeployingStaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editJobFailure, setEditJobFailure] = useState<EditJobFailure | null>(
    null
  )
  const [pendingExtensionDecision, setPendingExtensionDecision] = useState<
    string | null
  >(null)
  const [previewRevision, setPreviewRevision] = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const wordpressFrameRef = useRef<HTMLIFrameElement>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
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
    if (data.session?.property_id !== propertyId) {
      throw new Error('Editor session does not match the selected property')
    }
    const next = data as EditorSessionPayload
    const recoveredEdit = next.activeJobs?.semanticEdit
    const recoveredPreview = next.activeJobs?.preview
    setPayload(next)
    setPendingAttachments(
      (next.attachments || []).filter(
        attachment =>
          !attachment.user_message_id &&
          attachment.artifact_id === next.currentArtifact?.id &&
          attachment.artifact_content_hash ===
            next.currentArtifact?.content_hash
      )
    )
    if (isActiveJob(recoveredEdit)) {
      setActiveJobId(recoveredEdit!.id)
      setActiveJob(recoveredEdit!)
      setActiveJobStep(recoveredEdit!.current_step)
      setSubmitting(true)
    } else {
      setActiveJobId(null)
      setActiveJob(null)
      setActiveJobStep(null)
      setSubmitting(false)
    }
    if (isActiveJob(recoveredPreview)) {
      setPreviewJobId(recoveredPreview!.id)
      setPreviewJob(recoveredPreview!)
      setPreviewStep(recoveredPreview!.current_step)
      previewingWordPressRef.current = true
      setPreviewingWordPress(true)
    } else {
      setPreviewJobId(null)
      setPreviewJob(null)
      previewingWordPressRef.current = false
      setPreviewingWordPress(false)
      setPreviewStep(null)
    }
    return next
  }, [propertyId, websiteId])

  useEffect(() => {
    let cancelled = false
    void openSession()
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

  const loadAssets = useCallback(async () => {
    if (assetsLoading || assetsLoaded) return
    setAssetsLoading(true)
    try {
      const response = await fetch(
        `/api/siteforge/assets?propertyId=${encodeURIComponent(propertyId)}`
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load approved assets')
      }
      setAssets(Array.isArray(data.assets) ? data.assets : [])
      setAssetsLoaded(true)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to load approved assets'
      )
    } finally {
      setAssetsLoading(false)
    }
  }, [assetsLoaded, assetsLoading, propertyId])

  function toggleAssetPicker() {
    setAssetPickerOpen(current => {
      if (!current) void loadAssets()
      return !current
    })
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [payload?.messages])

  useEffect(() => {
    if (!activeJobId && !previewJobId) return
    const interval = window.setInterval(() => setJobClock(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [activeJobId, previewJobId])

  useEffect(() => {
    const pages = payload?.previewBlueprint?.pages || []
    if (
      pages.length > 0 &&
      !pages.some(page => page.slug === selectedPreviewPage)
    ) {
      setSelectedPreviewPage(pages[0].slug)
    }
  }, [payload?.previewBlueprint?.pages, selectedPreviewPage])

  const postWordPressSelectionMode = useCallback(() => {
    const frame = wordpressFrameRef.current
    const previewUrl = payload?.previews?.wordpress
    if (!frame?.contentWindow || !previewUrl) return
    frame.contentWindow.postMessage(
      {
        type: 'siteforge-editor:set-selection-mode',
        enabled: wordpressSelectionMode,
      },
      new URL(previewUrl).origin
    )
  }, [payload?.previews?.wordpress, wordpressSelectionMode])

  useEffect(() => {
    const previewUrl = payload?.previews?.wordpress
    if (!previewUrl) return
    const previewOrigin = new URL(previewUrl).origin
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== previewOrigin ||
        event.source !== wordpressFrameRef.current?.contentWindow ||
        !event.data ||
        typeof event.data !== 'object'
      ) {
        return
      }
      const typedMessage = siteForgeEditorPostMessageSchema.safeParse(event.data)
      if (
        typedMessage.success &&
        typedMessage.data.type === 'siteforge-editor:ready'
      ) {
        setSelectedPreviewPage(typedMessage.data.pageSlug)
        postWordPressSelectionMode()
        return
      }
      if (
        typedMessage.success &&
        typedMessage.data.type === 'siteforge-editor:target-selected'
      ) {
        const message = typedMessage.data
        const sectionPath = [...message.target.resourcePath]
          .reverse()
          .find(segment => segment.kind === 'section')
        if (!sectionPath) return
        const sectionId = sectionPath.id.replace(/^section:[^:]+:/, '')
        const page = payload.previewBlueprint?.pages?.find(
          candidate => candidate.slug === message.pageSlug
        )
        const sourceSection = page?.sections.find(
          section =>
            section.id === sectionPath.id || section.id === sectionId
        )
        if (!sourceSection?.id) return
        const selected = {
          pageSlug: message.pageSlug,
          sectionId: sourceSection.id,
          blockType: sourceSection.acfBlock,
          label:
            message.target.displayValue.trim() ||
            sourceSection.label ||
            sourceSection.type ||
            sourceSection.acfBlock,
        }
        setSelectedPreviewPage(selected.pageSlug)
        setWholeSiteEdit(false)
        setSelectedElement(selected)
        setElementContext(
          `Selected ${message.target.kind} from exact WordPress: ${selected.label} (${message.target.selector})`
        )
        return
      }
      if (
        event.data.type !== 'siteforge-editor:section-selected' ||
        typeof event.data.pageSlug !== 'string' ||
        typeof event.data.sectionId !== 'string'
      ) {
        return
      }
      const page = payload.previewBlueprint?.pages?.find(
        candidate => candidate.slug === event.data.pageSlug
      )
      const sourceSection = page?.sections.find(
        section => section.id === event.data.sectionId
      )
      if (!sourceSection?.id) return
      const selected = {
        pageSlug: event.data.pageSlug,
        sectionId: sourceSection.id,
        blockType:
          typeof event.data.blockType === 'string'
            ? event.data.blockType
            : sourceSection.acfBlock,
        label:
          typeof event.data.label === 'string' && event.data.label.trim()
            ? event.data.label.trim()
            : sourceSection.label ||
              sourceSection.type ||
              sourceSection.acfBlock,
      }
      setSelectedPreviewPage(selected.pageSlug)
      setWholeSiteEdit(false)
      setSelectedElement(selected)
      setElementContext(
        `Selected from exact WordPress: ${selected.label} on /${selected.pageSlug}`
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [
    payload?.previewBlueprint?.pages,
    payload?.previews?.wordpress,
    postWordPressSelectionMode,
  ])

  useEffect(() => {
    postWordPressSelectionMode()
  }, [postWordPressSelectionMode, previewRevision])

  const renderWordPressPreview = useCallback(
    async (current: EditorSessionPayload, runBrowserQa = false) => {
      const artifact = current?.currentArtifact
      if (!artifact || previewingWordPressRef.current) return
      let startedJob = false
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
        startedJob = true
        setPreviewJobId(startData.jobId)
        setPreviewJob({
          id: startData.jobId,
          lifecycle_status: startData.status || 'queued',
          status_reason: null,
          stage: 'queued',
          progress: 0,
          current_step: 'Canonical WordPress preview queued',
          error_message: null,
          heartbeat_at: null,
          attempt_count: 1,
          max_attempts: 2,
          queued_at: new Date().toISOString(),
          started_at: null,
          finished_at: null,
          updated_at: new Date().toISOString(),
        })
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'WordPress preview failed'
        )
      } finally {
        if (!startedJob) {
          previewingWordPressRef.current = false
          setPreviewingWordPress(false)
          setPreviewStep(null)
        }
      }
    },
    [openSession, websiteId]
  )

  useEffect(() => {
    if (!previewJobId) return
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/siteforge/canonical-preview/${websiteId}?jobId=${encodeURIComponent(previewJobId)}`,
          { cache: 'no-store' }
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || 'Checking WordPress preview failed')
        }
        if (cancelled) return
        const nextJob: DurableEditorJob = {
          id: data.jobId,
          lifecycle_status: data.status,
          status_reason: data.statusReason || null,
          stage: data.stage || 'running',
          progress: data.progress || 0,
          current_step:
            data.currentStep || data.stage || 'Applying WordPress transaction',
          error_message: data.error || null,
          heartbeat_at: data.heartbeatAt || null,
          attempt_count: data.attemptCount || 0,
          max_attempts: data.maxAttempts || 0,
          queued_at: data.queuedAt || data.createdAt,
          started_at: data.startedAt || null,
          finished_at: data.finishedAt || null,
          updated_at: data.updatedAt,
          elapsed_ms: data.elapsedMs,
        }
        setPreviewJob(nextJob)
        setPreviewStep(nextJob.current_step)
        if (['succeeded', 'failed', 'cancelled'].includes(nextJob.lifecycle_status)) {
          if (nextJob.lifecycle_status !== 'succeeded') {
            setError(nextJob.error_message || 'WordPress preview failed')
          }
          setPreviewJobId(null)
          setPreviewJob(null)
          previewingWordPressRef.current = false
          setPreviewingWordPress(false)
          setPreviewStep(null)
          await openSession()
          setPreviewRevision(value => value + 1)
          return
        }
        timeout = setTimeout(poll, 2_000)
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : 'WordPress preview failed'
          )
          setPreviewJobId(null)
          setPreviewJob(null)
          previewingWordPressRef.current = false
          setPreviewingWordPress(false)
          setPreviewStep(null)
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [openSession, previewJobId, websiteId])

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
        setActiveJobStep(
          data.job.current_step || data.job.stage || 'Applying semantic edit'
        )
        setActiveJob(data.job as DurableEditorJob)
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
          setActiveJob(null)
          setActiveJobStep(null)
          setSubmitting(false)
          const refreshed = await openSession()
          setPreviewRevision((value) => value + 1)
          if (
            data.job.lifecycle_status === 'succeeded' &&
            data.message?.resulting_artifact_id
          ) {
            setSelectedElement(null)
            setElementContext('')
            setPayload(refreshed)
            // Every published edit creates a new immutable artifact, which makes
            // the previous WordPress render stale. Refresh it regardless of the
            // currently selected preview tab so the exact render is ready when
            // the operator returns to WordPress preview.
            void renderWordPressPreview(refreshed)
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
          setActiveJob(null)
          setActiveJobStep(null)
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [activeJobId, openSession, renderWordPressPreview])

  async function uploadScreenshots(files: File[]) {
    if (submitting || uploadingAttachment) return
    const artifact = payload?.currentArtifact
    const pages = payload?.previewBlueprint?.pages || []
    const pageSlug =
      pages.find(page => page.slug === selectedPreviewPage)?.slug ||
      pages[0]?.slug
    const accepted = files.filter(file =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    )
    if (!payload || !artifact || !pageSlug || accepted.length === 0) {
      setError('Attach a PNG, JPEG, or WebP screenshot to a selected page')
      return
    }
    if (pendingAttachments.length + accepted.length > 6) {
      setError('A semantic edit can include at most 6 screenshots')
      return
    }
    setUploadingAttachment(true)
    setError(null)
    const uploaded: EditorAttachment[] = []
    try {
      for (const file of accepted) {
        const dimensions = await imageDimensions(file)
        const formData = new FormData()
        formData.set('file', file)
        formData.set('expectedArtifactId', artifact.id)
        formData.set('expectedContentHash', artifact.content_hash)
        formData.set('pageSlug', pageSlug)
        formData.set('viewport', viewport)
        if (dimensions) {
          formData.set('width', String(dimensions.width))
          formData.set('height', String(dimensions.height))
        }
        const response = await fetch(
          `/api/siteforge/editor/sessions/${payload.session.id}/attachments`,
          { method: 'POST', body: formData }
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(data.error || `Failed to attach ${file.name}`)
        }
        uploaded.push(data.attachment as EditorAttachment)
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to attach screenshot'
      )
    } finally {
      if (uploaded.length) {
        setPendingAttachments(current => [...current, ...uploaded])
      }
      setUploadingAttachment(false)
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    }
  }

  async function removePendingAttachment(attachmentId: string) {
    if (!payload || submitting) return
    const response = await fetch(
      `/api/siteforge/editor/sessions/${payload.session.id}/attachments/${attachmentId}`,
      { method: 'DELETE' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.error || 'Failed to remove screenshot')
      return
    }
    setPendingAttachments(current =>
      current.filter(attachment => attachment.id !== attachmentId)
    )
  }

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
            attachmentIds: pendingAttachments.map(attachment => attachment.id),
            elementContext: selectedElement
              ? {
                  pageSlug: selectedElement.pageSlug,
                  sectionId: selectedElement.sectionId,
                  blockType: selectedElement.blockType,
                }
              : undefined,
            editScope: selectedElement
              ? {
                  kind: 'section',
                  pageSlug: selectedElement.pageSlug,
                  sectionId: selectedElement.sectionId,
                  blockType: selectedElement.blockType,
                }
              : wholeSiteEdit
                ? { kind: 'site' }
                : currentPreviewPage
                  ? { kind: 'page', pageSlug: currentPreviewPage.slug }
                  : { kind: 'site' },
          }),
        }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to submit edit')
      if (data.duplicate) {
        await openSession()
        setIntent('')
        setPendingAttachments([])
        if (['succeeded', 'failed', 'cancelled'].includes(data.status)) {
          setSubmitting(false)
          setActiveJobId(null)
          setActiveJobStep(null)
        } else {
          setActiveJobId(data.jobId)
          setActiveJobStep('Queued for semantic planning')
        }
        return
      }
      setIntent('')
      const submittedAttachments = pendingAttachments.map(attachment => ({
        ...attachment,
        user_message_id: data.userMessageId,
      }))
      setPendingAttachments([])
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
              attachments: [
                ...(current.attachments || []),
                ...submittedAttachments,
              ],
            }
          : current
      )
      setActiveJobId(data.jobId)
      setActiveJobStep('Queued for semantic planning')
    } catch (cause) {
      setSubmitting(false)
      setActiveJobStep(null)
      setError(cause instanceof Error ? cause.message : 'Failed to submit edit')
    }
  }

  async function submitPageManagerAction(action: SiteForgePageManagerAction) {
    const artifact = payload?.currentArtifact
    if (!payload || !artifact) {
      throw new Error('The editor session is not ready yet')
    }
    if (submitting || activeJobId) {
      throw new Error('Wait for the current edit to finish, then retry')
    }
    setSubmitting(true)
    setError(null)
    setEditJobFailure(null)
    try {
      const response = await fetch(
        `/api/siteforge/editor/sessions/${payload.session.id}/turns`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userIntent: `Structured page ${action.type} operation`,
            expectedArtifactId: artifact.id,
            expectedContentHash: artifact.content_hash,
            clientRequestId: crypto.randomUUID(),
            pageManagerAction: action,
          }),
        }
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit the page operation')
      }
      await openSession()
      if (
        data.duplicate &&
        ['succeeded', 'failed', 'cancelled'].includes(data.status)
      ) {
        setSubmitting(false)
        setActiveJobId(null)
        setActiveJobStep(null)
        return
      }
      setActiveJobId(data.jobId)
      setActiveJobStep('Queued structured page operation')
    } catch (cause) {
      setSubmitting(false)
      setActiveJobStep(null)
      throw cause
    }
  }

  async function cancelTurn() {
    if (!activeJobId) return
    setActiveJobStep('Cancelling edit…')
    const response = await fetch(`/api/siteforge/jobs/${activeJobId}/cancel`, {
      method: 'POST',
    })
    const data = await response.json()
    if (!response.ok) setError(data.error || 'Failed to cancel edit')
  }

  async function cancelPreview() {
    if (!previewJobId) return
    setPreviewStep('Cancelling preview…')
    const response = await fetch(`/api/siteforge/jobs/${previewJobId}/cancel`, {
      method: 'POST',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) setError(data.error || 'Failed to cancel preview')
  }

  async function restoreRevision(targetArtifactId?: string) {
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
            targetArtifactId,
            idempotencyKey: crypto.randomUUID(),
          }),
        }
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to undo revision')
      const next = await openSession()
      setPreviewRevision((value) => value + 1)
      // The canonical WordPress target still serves the pre-undo revision;
      // re-render it for the restored artifact so the exact preview cannot go
      // stale after an undo.
      if (next?.previews?.wordpress) {
        void renderWordPressPreview(next)
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to restore revision'
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function undoLastRevision() {
    await restoreRevision()
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

  const applyValidatedExtension = useCallback(async (requestId: string) => {
    if (pendingExtensionDecision) return
    setPendingExtensionDecision(requestId)
    try {
      const response = await fetch(
        `/api/siteforge/extensions/${requestId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'approved',
            reason: 'siteforge.policy:validated_bounded_extension:v1',
          }),
        }
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          data.error || 'Failed to apply validated runtime extension'
        )
      }
      await openSession()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to apply validated runtime extension'
      )
    } finally {
      setPendingExtensionDecision(null)
    }
  }, [openSession, pendingExtensionDecision])

  useEffect(() => {
    const ready = payload?.extensionRequests?.find(
      request =>
        request.status === 'proposed' &&
        request.review.reviewComplete &&
        request.review.sourceIsCurrent
    )
    if (ready && !pendingExtensionDecision) {
      void applyValidatedExtension(ready.id)
    }
  }, [
    applyValidatedExtension,
    payload?.extensionRequests,
    pendingExtensionDecision,
  ])

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
      <div role="alert" className="p-8 text-sm text-destructive">
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
  const previewPages = payload.previewBlueprint?.pages || []
  const currentPreviewPage =
    previewPages.find(page => page.slug === selectedPreviewPage) ||
    previewPages[0]
  const exactWordPressUrl = wordpressPageUrl(
    payload.previews?.wordpress,
    currentPreviewPage?.slug || 'home'
  )

  return (
    <div className="space-y-4">
      {payload.brand?.staleSincePinned ? (
        <div
          role="status"
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="font-medium">Brand updated since this run.</span>{' '}
          This site is pinned to brand contract{' '}
          {payload.brand.pinnedContractVersion
            ? `v${payload.brand.pinnedContractVersion}`
            : payload.brand.pinnedContractHash?.slice(0, 12) || 'unknown'}
          , but the live brand book has moved to{' '}
          {payload.brand.liveContractVersion
            ? `v${payload.brand.liveContractVersion}`
            : payload.brand.liveContractHash?.slice(0, 12) || 'a newer version'}
          . The preview intentionally renders the pinned contract; regenerate
          the site to adopt the latest brand.
        </div>
      ) : null}
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Preview and edit controls</CardTitle>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">
              v{payload.currentArtifact?.version || '—'}
            </Badge>
            <Badge variant={previewMatches ? 'success' : 'outline'}>
              {previewMatches
                ? 'Exact WordPress revision'
                : 'WordPress preview stale'}
            </Badge>
            {previewMatches ? (
              <Badge variant="success">Preview ready for staging</Badge>
            ) : null}
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
            {activeJob ? (
              <Badge variant="outline">
                Edit · {activeJob.stage} · {activeJob.progress}%
              </Badge>
            ) : null}
            {previewJob ? (
              <Badge variant="outline">
                Preview · {previewJob.stage} · {previewJob.progress}%
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
            {payload.previews?.wordpress ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={payload.previews.wordpress}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open WordPress preview
                </a>
              </Button>
            ) : null}
            {payload.previews?.staging ? (
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
            {payload.previews?.stagingAdmin ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={payload.previews.stagingAdmin}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Staging wp-admin
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
            Staging uses the exact certified preview. Production changes only
            through the owner Launch action.
          </p>
          {!selectedElement ? (
            <div className="flex items-center justify-between gap-3 rounded border bg-muted/30 p-2 text-xs">
              <span>
                Edit scope:{' '}
                <strong>
                  {wholeSiteEdit
                    ? 'Whole site'
                    : currentPreviewPage
                      ? `/${currentPreviewPage.slug}`
                      : 'Whole site'}
                </strong>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setWholeSiteEdit(current => !current)}
                disabled={submitting}
              >
                {wholeSiteEdit ? 'Limit to this page' : 'Edit whole site'}
              </Button>
            </div>
          ) : (
            <p className="rounded border border-primary/40 bg-accent p-2 text-xs text-accent-foreground">
              Edit scope: {selectedElement.label} on /{selectedElement.pageSlug}
            </p>
          )}
        </CardHeader>
      </Card>
      <div className="grid min-h-[calc(100vh-8rem)] items-start gap-4 xl:grid-cols-[minmax(320px,380px)_1fr]">
      <Card className="flex h-[calc(100dvh-14rem)] min-h-[420px] max-h-[760px] flex-col self-start overflow-hidden xl:sticky xl:top-4 xl:h-[calc(100dvh-6rem)] xl:min-h-[480px]">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">SiteForge editor</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                v{payload.currentArtifact?.version || '—'}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {formatEditorModelLabel(payload?.editorModel)}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
            aria-live="polite"
          >
            {payload.messages.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Ask for any change—including adding, removing, renaming, or
                reordering pages. Selecting a field or ACF block is never
                required.
              </div>
            ) : null}
            {payload.extensionRequests?.length ? (
              <section
                aria-labelledby="runtime-extension-status-heading"
                className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs"
              >
                <h2
                  id="runtime-extension-status-heading"
                  className="font-semibold"
                >
                  Validated runtime changes
                </h2>
                {payload.extensionRequests.map(request => (
                  <div
                    key={request.id}
                    className="flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="font-medium">{request.capability}</p>
                      <p className="text-muted-foreground">
                        {request.status === 'proposed' &&
                        request.review.reviewComplete
                          ? 'Applying automatically after sandbox validation.'
                          : request.review.reviewError ||
                            request.requested_behavior}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {pendingExtensionDecision === request.id
                        ? 'applying'
                        : request.status}
                    </Badge>
                  </div>
                ))}
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
                {(payload.attachments || []).some(
                  attachment => attachment.user_message_id === message.id
                ) ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(payload.attachments || [])
                      .filter(
                        attachment =>
                          attachment.user_message_id === message.id
                      )
                      .map(attachment => (
                        <div
                          key={attachment.id}
                          className="w-24 rounded border bg-background/70 p-1"
                        >
                          <div
                            role="img"
                            aria-label={`${attachment.original_filename}, ${attachment.viewport} screenshot of /${attachment.page_slug}`}
                            className="h-16 rounded bg-cover bg-center"
                            style={{
                              backgroundImage: `url("${attachment.signedUrl}")`,
                            }}
                          />
                          <p className="mt-1 truncate text-[10px] opacity-70">
                            /{attachment.page_slug} · {attachment.viewport}
                          </p>
                        </div>
                      ))}
                  </div>
                ) : null}
                {message.role === 'assistant' &&
                messageModelLabel(message.tool_summary) ? (
                  <p className="mt-2 text-xs opacity-70">
                    Model: {messageModelLabel(message.tool_summary)}
                  </p>
                ) : null}
                {message.status !== 'complete' ? (
                  <p className="mt-2 text-xs opacity-70">
                    {messageIndex === payload.messages.length - 1 &&
                    activeJobStep
                      ? activeJobStep
                      : message.status}
                  </p>
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
                className="mr-6 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground"
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

          <div
            className="space-y-2 border-t p-4"
            onPaste={event => {
              const files = Array.from(event.clipboardData.files).filter(file =>
                file.type.startsWith('image/')
              )
              if (files.length) {
                event.preventDefault()
                void uploadScreenshots(files)
              }
            }}
            onDragOver={event => {
              if (
                Array.from(event.dataTransfer.items).some(
                  item => item.kind === 'file'
                )
              ) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
              }
            }}
            onDrop={event => {
              const files = Array.from(event.dataTransfer.files).filter(file =>
                file.type.startsWith('image/')
              )
              if (files.length) {
                event.preventDefault()
                void uploadScreenshots(files)
              }
            }}
          >
            {activeJob ? (
              <div className="rounded border bg-muted/30 p-2 text-xs">
                <p className="font-medium">
                  {activeJob.current_step} · {activeJob.progress}%
                </p>
                <p className="text-muted-foreground">
                  Stage {activeJob.stage} · attempt{' '}
                  {Math.max(1, activeJob.attempt_count)}/
                  {activeJob.max_attempts} · {jobElapsed(activeJob, jobClock)} ·{' '}
                  {jobHeartbeat(activeJob)}
                </p>
              </div>
            ) : null}
            {selectedElement ? (
              <div className="flex items-start justify-between gap-2 rounded border border-primary/50 bg-accent p-2 text-xs text-accent-foreground">
                <span>
                  Editing {selectedElement.label} on /{selectedElement.pageSlug}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedElement(null)}
                  aria-label="Clear selected preview element"
                  className="rounded-sm px-1 text-base leading-none"
                >
                  ×
                </button>
              </div>
            ) : null}
            {elementContext ? (
              <div className="flex items-start justify-between gap-2 rounded border bg-muted/40 p-2 text-xs">
                <span>{elementContext}</span>
                <button
                  type="button"
                  onClick={() => setElementContext('')}
                  aria-label="Clear edit context"
                  className="rounded-sm px-1 text-base leading-none"
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
            {pendingAttachments.length ? (
              <div className="flex flex-wrap gap-2 rounded border p-2">
                {pendingAttachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className="relative w-24 rounded border bg-muted/20 p-1"
                  >
                    <div
                      role="img"
                      aria-label={`${attachment.original_filename}, pending screenshot`}
                      className="h-16 rounded bg-cover bg-center"
                      style={{
                        backgroundImage: `url("${attachment.signedUrl}")`,
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${attachment.original_filename}`}
                      className="absolute right-0 top-0 rounded-bl bg-background/90 px-1 text-sm"
                      disabled={submitting}
                      onClick={() =>
                        void removePendingAttachment(attachment.id)
                      }
                    >
                      ×
                    </button>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">
                      /{attachment.page_slug} · {attachment.viewport}
                    </p>
                  </div>
                ))}
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
              placeholder={
                selectedElement
                  ? 'Describe the change to this selected section…'
                  : wholeSiteEdit
                    ? 'Describe the site-wide change…'
                    : 'Describe the change to this page…'
              }
              disabled={submitting}
              aria-label="Site edit request"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={attachmentInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                onChange={event =>
                  void uploadScreenshots(Array.from(event.target.files || []))
                }
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  uploadingAttachment ||
                  submitting ||
                  pendingAttachments.length >= 6
                }
                onClick={() => attachmentInputRef.current?.click()}
              >
                {uploadingAttachment ? 'Attaching…' : 'Attach screenshots'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={toggleAssetPicker}
                disabled={assetsLoading}
                aria-expanded={assetPickerOpen}
              >
                {assetsLoading ? 'Loading assets…' : 'Approved assets'}
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
            <p className="text-[11px] text-muted-foreground">
              Paste, drop, or upload up to 6 screenshots. Each is privately
              bound to this exact revision, /{currentPreviewPage?.slug || '—'},
              and the {viewport} viewport.
            </p>
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="mr-2 text-base">
                Exact WordPress preview
              </CardTitle>
              <Button
                size="sm"
                variant={
                  wordpressSelectionMode ? 'default' : 'outline'
                }
                onClick={() =>
                  setWordpressSelectionMode(current => !current)
                }
                aria-pressed={wordpressSelectionMode}
                disabled={!previewMatches}
              >
                {wordpressSelectionMode
                  ? 'Selecting sections'
                  : 'Browse interactions'}
              </Button>
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
              {previewJobId ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void cancelPreview()}
                >
                  Cancel preview
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2" role="group" aria-label="Preview viewport">
              {(['mobile', 'tablet', 'desktop'] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={viewport === option ? 'default' : 'outline'}
                  onClick={() => setViewport(option)}
                  aria-pressed={viewport === option}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {wordpressSelectionMode
              ? 'Click a section inside WordPress to target the next edit.'
              : 'Interaction mode leaves links, forms, menus, and widgets usable.'}
          </p>
          {previewJob ? (
            <p className="text-xs text-muted-foreground">
              {previewJob.current_step} · stage {previewJob.stage} ·{' '}
              {previewJob.progress}% · attempt{' '}
              {Math.max(1, previewJob.attempt_count)}/{previewJob.max_attempts} ·{' '}
              {jobElapsed(previewJob, jobClock)} · {jobHeartbeat(previewJob)}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-auto bg-muted/40 p-3">
          <div
            className="mx-auto min-h-[720px] overflow-auto bg-background"
            style={{ width: VIEWPORT_WIDTH[viewport] }}
          >
            {payload.previews?.wordpress && previewMatches ? (
              <iframe
                ref={wordpressFrameRef}
                key={`${payload.currentArtifact?.id}-${currentPreviewPage?.slug}-${viewport}-${previewRevision}`}
                title={`Exact WordPress preview at ${VIEWPORT_WIDTH[viewport]} pixels`}
                src={exactWordPressUrl}
                sandbox="allow-scripts allow-same-origin"
                onLoad={postWordPressSelectionMode}
                className="h-[900px] border-0 bg-white"
                style={{ width: VIEWPORT_WIDTH[viewport] }}
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
            )}
          </div>
        </CardContent>
      </Card>
      </div>
      {payload.previewBlueprint ? (
        <SiteForgePageManager
          blueprint={payload.previewBlueprint}
          disabled={submitting || Boolean(activeJobId)}
          authorized={payload.capabilities?.['siteforge.owner_operator'] ?? true}
          onApply={submitPageManagerAction}
          onSelectPage={setSelectedPreviewPage}
        />
      ) : null}
      <Card>
        <CardContent className="p-0">
          <details>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
              <span>Revision history</span>
              <span className="text-xs font-normal text-muted-foreground">
                {payload.revisions?.length || 0} revisions · current v
                {payload.currentArtifact?.version || '—'}
              </span>
            </summary>
            <div className="flex flex-wrap gap-2 border-t p-4">
              {(payload.revisions || []).map(revision => {
                const current = revision.id === payload.currentArtifact?.id
                return (
                  <div
                    key={revision.id}
                    className="min-w-40 rounded border bg-muted/20 p-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong>v{revision.version}</strong>
                      <Badge variant={current ? 'success' : 'outline'}>
                        {current ? 'current' : revision.change_type}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">
                      {revision.changes_summary ||
                        revision.edit_intent ||
                        'Immutable revision'}
                    </p>
                    {!current ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={submitting || Boolean(activeJobId)}
                        onClick={() => void restoreRevision(revision.id)}
                      >
                        Restore v{revision.version}
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
