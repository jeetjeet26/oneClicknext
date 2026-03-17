'use client'

import { useState } from 'react'
import { 
  X, Star, Clock, MessageCircle, Sparkles, Check, 
  Edit3, Send, Loader2, RefreshCw, Copy, AlertTriangle
} from 'lucide-react'
import { SentimentBadge } from './SentimentBadge'
import { PlatformIcon, PlatformName } from './PlatformIcon'
import { ResponseGenerator } from './ResponseGenerator'
import { formatDistanceToNow, format } from 'date-fns'

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
  review_responses?: Array<{
    id: string
    response_text: string
    response_type: string
    status: string
    tone: string
    created_at: string
  }>
  review_tickets?: Array<{
    id: string
    title: string
    priority: string
    status: string
    resolution_notes?: string | null
    resolved_at?: string | null
    created_at?: string | null
  }>
}

interface ReviewDetailDrawerProps {
  review: Review
  onClose: () => void
  onUpdate?: () => void
}

export function ReviewDetailDrawer({ review, onClose, onUpdate }: ReviewDetailDrawerProps) {
  const [showResponseGenerator, setShowResponseGenerator] = useState(false)
  const [editingResponse, setEditingResponse] = useState<string | null>(null)
  const [editedText, setEditedText] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [providerPostId, setProviderPostId] = useState('')
  const [providerPostUrl, setProviderPostUrl] = useState('')
  const [providerNotes, setProviderNotes] = useState('')

  const latestResponse = review.review_responses?.[0]
  const ticket = review.review_tickets?.[0]
  const providerPostAudit = review.review_tickets?.find((candidate) =>
    candidate.title.toLowerCase().includes('provider response posted')
  )
  const parsedProviderAudit = (() => {
    if (!providerPostAudit?.resolution_notes) return null
    try {
      const parsed = JSON.parse(providerPostAudit.resolution_notes) as {
        provider_post_url?: string
        provider_post_id?: string
        confirmed_at?: string
      }
      return parsed
    } catch {
      return null
    }
  })()

  const handleCopyResponse = async () => {
    if (latestResponse) {
      await navigator.clipboard.writeText(latestResponse.response_text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleApproveResponse = async () => {
    if (!latestResponse) return
    setActionLoading('approve')
    setActionError(null)
    
    try {
      const res = await fetch('/api/reviewflow/respond', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseId: latestResponse.id,
          action: 'approve',
          editedText: editingResponse ? editedText : undefined
        })
      })

      if (res.ok) {
        onUpdate?.()
        setEditingResponse(null)
      } else {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || 'Failed to approve response')
      }
    } catch (error) {
      console.error('Error approving response:', error)
      setActionError(error instanceof Error ? error.message : 'Failed to approve response')
    } finally {
      setActionLoading(null)
    }
  }

  const handlePostResponse = async () => {
    if (!latestResponse) return
    setActionLoading('post')
    setActionError(null)

    try {
      const res = await fetch('/api/reviewflow/respond', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseId: latestResponse.id,
          action: 'post',
          manualConfirmed: true,
          providerPostId: providerPostId.trim() || undefined,
          providerPostUrl: providerPostUrl.trim() || undefined,
          providerNotes: providerNotes.trim() || undefined,
        })
      })

      if (res.ok) {
        onUpdate?.()
      } else {
        const data = await res.json().catch(() => ({}))
        setActionError(data.error || 'Failed to mark response as posted')
      }
    } catch (error) {
      console.error('Error posting response:', error)
      setActionError(error instanceof Error ? error.message : 'Failed to mark response as posted')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Drawer */}
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

          {/* Status Badges */}
          <div className="flex items-center gap-2 mt-4">
            <SentimentBadge sentiment={review.sentiment} isUrgent={review.is_urgent} />
            <ResponseStatusBadge status={review.response_status} />
            {ticket && (
              <span className={`text-xs px-2.5 py-1 rounded-full ${
                ticket.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                ticket.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                {ticket.status === 'open' ? 'Open Ticket' : ticket.status}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Review Text */}
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

          {/* AI Analysis */}
          {review.sentiment && (
            <div>
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                AI Analysis
              </h3>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Sentiment Score</span>
                  <SentimentMeter score={review.sentiment_score} />
                </div>
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
              </div>
            </div>
          )}

          {/* Response Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Your Response
              </h3>
              {!latestResponse && (
                <button
                  onClick={() => setShowResponseGenerator(true)}
                  className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate with AI
                </button>
              )}
            </div>

            {latestResponse ? (
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
                    <MessageCircle className="w-4 h-4" />
                    <span className="capitalize">{latestResponse.response_type.replace('_', ' ')}</span>
                    <span>•</span>
                    <span className="capitalize">{latestResponse.tone} tone</span>
                  </div>
                  <ResponseStatusBadge status={latestResponse.status} />
                </div>

                {editingResponse === latestResponse.id ? (
                  <textarea
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    className="w-full h-40 p-3 border border-indigo-300 dark:border-indigo-700 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-500"
                  />
                ) : (
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {latestResponse.response_text}
                  </p>
                )}

                {actionError && (
                  <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {actionError}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-indigo-200 dark:border-indigo-800">
                  {latestResponse.status === 'draft' && (
                    <>
                      {editingResponse === latestResponse.id ? (
                        <>
                          <button
                            onClick={handleApproveResponse}
                            disabled={actionLoading === 'approve'}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === 'approve' ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4" />
                            )}
                            Save & Approve
                          </button>
                          <button
                            onClick={() => setEditingResponse(null)}
                            className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleApproveResponse}
                            disabled={actionLoading === 'approve'}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            {actionLoading === 'approve' ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4" />
                            )}
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setEditingResponse(latestResponse.id)
                              setEditedText(latestResponse.response_text)
                            }}
                            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                            Edit
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
                    </>
                  )}

                  {latestResponse.status === 'approved' && (
                    <div className="w-full space-y-3">
                      <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                        Copy and post this response in the review platform, then confirm it here.
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
                          onClick={handlePostResponse}
                          disabled={actionLoading === 'post' || (!providerPostId.trim() && !providerPostUrl.trim())}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === 'post' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          Mark Posted
                        </button>
                        <button
                          onClick={handleCopyResponse}
                          className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-500" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {latestResponse.status === 'posted' && (
                    <div className="flex items-center gap-2 text-emerald-600">
                      <Check className="w-5 h-5" />
                      <span className="font-medium">Response posted</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-8 text-center">
                <MessageCircle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-slate-500 dark:text-slate-400 mb-4">
                  No response generated yet
                </p>
                <button
                  onClick={() => setShowResponseGenerator(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate AI Response
                </button>
              </div>
            )}
          </div>

          {providerPostAudit && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/20">
              <h3 className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                Provider Post Audit
              </h3>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
                Confirmed {parsedProviderAudit?.confirmed_at
                  ? format(new Date(parsedProviderAudit.confirmed_at), 'MMM d, yyyy h:mm a')
                  : providerPostAudit.resolved_at
                    ? format(new Date(providerPostAudit.resolved_at), 'MMM d, yyyy h:mm a')
                    : 'recently'}
              </p>
              <div className="mt-3 space-y-1 text-xs text-emerald-900 dark:text-emerald-200">
                <p>Ticket: {providerPostAudit.id}</p>
                {parsedProviderAudit?.provider_post_id && (
                  <p>Provider Post ID: {parsedProviderAudit.provider_post_id}</p>
                )}
                {parsedProviderAudit?.provider_post_url && (
                  <a
                    href={parsedProviderAudit.provider_post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-700 underline hover:text-emerald-800 dark:text-emerald-300"
                  >
                    Open provider post evidence
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Response Generator Modal */}
        {showResponseGenerator && (
          <ResponseGenerator
            reviewId={review.id}
            defaultTone={review.sentiment === 'negative' ? 'empathetic' : 'professional'}
            onGenerated={() => {
              setShowResponseGenerator(false)
              onUpdate?.()
            }}
            onClose={() => setShowResponseGenerator(false)}
          />
        )}
      </div>
    </div>
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

  const percentage = ((score + 1) / 2) * 100 // Convert -1 to 1 range to 0-100

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

