'use client'

import { Star, MessageCircle, Clock, ChevronRight, Sparkles } from 'lucide-react'
import { SentimentBadge } from './SentimentBadge'
import { PlatformIcon } from './PlatformIcon'
import { formatDistanceToNow } from 'date-fns'

interface Review {
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
  review_responses?: Array<{
    id: string
    response_text: string
    status: string
  }>
}

interface ReviewCardProps {
  review: Review
  onClick?: () => void
  onGenerateResponse?: () => void
  compact?: boolean
}

export function ReviewCard({ review, onClick, onGenerateResponse, compact = false }: ReviewCardProps) {
  const hasResponse = review.review_responses && review.review_responses.length > 0
  const latestResponse = hasResponse ? review.review_responses![0] : null

  const statusConfig: Record<string, { label: string; color: string }> = {
    pending: { label: 'Needs Response', color: 'bg-amber-100 text-amber-700' },
    draft_ready: { label: 'Draft Ready', color: 'bg-blue-100 text-blue-700' },
    approved: { label: 'Approved', color: 'bg-indigo-100 text-indigo-700' },
    posted: { label: 'Responded', color: 'bg-emerald-100 text-emerald-700' },
    skipped: { label: 'Skipped', color: 'bg-slate-100 text-slate-500' }
  }

  const status = statusConfig[review.response_status] || statusConfig.pending

  if (compact) {
    return (
      <div 
        className="flex items-center gap-4 p-4 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors rounded-lg"
        onClick={onClick}
      >
        <PlatformIcon platform={review.platform} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-white">
              {review.reviewer_name || 'Anonymous'}
            </span>
            <RatingStars rating={review.rating} size="sm" />
          </div>
          <p className="text-sm text-slate-500 truncate">{review.review_text}</p>
        </div>
        <SentimentBadge sentiment={review.sentiment} isUrgent={review.is_urgent} size="sm" />
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </div>
    )
  }

  return (
    <div 
      className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <PlatformIcon platform={review.platform} />
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              {review.reviewer_name || 'Anonymous'}
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <RatingStars rating={review.rating} size="sm" />
              {review.review_date && (
                <>
                  <span>•</span>
                  <Clock className="w-3 h-3" />
                  <span>{formatDistanceToNow(new Date(review.review_date), { addSuffix: true })}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SentimentBadge sentiment={review.sentiment} isUrgent={review.is_urgent} />
          <span className={`text-xs px-2 py-1 rounded-full ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Review Text */}
      <p className="text-slate-700 dark:text-slate-300 mb-4 line-clamp-3">
        {review.review_text}
      </p>

      {/* Topics */}
      {review.topics && review.topics.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {review.topics.map((topic, i) => (
            <span 
              key={i}
              className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      {/* Response Preview or Generate Button */}
      {latestResponse ? (
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 mt-4">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
            <MessageCircle className="w-4 h-4" />
            <span>Your Response</span>
            {latestResponse.status === 'draft' && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Draft</span>
            )}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
            {latestResponse.response_text}
          </p>
        </div>
      ) : (
        review.response_status === 'pending' && onGenerateResponse && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onGenerateResponse()
            }}
            className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium mt-4"
          >
            <Sparkles className="w-4 h-4" />
            Review response
          </button>
        )
      )}
    </div>
  )
}

function RatingStars({ rating, size = 'md' }: { rating: number | null; size?: 'sm' | 'md' }) {
  if (!rating) return null

  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4'
  }

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${sizeClasses[size]} ${
            star <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'text-slate-300 dark:text-slate-600'
          }`}
        />
      ))}
    </div>
  )
}

