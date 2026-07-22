'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Clock3, CheckCircle2, Send, Loader2,
  Inbox, Sparkles, ChevronDown, ChevronRight
} from 'lucide-react'
import { ReviewCard } from './ReviewCard'

interface QueueReview {
  id: string
  platform: string
  reviewer_name: string | null
  reviewer_avatar_url: string | null
  rating: number | null
  review_text: string
  review_date: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | null
  is_urgent: boolean
  response_status: string
  topics: string[]
  created_at: string
  review_responses?: Array<{
    id: string
    response_text: string
    status: string
  }>
  reputation_cases?: Array<{
    id: string
    status: string
    priority: string | null
    risk_class: string | null
    policy_class: string | null
    sla_due_at: string | null
  }>
}

interface TodayQueueProps {
  propertyId: string
  onSelectReview?: (review: QueueReview) => void
  onGenerateResponse?: (reviewId: string) => void
  refreshKey?: number
}

type BucketId =
  | 'high_risk'
  | 'sla_risk'
  | 'awaiting_approval'
  | 'ready_to_post'
  | 'needs_attention'
  | 'completed'

interface Bucket {
  id: BucketId
  label: string
  description: string
  icon: typeof AlertTriangle
  iconColor: string
  defaultOpen: boolean
}

const BUCKETS: Bucket[] = [
  {
    id: 'high_risk',
    label: 'High risk & urgent',
    description: 'Sensitive policy classes, urgent flags, and high-priority cases',
    icon: AlertTriangle,
    iconColor: 'text-red-500',
    defaultOpen: true,
  },
  {
    id: 'sla_risk',
    label: 'SLA at risk',
    description: 'Open cases past or near their response deadline',
    icon: Clock3,
    iconColor: 'text-orange-500',
    defaultOpen: true,
  },
  {
    id: 'awaiting_approval',
    label: 'Awaiting approval',
    description: 'Drafts ready for a decision with rationale',
    icon: Sparkles,
    iconColor: 'text-blue-500',
    defaultOpen: true,
  },
  {
    id: 'ready_to_post',
    label: 'Ready to post',
    description: 'Approved responses awaiting provider posting or confirmation',
    icon: Send,
    iconColor: 'text-indigo-500',
    defaultOpen: true,
  },
  {
    id: 'needs_attention',
    label: 'Needs a response',
    description: 'Reviews without a draft yet',
    icon: Inbox,
    iconColor: 'text-amber-500',
    defaultOpen: true,
  },
  {
    id: 'completed',
    label: 'Recently completed',
    description: 'Posted or resolved in this queue window',
    icon: CheckCircle2,
    iconColor: 'text-emerald-500',
    defaultOpen: false,
  },
]

const SENSITIVE_POLICY_CLASSES = new Set([
  'fair_housing', 'discrimination', 'accessibility', 'safety', 'legal_threat',
  'privacy', 'habitability', 'employee_accusation', 'compensation_liability',
])

function bucketFor(review: QueueReview): BucketId {
  const caseRow = review.reputation_cases?.[0]
  const caseOpen = caseRow && !['resolved', 'dismissed'].includes(caseRow.status)

  if (review.response_status === 'posted' || (caseRow && caseRow.status === 'resolved')) {
    return 'completed'
  }
  if (
    review.is_urgent ||
    (caseOpen && (caseRow!.priority === 'urgent' || caseRow!.risk_class === 'high' ||
      SENSITIVE_POLICY_CLASSES.has(caseRow!.policy_class || '')))
  ) {
    return 'high_risk'
  }
  if (caseOpen && caseRow!.sla_due_at && new Date(caseRow!.sla_due_at) < new Date()) {
    return 'sla_risk'
  }
  if (review.response_status === 'draft_ready') {
    return 'awaiting_approval'
  }
  if (review.response_status === 'approved') {
    return 'ready_to_post'
  }
  return 'needs_attention'
}

interface RecoveryItem {
  kind: string
  responseId: string
  reviewId: string | null
  platform: string | null
  reason: string
  occurredAt: string | null
}

export function TodayQueue({ propertyId, onSelectReview, onGenerateResponse, refreshKey }: TodayQueueProps) {
  const [reviews, setReviews] = useState<QueueReview[]>([])
  const [recoveryItems, setRecoveryItems] = useState<RecoveryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openBuckets, setOpenBuckets] = useState<Record<string, boolean>>(
    () => Object.fromEntries(BUCKETS.map((b) => [b.id, b.defaultOpen]))
  )

  const fetchQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [reviewsRes, recoveryRes] = await Promise.all([
        fetch(`/api/reviewflow/reviews?propertyId=${propertyId}&limit=200`, { cache: 'no-store' }),
        fetch(`/api/reviewflow/recovery?propertyId=${propertyId}`, { cache: 'no-store' }),
      ])
      if (!reviewsRes.ok) {
        const data = await reviewsRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load queue')
      }
      const data = await reviewsRes.json()
      setReviews(Array.isArray(data.reviews) ? data.reviews : [])
      if (recoveryRes.ok) {
        const recovery = await recoveryRes.json()
        setRecoveryItems(Array.isArray(recovery.items) ? recovery.items : [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue')
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    fetchQueue()
  }, [fetchQueue, refreshKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-rose-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 p-6 text-center">
        <p className="text-red-700 dark:text-red-300 mb-3">{error}</p>
        <button
          onClick={fetchQueue}
          className="px-4 py-2 text-sm bg-white dark:bg-slate-800 border border-red-200 rounded-lg text-red-600 hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    )
  }

  const grouped = new Map<BucketId, QueueReview[]>()
  for (const bucket of BUCKETS) grouped.set(bucket.id, [])
  for (const review of reviews) {
    grouped.get(bucketFor(review))!.push(review)
  }
  // Completed bucket: only keep the 10 most recent to keep the queue focused.
  grouped.set('completed', (grouped.get('completed') || []).slice(0, 10))

  const actionable = BUCKETS.filter((b) => b.id !== 'completed')
    .reduce((sum, b) => sum + (grouped.get(b.id)?.length || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {actionable === 0
            ? 'Queue is clear — nothing needs attention right now.'
            : `${actionable} review${actionable === 1 ? '' : 's'} need${actionable === 1 ? 's' : ''} attention`}
        </p>
      </div>

      {/* Provider execution recovery */}
      {recoveryItems.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-900/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <span className="font-semibold text-orange-900 dark:text-orange-200">
              Provider execution needs recovery ({recoveryItems.length})
            </span>
          </div>
          <ul className="space-y-1.5">
            {recoveryItems.map((item) => {
              const review = item.reviewId
                ? reviews.find((r) => r.id === item.reviewId)
                : undefined
              return (
                <li key={`${item.kind}-${item.responseId}`} className="text-sm text-orange-800 dark:text-orange-300">
                  {review ? (
                    <button
                      onClick={() => onSelectReview?.(review)}
                      className="underline underline-offset-2 hover:text-orange-950 dark:hover:text-orange-100 text-left"
                    >
                      {item.platform ? `${item.platform}: ` : ''}{item.reason}
                    </button>
                  ) : (
                    <span>{item.platform ? `${item.platform}: ` : ''}{item.reason}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {BUCKETS.map((bucket) => {
        const items = grouped.get(bucket.id) || []
        if (items.length === 0) return null
        const Icon = bucket.icon
        const isOpen = openBuckets[bucket.id]
        return (
          <div
            key={bucket.id}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700"
          >
            <button
              onClick={() => setOpenBuckets((prev) => ({ ...prev, [bucket.id]: !prev[bucket.id] }))}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-5 h-5 ${bucket.iconColor}`} />
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {bucket.label}
                  </span>
                  <span className="ml-2 text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                    {items.length}
                  </span>
                  <p className="text-xs text-slate-400 mt-0.5">{bucket.description}</p>
                </div>
              </div>
              {isOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>
            {isOpen && (
              <div className="px-4 pb-4 space-y-1">
                {items.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    compact
                    onClick={() => onSelectReview?.(review)}
                    onGenerateResponse={
                      bucket.id === 'needs_attention' && onGenerateResponse
                        ? () => onGenerateResponse(review.id)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
