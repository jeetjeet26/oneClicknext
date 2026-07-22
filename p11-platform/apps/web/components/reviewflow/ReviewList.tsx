'use client'

import { useState, useEffect } from 'react'
import { Search, Filter, RefreshCw, Loader2 } from 'lucide-react'
import { ReviewCard } from './ReviewCard'
import { PlatformIcon } from './PlatformIcon'

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

interface ReviewListProps {
  propertyId: string
  onSelectReview?: (review: Review) => void
  onGenerateResponse?: (reviewId: string) => void
}

type FilterOption = {
  platform?: string
  sentiment?: string
  status?: string
}

const PAGE_SIZE = 25

export function ReviewList({ propertyId, onSelectReview, onGenerateResponse }: ReviewListProps) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState<FilterOption>({})
  const [showFilters, setShowFilters] = useState(false)

  const buildParams = (offset: number) => {
    const params = new URLSearchParams({
      propertyId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
    if (filters.platform) params.append('platform', filters.platform)
    if (filters.sentiment) params.append('sentiment', filters.sentiment)
    if (filters.status) params.append('status', filters.status)
    return params
  }

  const fetchReviews = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reviewflow/reviews?${buildParams(0)}`)
      if (res.ok) {
        const data = await res.json()
        setReviews(data.reviews || [])
        setTotal(typeof data.total === 'number' ? data.total : null)
      }
    } catch (error) {
      console.error('Error fetching reviews:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/reviewflow/reviews?${buildParams(reviews.length)}`)
      if (res.ok) {
        const data = await res.json()
        setReviews(prev => [...prev, ...(data.reviews || [])])
        setTotal(typeof data.total === 'number' ? data.total : null)
      }
    } catch (error) {
      console.error('Error fetching more reviews:', error)
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && reviews.length < total

  useEffect(() => {
    fetchReviews()
  }, [propertyId, filters])

  const filteredReviews = reviews.filter(review => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      review.reviewer_name?.toLowerCase().includes(query) ||
      review.review_text.toLowerCase().includes(query) ||
      review.topics?.some(t => t.toLowerCase().includes(query))
    )
  })

  const platforms = ['google', 'yelp', 'apartments_com', 'facebook']
  const sentiments = ['positive', 'neutral', 'negative']
  const statuses = [
    { value: 'pending', label: 'Needs Response' },
    { value: 'draft_ready', label: 'Draft Ready' },
    { value: 'approved', label: 'Approved' },
    { value: 'posted', label: 'Responded' }
  ]

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search reviews..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
            showFilters || Object.keys(filters).length > 0
              ? 'border-indigo-500 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
              : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {Object.keys(filters).length > 0 && (
            <span className="w-5 h-5 bg-indigo-600 text-white text-xs rounded-full flex items-center justify-center">
              {Object.keys(filters).length}
            </span>
          )}
        </button>
        <button
          onClick={fetchReviews}
          disabled={loading}
          className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <RefreshCw className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {/* Platform Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Platform
              </label>
              <div className="flex flex-wrap gap-2">
                {platforms.map(platform => (
                  <button
                    key={platform}
                    onClick={() => setFilters(f => ({
                      ...f,
                      platform: f.platform === platform ? undefined : platform
                    }))}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      filters.platform === platform
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600'
                    }`}
                  >
                    <PlatformIcon platform={platform} size={14} />
                  </button>
                ))}
              </div>
            </div>

            {/* Sentiment Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Sentiment
              </label>
              <div className="flex flex-wrap gap-2">
                {sentiments.map(sentiment => (
                  <button
                    key={sentiment}
                    onClick={() => setFilters(f => ({
                      ...f,
                      sentiment: f.sentiment === sentiment ? undefined : sentiment
                    }))}
                    className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                      filters.sentiment === sentiment
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600'
                    }`}
                  >
                    {sentiment}
                  </button>
                ))}
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Response Status
              </label>
              <div className="flex flex-wrap gap-2">
                {statuses.map(status => (
                  <button
                    key={status.value}
                    onClick={() => setFilters(f => ({
                      ...f,
                      status: f.status === status.value ? undefined : status.value
                    }))}
                    className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      filters.status === status.value
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600'
                    }`}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {Object.keys(filters).length > 0 && (
            <button
              onClick={() => setFilters({})}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Reviews Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : filteredReviews.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
            No reviews found
          </h3>
          <p className="text-slate-500">
            {searchQuery || Object.keys(filters).length > 0
              ? 'Try adjusting your search or filters'
              : 'Reviews will appear here once they are imported'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {filteredReviews.map(review => (
              <ReviewCard
                key={review.id}
                review={review}
                onClick={() => onSelectReview?.(review)}
                onGenerateResponse={() => onGenerateResponse?.(review.id)}
              />
            ))}
          </div>
          {hasMore && !searchQuery && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                Load more ({reviews.length} of {total})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

