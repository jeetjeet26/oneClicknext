'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  X, Star, Clock, MessageCircle, Sparkles, Check,
  Edit3, Send, Loader2, RefreshCw, Copy, AlertTriangle,
  ShieldAlert, History, ExternalLink, Ban
} from 'lucide-react'
import { SentimentBadge } from './SentimentBadge'
import { PlatformIcon, PlatformName } from './PlatformIcon'
import { ResponseGenerator } from './ResponseGenerator'
import { format, formatDistanceToNow } from 'date-fns'

interface ResponseRow {
  id: string
  response_text: string
  response_type: string
  status: string
  tone: string
  decision_reason?: string | null
  superseded_at?: string | null
  posting_mode?: string | null
  platform_response_id?: string | null
  provider_post_url?: string | null
  approved_at?: string | null
  posted_at?: string | null
  created_at: string
}

interface Review {
  id: string
  platform: string
  reviewer_name: string | null
  reviewer_avatar_url: string | null
  rating: number | null
  review_text: string
  review_date: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | null
  sentiment_score: number | null
  is_urgent: boolean
  response_status: string
  topics: string[]
  created_at: string
  review_responses?: ResponseRow[]
  reputation_cases?: Array<{
    id: string
    status: string
    priority: string | null
    risk_class: string | null
    policy_class: string | null
    journey_stage: string | null
    owner_profile_id: string | null
    sla_due_at: string | null
    remediation_state: string | null
  }>
}

interface CaseEvent {
  id: string
  event_type: string
  actor_profile_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

interface CaseAnalysis {
  analysis_version: number
  taxonomy_version: string | null
  model: string | null
  prompt_version: string | null
  confidence: number | null
  severity: string | null
  risk_class: string | null
  policy_class: string | null
  policy_flags: unknown
  evidence: unknown
  journey_stage: string | null
  issue_domains: unknown
  summary: string | null
  recommended_action: string | null
}

interface ReviewDetailDrawerProps {
  review: Review
  onClose: () => void
  onUpdate?: () => void
}

export function ReviewDetailDrawer({ review: initialReview, onClose, onUpdate }: ReviewDetailDrawerProps) {
  // The drawer owns its data: it re-fetches the review after every mutation so
  // it never renders stale list state.
  const [review, setReview] = useState<Review>(initialReview)
  const [caseEvents, setCaseEvents] = useState<CaseEvent[]>([])
  const [caseAnalysis, setCaseAnalysis] = useState<CaseAnalysis | null>(null)
  const [showResponseGenerator, setShowResponseGenerator] = useState(false)
  const [editingResponse, setEditingResponse] = useState<string | null>(null)
  const [editedText, setEditedText] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [manualPostRequired, setManualPostRequired] = useState(false)
  const [providerDeepLink, setProviderDeepLink] = useState<string | null>(null)
  const [providerPostId, setProviderPostId] = useState('')
  const [providerPostUrl, setProviderPostUrl] = useState('')
  const [providerNotes, setProviderNotes] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const refreshReview = useCallback(async () => {
    const propertyId = (initialReview as unknown as { property_id?: string }).property_id
    try {
      const [reviewRes, caseRes] = await Promise.all([
        propertyId
          ? fetch(
              `/api/reviewflow/reviews?propertyId=${propertyId}&reviewId=${initialReview.id}&limit=1`,
              { cache: 'no-store' }
            )
          : Promise.resolve(null),
        fetch(`/api/reviewflow/cases?reviewId=${initialReview.id}`, { cache: 'no-store' }),
      ])
      if (reviewRes?.ok) {
        const data = await reviewRes.json()
        const fresh = Array.isArray(data.reviews) ? data.reviews[0] : null
        if (fresh) setReview(fresh as Review)
      }
      if (caseRes.ok) {
        const data = await caseRes.json()
        setCaseEvents(Array.isArray(data.events) ? data.events : [])
        setCaseAnalysis(data.analysis || null)
        if (data.case) {
          setReview((prev) => ({ ...prev, reputation_cases: [data.case] }))
        }
      }
    } catch {
      // Non-fatal: the drawer keeps rendering the last known state.
    }
  }, [initialReview])

  useEffect(() => {
    setReview(initialReview)
    refreshReview()
  }, [initialReview, refreshReview])

  const responses = (review.review_responses || [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  // Deterministic active response: newest non-superseded, non-rejected row.
  const activeResponse =
    responses.find((r) => !r.superseded_at && r.status !== 'rejected') || responses[0] || null
  const historyResponses = responses.filter((r) => r.id !== activeResponse?.id)
  const reputationCase = review.reputation_cases?.[0] || null

  const requiresRationale = !decisionReason.trim()

  const applyMutation = async (payload: Record<string, unknown>, label: string) => {
    setActionLoading(label)
    setActionError(null)
    try {
      const res = await fetch('/api/reviewflow/respond', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setEditingResponse(null)
        setDecisionReason('')
        setManualPostRequired(false)
        onUpdate?.()
        await refreshReview()
        return { ok: true as const, data }
      }
      return { ok: false as const, status: res.status, data }
    } catch (error) {
      return {
        ok: false as const,
        status: 0,
        data: { error: error instanceof Error ? error.message : 'Request failed' },
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleApprove = async () => {
    if (!activeResponse) return
    const result = await applyMutation(
      {
        responseId: activeResponse.id,
        action: 'approve',
        decisionReason: decisionReason.trim(),
        editedText: editingResponse ? editedText : undefined,
      },
      'approve'
    )
    if (!result.ok) {
      setActionError((result.data as { error?: string }).error || 'Failed to approve response')
    }
  }

  const handleReject = async () => {
    if (!activeResponse) return
    const result = await applyMutation(
      {
        responseId: activeResponse.id,
        action: 'reject',
        decisionReason: decisionReason.trim(),
      },
      'reject'
    )
    if (!result.ok) {
      setActionError((result.data as { error?: string }).error || 'Failed to reject response')
    }
  }

  const handlePost = async (manual: boolean) => {
    if (!activeResponse) return
    const payload: Record<string, unknown> = {
      responseId: activeResponse.id,
      action: 'post',
    }
    if (manual) {
      payload.manualConfirmed = true
      payload.providerPostId = providerPostId.trim() || undefined
      payload.providerPostUrl = providerPostUrl.trim() || undefined
      payload.providerNotes = providerNotes.trim() || undefined
    }
    const result = await applyMutation(payload, 'post')
    if (!result.ok) {
      const data = result.data as { error?: string; deepLink?: string | null }
      if (result.status === 400 && !manual) {
        // Provider posting is not available for this source; fall back to the
        // structured manual-confirmation path.
        setManualPostRequired(true)
        setProviderDeepLink(data.deepLink || null)
        setActionError(null)
      } else {
        setActionError(data.error || 'Failed to post response')
        if (data.deepLink) setProviderDeepLink(data.deepLink)
      }
    }
  }

  const handleCopyResponse = async () => {
    if (activeResponse) {
      await navigator.clipboard.writeText(activeResponse.response_text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 h-full shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 p-6 z-10">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <PlatformIcon platform={review.platform} size={24} />
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                  Review from {review.reviewer_name || 'Anonymous'}
                </h2>
                <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
                  <PlatformName platform={review.platform} />
                  <span>•</span>
                  <RatingDisplay rating={review.rating} />
                  {review.review_date && (
                    <>
                      <span>•</span>
                      <Clock className="w-3 h-3" />
                      <span>{format(new Date(review.review_date), 'MMM d, yyyy')}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <SentimentBadge sentiment={review.sentiment} isUrgent={review.is_urgent} />
            <ResponseStatusBadge status={review.response_status} />
            {reputationCase && <CaseBadge status={reputationCase.status} priority={reputationCase.priority} />}
            {reputationCase?.policy_class && reputationCase.policy_class !== 'standard' && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                <ShieldAlert className="w-3 h-3 inline mr-1" />
                {formatLabel(reputationCase.policy_class)}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Case panel */}
          {reputationCase && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">
                Reputation Case
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <CaseField label="Status" value={formatLabel(reputationCase.status)} />
                <CaseField label="Priority" value={formatLabel(reputationCase.priority)} />
                <CaseField label="Risk" value={formatLabel(reputationCase.risk_class)} />
                <CaseField label="Journey Stage" value={formatLabel(reputationCase.journey_stage)} />
                <CaseField label="Remediation" value={formatLabel(reputationCase.remediation_state)} />
                <CaseField
                  label="SLA Due"
                  value={
                    reputationCase.sla_due_at
                      ? formatDistanceToNow(new Date(reputationCase.sla_due_at), { addSuffix: true })
                      : '—'
                  }
                  danger={
                    !!reputationCase.sla_due_at &&
                    new Date(reputationCase.sla_due_at) < new Date() &&
                    !['resolved', 'dismissed'].includes(reputationCase.status)
                  }
                />
              </div>
            </div>
          )}

          {/* Review Text (source evidence) */}
          <div>
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
              Review Content
            </h3>
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4">
              <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                {review.review_text}
              </p>
            </div>
          </div>

          {/* Classification */}
          {(review.sentiment || caseAnalysis) && (
            <div>
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                Classification
              </h3>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Sentiment Score</span>
                  <SentimentMeter score={review.sentiment_score} />
                </div>
                {caseAnalysis?.summary && (
                  <p className="text-sm text-slate-700 dark:text-slate-300">{caseAnalysis.summary}</p>
                )}
                {caseAnalysis?.recommended_action && (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    <span className="font-medium">Recommended:</span> {caseAnalysis.recommended_action}
                  </p>
                )}
                {Array.isArray(caseAnalysis?.evidence) && caseAnalysis.evidence.length > 0 && (
                  <div>
                    <span className="text-sm text-slate-600 dark:text-slate-400 block mb-1">Cited evidence</span>
                    <ul className="list-disc pl-5 text-sm text-slate-600 dark:text-slate-300 space-y-1">
                      {(caseAnalysis.evidence as string[]).slice(0, 5).map((quote, i) => (
                        <li key={i}>&ldquo;{quote}&rdquo;</li>
                      ))}
                    </ul>
                  </div>
                )}
                {review.topics && review.topics.length > 0 && (
                  <div>
                    <span className="text-sm text-slate-600 dark:text-slate-400 block mb-2">Topics Mentioned</span>
                    <div className="flex flex-wrap gap-2">
                      {review.topics.map((topic, i) => (
                        <span
                          key={i}
                          className="text-sm px-3 py-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-full"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {caseAnalysis && (
                  <p className="text-xs text-slate-400">
                    Analysis v{caseAnalysis.analysis_version}
                    {caseAnalysis.model ? ` • ${caseAnalysis.model}` : ''}
                    {caseAnalysis.prompt_version ? ` • ${caseAnalysis.prompt_version}` : ''}
                    {typeof caseAnalysis.confidence === 'number'
                      ? ` • confidence ${(caseAnalysis.confidence * 100).toFixed(0)}%`
                      : ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Response Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Public Response
              </h3>
              {!activeResponse && (
                <button
                  onClick={() => setShowResponseGenerator(true)}
                  className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  <Sparkles className="w-4 h-4" />
                  Draft with AI
                </button>
              )}
            </div>

            {activeResponse ? (
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
                    <MessageCircle className="w-4 h-4" />
                    <span className="capitalize">{activeResponse.response_type.replace('_', ' ')}</span>
                    <span>•</span>
                    <span className="capitalize">{activeResponse.tone} tone</span>
                  </div>
                  <ResponseStatusBadge status={activeResponse.status} />
                </div>

                {editingResponse === activeResponse.id ? (
                  <textarea
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="w-full h-40 p-3 border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {activeResponse.response_text}
                  </p>
                )}

                {actionError && (
                  <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {actionError}
                  </div>
                )}

                {/* Draft decision flow: rationale is mandatory */}
                {activeResponse.status === 'draft' && (
                  <div className="mt-4 pt-4 border-t border-indigo-200 dark:border-indigo-800 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Decision rationale (required)
                      </label>
                      <textarea
                        value={decisionReason}
                        onChange={(e) => setDecisionReason(e.target.value)}
                        placeholder="Why are you approving or rejecting this response?"
                        className="w-full h-16 p-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={handleApprove}
                        disabled={actionLoading !== null || requiresRationale}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === 'approve' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        {editingResponse === activeResponse.id ? 'Save & Approve' : 'Approve'}
                      </button>
                      <button
                        onClick={handleReject}
                        disabled={actionLoading !== null || requiresRationale}
                        className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        {actionLoading === 'reject' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Ban className="w-4 h-4" />
                        )}
                        Reject
                      </button>
                      {editingResponse === activeResponse.id ? (
                        <button
                          onClick={() => setEditingResponse(null)}
                          className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          Cancel Edit
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingResponse(activeResponse.id)
                              setEditedText(activeResponse.response_text)
                            }}
                            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                            Modify
                          </button>
                          <button
                            onClick={() => setShowResponseGenerator(true)}
                            className="flex items-center gap-2 px-4 py-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Regenerate
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Approved → post flow */}
                {activeResponse.status === 'approved' && (
                  <div className="mt-4 pt-4 border-t border-indigo-200 dark:border-indigo-800 space-y-3">
                    {activeResponse.decision_reason && (
                      <p className="text-xs text-slate-500">
                        Approved: {activeResponse.decision_reason}
                      </p>
                    )}
                    {!manualPostRequired ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handlePost(false)}
                          disabled={actionLoading === 'post'}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === 'post' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          Post Response
                        </button>
                        <button
                          onClick={handleCopyResponse}
                          className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-500" /> Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                          Direct posting is not available for this source. Copy the response, post it
                          on the platform, then confirm here with evidence.
                          {providerDeepLink && (
                            <a
                              href={providerDeepLink}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 inline-flex items-center gap-1 text-indigo-600 underline"
                            >
                              Open platform <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={providerPostUrl}
                            onChange={(e) => setProviderPostUrl(e.target.value)}
                            placeholder="Provider post URL"
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                          />
                          <input
                            value={providerPostId}
                            onChange={(e) => setProviderPostId(e.target.value)}
                            placeholder="Provider post ID"
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                          />
                          <input
                            value={providerNotes}
                            onChange={(e) => setProviderNotes(e.target.value)}
                            placeholder="Optional posting notes"
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm sm:col-span-2"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePost(true)}
                            disabled={actionLoading === 'post' || (!providerPostId.trim() && !providerPostUrl.trim())}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === 'post' ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            Confirm Posted
                          </button>
                          <button
                            onClick={handleCopyResponse}
                            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            {copied ? (
                              <>
                                <Check className="w-4 h-4 text-emerald-500" /> Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" /> Copy
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Posted evidence lives on the response row itself */}
                {activeResponse.status === 'posted' && (
                  <div className="mt-4 pt-4 border-t border-indigo-200 dark:border-indigo-800">
                    <div className="flex items-center gap-2 text-emerald-600 mb-2">
                      <Check className="w-5 h-5" />
                      <span className="font-medium">
                        Response posted
                        {activeResponse.posting_mode
                          ? ` (${activeResponse.posting_mode === 'provider_api' ? 'via provider API' : 'manually confirmed'})`
                          : ''}
                      </span>
                    </div>
                    <div className="space-y-1 text-xs text-slate-500">
                      {activeResponse.posted_at && (
                        <p>Posted {format(new Date(activeResponse.posted_at), 'MMM d, yyyy h:mm a')}</p>
                      )}
                      {activeResponse.platform_response_id && (
                        <p>Provider response ID: {activeResponse.platform_response_id}</p>
                      )}
                      {activeResponse.provider_post_url && (
                        <a
                          href={activeResponse.provider_post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-600 underline"
                        >
                          Open provider post evidence <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {activeResponse.status === 'rejected' && activeResponse.decision_reason && (
                  <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                    Rejected: {activeResponse.decision_reason}
                  </p>
                )}
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-8 text-center">
                <MessageCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-slate-500 dark:text-slate-400 mb-4">
                  No draft yet
                </p>
                <button
                  onClick={() => setShowResponseGenerator(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Draft AI Response
                </button>
              </div>
            )}
          </div>

          {/* Response version history */}
          {historyResponses.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700"
              >
                <History className="w-4 h-4" />
                Response history ({historyResponses.length})
              </button>
              {showHistory && (
                <div className="mt-2 space-y-2">
                  {historyResponses.map((r) => (
                    <div key={r.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-400">
                          {format(new Date(r.created_at), 'MMM d, yyyy h:mm a')}
                          {r.superseded_at ? ' • superseded' : ''}
                        </span>
                        <ResponseStatusBadge status={r.status} />
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-3 whitespace-pre-wrap">
                        {r.response_text}
                      </p>
                      {r.decision_reason && (
                        <p className="mt-1 text-xs text-slate-400">Rationale: {r.decision_reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Immutable case timeline */}
          {caseEvents.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                Case Timeline
              </h3>
              <div className="space-y-0">
                {caseEvents.map((event, index) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5" />
                      {index < caseEvents.length - 1 && (
                        <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700" />
                      )}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        {formatLabel(event.event_type)}
                      </p>
                      <p className="text-xs text-slate-400">
                        {format(new Date(event.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                      {typeof event.payload?.decisionReason === 'string' && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          &ldquo;{event.payload.decisionReason}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {showResponseGenerator && (
          <ResponseGenerator
            reviewId={review.id}
            defaultTone={review.sentiment === 'negative' ? 'empathetic' : 'professional'}
            onGenerated={() => {
              setShowResponseGenerator(false)
              onUpdate?.()
              refreshReview()
            }}
            onClose={() => setShowResponseGenerator(false)}
          />
        )}
      </div>
    </div>
  )
}

function formatLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function CaseField({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`font-medium ${danger ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'}`}>
        {value}
      </p>
    </div>
  )
}

function CaseBadge({ status, priority }: { status: string; priority: string | null }) {
  const isUrgent = priority === 'urgent' || priority === 'high'
  return (
    <span
      className={`text-xs px-2.5 py-1 rounded-full ${
        isUrgent
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {isUrgent && <AlertTriangle className="w-3 h-3 inline mr-1" />}
      Case: {formatLabel(status)}
    </span>
  )
}

function RatingDisplay({ rating }: { rating: number | null }) {
  if (!rating) return <span>No rating</span>
  return (
    <div className="flex items-center gap-1">
      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
      <span>{rating}/5</span>
    </div>
  )
}

function ResponseStatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    pending: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: 'Pending' },
    draft: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Draft' },
    draft_ready: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'Draft Ready' },
    approved: { color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400', label: 'Approved' },
    posted: { color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', label: 'Posted' },
    rejected: { color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'Rejected' },
    skipped: { color: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400', label: 'Skipped' }
  }

  const statusConfig = config[status] || config.pending

  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusConfig.color}`}>
      {statusConfig.label}
    </span>
  )
}

function SentimentMeter({ score }: { score: number | null }) {
  if (score === null) return null

  const percentage = ((score + 1) / 2) * 100

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            score > 0.3 ? 'bg-emerald-500' :
            score < -0.3 ? 'bg-red-500' :
            'bg-amber-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {score > 0 ? '+' : ''}{score.toFixed(2)}
      </span>
    </div>
  )
}
