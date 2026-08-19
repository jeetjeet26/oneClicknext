'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpenCheck,
  Calendar,
  Check,
  CheckCircle,
  Loader2,
  Pencil,
  ShieldCheck,
  ThumbsDown,
  X,
} from 'lucide-react'

interface Variant {
  id: string
  variant_key: string
  sequence_index: number
  platform: string
  caption: string
  hashtags: string[]
  call_to_action: string | null
  asset_ids: string[]
  media_urls: string[]
  alt_text: string | null
  content_format: string
  storyboard: Array<{
    index: number
    description: string
    durationSeconds?: number | null
    overlayText?: string | null
  }>
  overlay_text: string[]
  safe_area: {
    topPercent: number
    rightPercent: number
    bottomPercent: number
    leftPercent: number
  }
  subtitle_text: string | null
  thumbnail_asset_id: string | null
  platform_options: Record<string, unknown>
  validation: { issues?: Array<{ code: string; message: string }> } | null
}

interface Revision {
  id: string
  revision_number: number
  approval_status: 'pending' | 'approved' | 'denied' | 'superseded'
  authored_by_kind: 'llm' | 'user'
  approved_at: string | null
  approval_note: string | null
  claims: Array<{
    text: string
    type: string
    citations: Array<{ sourceType: string; sourceId: string }>
  }>
  content: {
    conceptSummary?: string
    variants?: Array<Record<string, unknown>>
    claims?: unknown[]
  }
}

interface Publication {
  id: string
  variant_id: string
  platform: string
  status: string
  scheduled_for: string
  remote_post_url: string | null
  last_error: string | null
}

interface Connection {
  id: string
  platform: string
  account_name: string
  account_username: string | null
  is_active: boolean
}

interface PackageDetail {
  id: string
  status: string
  concept_summary: string | null
  current_revision_id: string | null
  currentRevision: Revision | null
  variants: Variant[]
  publications: Publication[]
}

interface ReviewStudioProps {
  propertyId: string
  packageId: string
  onClose: () => void
  onChanged: () => void
}

const CLAIM_LABELS: Record<string, string> = {
  pricing: 'Pricing',
  concession: 'Special / concession',
  availability: 'Availability',
  testimonial: 'Testimonial',
  accessibility: 'Accessibility',
  neighborhood: 'Neighborhood',
  amenity: 'Amenity',
  general: 'General',
}

function channelKey(platform: string): string {
  return platform === 'twitter' ? 'x' : platform
}

export function ReviewStudio({ propertyId, packageId, onClose, onChanged }: ReviewStudioProps) {
  const [detail, setDetail] = useState<PackageDetail | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [editedCaptions, setEditedCaptions] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState<'approved' | 'denied' | null>(null)

  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduleTargets, setScheduleTargets] = useState<string[]>([])
  const [experimentKey, setExperimentKey] = useState('')
  const [experimentGroup, setExperimentGroup] = useState<'control' | 'treatment'>('treatment')
  const [scheduling, setScheduling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [packagesRes, connectionsRes] = await Promise.all([
        fetch(`/api/forgestudio/packages?propertyId=${propertyId}`),
        fetch(`/api/forgestudio/social/connections?propertyId=${propertyId}`),
      ])
      const packagesData = await packagesRes.json()
      const connectionsData = await connectionsRes.json()
      if (!packagesRes.ok) throw new Error(packagesData.error || 'Failed to load package')

      const pkg = (packagesData.packages || []).find(
        (item: PackageDetail) => item.id === packageId
      )
      if (!pkg) throw new Error('Package not found')
      setDetail(pkg)
      setConnections(
        (connectionsData.connections || []).filter((conn: Connection) => conn.is_active)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [propertyId, packageId])

  useEffect(() => {
    load()
  }, [load])

  const revision = detail?.currentRevision ?? null
  const isPending = revision?.approval_status === 'pending'
  const isApproved = revision?.approval_status === 'approved'

  const unsupportedClaims = useMemo(
    () =>
      (revision?.claims ?? []).filter(
        (claim) =>
          ['pricing', 'concession', 'availability', 'testimonial', 'accessibility', 'neighborhood'].includes(
            claim.type
          ) && claim.citations.length === 0
      ),
    [revision]
  )

  const validationIssues = useMemo(
    () =>
      (detail?.variants ?? []).flatMap((variant) =>
        (variant.validation?.issues ?? []).map((issue) => ({
          platform: variant.platform,
          ...issue,
        }))
      ),
    [detail]
  )

  const eligibleConnections = useMemo(() => {
    const variantPlatforms = new Set((detail?.variants ?? []).map((variant) => variant.platform))
    return connections.filter((conn) => variantPlatforms.has(channelKey(conn.platform)))
  }, [connections, detail])

  const hasEdits = Object.entries(editedCaptions).some(([variantId, caption]) => {
    const variant = detail?.variants.find((item) => item.id === variantId)
    return variant && caption !== variant.caption
  })

  const saveEditsAsNewRevision = async () => {
    if (!detail || !revision) return
    if (!reviewNote.trim()) {
      setError('Describe why the content was modified before saving a new revision.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const content = {
        conceptSummary:
          (revision.content.conceptSummary as string) || detail.concept_summary || 'Updated concept',
        variants: detail.variants.map((variant) => ({
          platform: variant.platform,
          variantKey: variant.variant_key,
          sequenceIndex: variant.sequence_index,
          caption: editedCaptions[variant.id] ?? variant.caption,
          hashtags: variant.hashtags,
          callToAction: variant.call_to_action,
          linkUrl: null,
          assetIds: variant.asset_ids,
          mediaUrls: variant.media_urls,
          altText: variant.alt_text,
          contentFormat: variant.content_format,
          platformOptions: variant.platform_options,
          storyboard: variant.storyboard,
          overlayText: variant.overlay_text,
          safeArea: variant.safe_area,
          subtitleText: variant.subtitle_text,
          thumbnailAssetId: variant.thumbnail_asset_id,
        })),
        claims: revision.claims,
      }
      const res = await fetch(`/api/forgestudio/packages/${packageId}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          modificationReason: reviewNote.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save revision')
      setEditedCaptions({})
      setEditingVariantId(null)
      setReviewNote('')
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const submitReview = async (decision: 'approved' | 'denied') => {
    if (!revision) return
    if (!reviewNote.trim()) {
      setError('A review rationale is required for every approval or denial.')
      return
    }
    setReviewing(decision)
    setError(null)
    try {
      const res = await fetch(`/api/forgestudio/revisions/${revision.id}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: reviewNote.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Review failed')
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    } finally {
      setReviewing(null)
    }
  }

  const submitSchedule = async () => {
    if (!revision || !scheduleAt || scheduleTargets.length === 0) return
    setScheduling(true)
    setError(null)
    try {
      const scheduledFor = new Date(scheduleAt).toISOString()
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await fetch('/api/forgestudio/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revisionId: revision.id,
          destinations: scheduleTargets.map((target) => {
            const [connectionId, variantId] = target.split(':')
            return {
              connectionId,
              variantId,
              scheduledFor,
              timezone,
              experimentKey: experimentKey.trim() || undefined,
              experimentGroup: experimentKey.trim() ? experimentGroup : undefined,
            }
          }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scheduling failed')
      setScheduleAt('')
      setScheduleTargets([])
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scheduling failed')
    } finally {
      setScheduling(false)
    }
  }

  const updatePublication = async (
    publicationId: string,
    action: 'retry' | 'cancel'
  ) => {
    setError(null)
    try {
      const response = await fetch(`/api/forgestudio/publications/${publicationId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Failed to ${action} publication`)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} publication`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4 md:p-8">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-5xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Review Studio</h3>
            {detail && (
              <p className="text-sm text-slate-500">
                Revision {revision?.revision_number ?? '—'} ·{' '}
                <span
                  className={
                    isApproved
                      ? 'text-green-600'
                      : isPending
                        ? 'text-amber-600'
                        : 'text-slate-500'
                  }
                >
                  {revision?.approval_status ?? 'unknown'}
                </span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
            </div>
          ) : detail && revision ? (
            <>
              {/* Concept + trust signals */}
              <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {detail.concept_summary}
                </p>
                <div className="flex flex-wrap gap-3 mt-3 text-xs">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {revision.authored_by_kind === 'llm' ? 'AI drafted' : 'User edited'} — you
                    approve before anything is scheduled
                  </span>
                  {unsupportedClaims.length === 0 ? (
                    <span className="flex items-center gap-1 text-green-600">
                      <BookOpenCheck className="w-3.5 h-3.5" />
                      All sensitive claims cite a trusted source
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {unsupportedClaims.length} claim(s) missing sources — approval is blocked
                    </span>
                  )}
                </div>
              </div>

              {/* Claims with citations */}
              {revision.claims.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                    Factual claims
                  </h4>
                  <ul className="space-y-1.5">
                    {revision.claims.map((claim, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 text-sm bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2"
                      >
                        {claim.citations.length > 0 ? (
                          <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div>
                          <span className="text-slate-700 dark:text-slate-300">{claim.text}</span>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {CLAIM_LABELS[claim.type] || claim.type}
                            {claim.citations.length > 0 && (
                              <> · sources: {claim.citations.map((c) => c.sourceId).join(', ')}</>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Validation warnings */}
              {validationIssues.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
                  <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
                    {validationIssues.map((issue, index) => (
                      <li key={index}>
                        <span className="font-medium">{issue.platform}:</span> {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Channel variants side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {detail.variants.map((variant) => {
                  const isEditing = editingVariantId === variant.id
                  const caption = editedCaptions[variant.id] ?? variant.caption
                  return (
                    <div
                      key={variant.id}
                      className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white capitalize">
                          {variant.platform}
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            {variant.content_format} · {variant.variant_key}
                          </span>
                        </span>
                        {isPending && (
                          <button
                            onClick={() =>
                              setEditingVariantId(isEditing ? null : variant.id)
                            }
                            className="text-slate-400 hover:text-violet-600"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {variant.media_urls.length > 0 && (
                        <img
                          src={variant.media_urls[0]}
                          alt={variant.alt_text || ''}
                          className="w-full h-36 object-cover rounded-lg"
                        />
                      )}

                      {isEditing ? (
                        <textarea
                          value={caption}
                          onChange={(event) =>
                            setEditedCaptions((prev) => ({
                              ...prev,
                              [variant.id]: event.target.value,
                            }))
                          }
                          rows={5}
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                        />
                      ) : (
                        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                          {caption}
                        </p>
                      )}

                      {variant.hashtags.length > 0 && (
                        <p className="text-xs text-violet-600">
                          {variant.hashtags.map((tag) => `#${tag}`).join(' ')}
                        </p>
                      )}
                      {variant.call_to_action && (
                        <p className="text-xs text-slate-500">CTA: {variant.call_to_action}</p>
                      )}
                      {variant.overlay_text.length > 0 && (
                        <p className="text-xs text-slate-500">
                          Overlays: {variant.overlay_text.join(' · ')}
                        </p>
                      )}
                      {variant.storyboard.length > 0 && (
                        <ol className="text-xs text-slate-500 list-decimal list-inside space-y-1">
                          {variant.storyboard.map((frame) => (
                            <li key={frame.index}>{frame.description}</li>
                          ))}
                        </ol>
                      )}
                      {variant.subtitle_text && (
                        <p className="text-xs text-slate-500 line-clamp-3">
                          Subtitles: {variant.subtitle_text}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Save edits → new revision */}
              {hasEdits && (
                <div className="flex items-center justify-between bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 rounded-lg p-3">
                  <p className="text-sm text-violet-800 dark:text-violet-200">
                    Saving edits creates a new revision — prior approvals and schedules for the old
                    text are superseded automatically.
                  </p>
                  <button
                    onClick={saveEditsAsNewRevision}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 flex-shrink-0"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Save as revision {revision.revision_number + 1}
                  </button>
                </div>
              )}

              {/* Approval */}
              {isPending && !hasEdits && (
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Approval decision
                  </h4>
                  <input
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="Required rationale: why approved or what must change"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => submitReview('approved')}
                      disabled={
                        reviewing !== null ||
                        unsupportedClaims.length > 0 ||
                        validationIssues.length > 0 ||
                        !reviewNote.trim()
                      }
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${
                        unsupportedClaims.length > 0 || validationIssues.length > 0
                          ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700'
                      }`}
                    >
                      {reviewing === 'approved' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      Approve this exact revision
                    </button>
                    <button
                      onClick={() => submitReview('denied')}
                      disabled={reviewing !== null || !reviewNote.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      {reviewing === 'denied' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ThumbsDown className="w-4 h-4" />
                      )}
                      Deny
                    </button>
                  </div>
                </div>
              )}

              {/* Scheduling — only for the approved current revision */}
              {isApproved && (
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" /> Schedule publications
                  </h4>
                  <div className="space-y-3">
                    {eligibleConnections.map((connection) => {
                      const platform = channelKey(connection.platform)
                      const variants = detail.variants.filter(
                        (variant) => variant.platform === platform
                      )
                      return (
                        <div
                          key={connection.id}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 p-3"
                        >
                          <p className="text-sm font-medium capitalize mb-2">
                            {platform} · {connection.account_username || connection.account_name}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {variants.map((variant) => {
                              const target = `${connection.id}:${variant.id}`
                              const selected = scheduleTargets.includes(target)
                              const alreadyScheduled = detail.publications.some(
                                (publication) =>
                                  publication.variant_id === variant.id &&
                                  !['cancelled', 'failed'].includes(publication.status)
                              )
                              return (
                                <button
                                  key={variant.id}
                                  type="button"
                                  onClick={() =>
                                    setScheduleTargets((current) =>
                                      selected
                                        ? current.filter((value) => value !== target)
                                        : [...current, target]
                                    )
                                  }
                                  disabled={alreadyScheduled}
                                  className={`px-3 py-1.5 rounded-full text-xs border ${
                                    alreadyScheduled
                                      ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                                      : selected
                                        ? 'bg-violet-600 text-white border-violet-600'
                                        : 'border-slate-300 dark:border-slate-600'
                                  }`}
                                >
                                  {variant.content_format} #{variant.sequence_index + 1}
                                  {alreadyScheduled && ' (scheduled)'}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(event) => setScheduleAt(event.target.value)}
                      className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                    />
                    <button
                      onClick={submitSchedule}
                      disabled={scheduling || !scheduleAt || scheduleTargets.length === 0}
                      className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm hover:bg-violet-700 disabled:opacity-50"
                    >
                      {scheduling ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Calendar className="w-4 h-4" />
                      )}
                      Schedule
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      value={experimentKey}
                      onChange={(event) => setExperimentKey(event.target.value)}
                      placeholder="Optional experiment key"
                      className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm"
                    />
                    <select
                      value={experimentGroup}
                      onChange={(event) =>
                        setExperimentGroup(event.target.value as 'control' | 'treatment')
                      }
                      disabled={!experimentKey.trim()}
                      className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm disabled:opacity-50"
                    >
                      <option value="treatment">Treatment</option>
                      <option value="control">Control</option>
                    </select>
                  </div>
                  <p className="text-xs text-slate-500">
                    Times are in your local timezone (
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}).
                  </p>
                </div>
              )}

              {/* Existing publications for this package */}
              {detail.publications.length > 0 && (
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
                    Publications
                  </h4>
                  <ul className="space-y-1.5 text-sm">
                    {detail.publications.map((publication) => (
                      <li
                        key={publication.id}
                        className="flex items-center justify-between bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2"
                      >
                        <span className="capitalize text-slate-700 dark:text-slate-300">
                          {publication.platform} ·{' '}
                          {new Date(publication.scheduled_for).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-2">
                          {publication.status === 'failed' && (
                            <button
                              type="button"
                              onClick={() => updatePublication(publication.id, 'retry')}
                              className="text-xs text-violet-600 hover:underline"
                            >
                              Retry
                            </button>
                          )}
                          {['scheduled', 'queued'].includes(publication.status) && (
                            <button
                              type="button"
                              onClick={() => updatePublication(publication.id, 'cancel')}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Cancel
                            </button>
                          )}
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              publication.status === 'published'
                                ? 'bg-green-100 text-green-700'
                                : publication.status === 'failed'
                                  ? 'bg-red-100 text-red-700'
                                  : publication.status === 'cancelled'
                                    ? 'bg-slate-100 text-slate-500'
                                    : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {publication.status}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500 py-8 text-center">Package not found.</p>
          )}
        </div>
      </div>
    </div>
  )
}
