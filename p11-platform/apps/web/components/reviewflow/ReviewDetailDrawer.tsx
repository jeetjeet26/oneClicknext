'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  X, Star, Clock, AlertTriangle, ShieldAlert
} from 'lucide-react'
import { SentimentBadge } from './SentimentBadge'
import { PlatformIcon, PlatformName } from './PlatformIcon'
import { ReviewCasePanel } from './ReviewCasePanel'
import { ReviewAnalysisPanel } from './ReviewAnalysisPanel'
import { ReviewResponsePanel } from './ReviewResponsePanel'
import { ReviewTestimonialPanel } from './ReviewTestimonialPanel'
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

interface TestimonialApprovalRow {
  id: string
  status: 'active' | 'revoked'
  rights_basis: string
  rights_evidence: Record<string, unknown> | null
  approved_at: string
  revoked_at: string | null
  revocation_reason: string | null
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
  review_testimonial_approvals?: TestimonialApprovalRow[]
  reputation_cases?: Array<{
    version: number
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
  propertyId: string
  review: Review
  onClose: () => void
  onUpdate?: () => void
}

export function ReviewDetailDrawer({ propertyId, review: initialReview, onClose, onUpdate }: ReviewDetailDrawerProps) {
  // The drawer owns its data: it re-fetches the review after every mutation so
  // it never renders stale list state.
  const [review, setReview] = useState<Review>(initialReview)
  const [caseEvents, setCaseEvents] = useState<CaseEvent[]>([])
  const [caseAnalysis, setCaseAnalysis] = useState<CaseAnalysis | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const refreshReview = useCallback(async () => {
    try {
      const [reviewRes, caseRes] = await Promise.all([
        propertyId
          ? fetch(
              `/api/reviewflow/reviews?propertyId=${propertyId}&reviewId=${initialReview.id}&limit=1`,
              { cache: 'no-store' }
            )
          : Promise.resolve(null),
        fetch(`/api/reviewflow/cases?propertyId=${propertyId}&reviewId=${initialReview.id}`, { cache: 'no-store' }),
      ])
      if(!reviewRes?.ok||!caseRes.ok)throw new Error('The saved review or case could not be refreshed. Reload before making another decision.')
      setActionError(null)
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
    } catch(error) {
      setActionError(error instanceof Error?error.message:'The saved review could not be refreshed.')
    }
  }, [initialReview,propertyId])

  useEffect(() => {
    setReview(initialReview)
    refreshReview()
  }, [initialReview, refreshReview])

  const reputationCase = review.reputation_cases?.[0] || null
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
              aria-label="Close review details"
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
          {actionError&&<div role="alert" className="text-sm text-red-600"><p>{actionError}</p><button className="mt-2 rounded-lg border px-3 py-2" onClick={()=>void refreshReview()}>Reload review</button></div>}
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

          <ReviewCasePanel propertyId={propertyId} reviewId={review.id} refreshVersion={reputationCase?.version} onSaved={()=>{void refreshReview();onUpdate?.()}}/>

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

          <ReviewTestimonialPanel propertyId={propertyId} reviewId={review.id} onSaved={()=>{void refreshReview();onUpdate?.()}}/>

          <ReviewAnalysisPanel propertyId={propertyId} reviewId={review.id} onApplied={()=>{void refreshReview();onUpdate?.()}}/>
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
                      {(caseAnalysis.evidence as Array<string|{quote:string;claim:string}>).slice(0, 5).map((evidence, i) => (
                        <li key={i}>{typeof evidence==='string'?evidence:<><span className="font-medium">{evidence.claim}</span> — &ldquo;{evidence.quote}&rdquo;</>}</li>
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

          <ReviewResponsePanel propertyId={propertyId} reviewId={review.id} onSaved={()=>{void refreshReview();onUpdate?.()}}/>

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
