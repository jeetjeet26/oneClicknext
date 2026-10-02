'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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

export function ReviewList(props:ReviewListProps){return <ReviewListWorkspace key={props.propertyId} {...props}/>}
function ReviewListWorkspace({ propertyId, onSelectReview, onGenerateResponse }: ReviewListProps) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState<FilterOption>({})
  const [showFilters, setShowFilters] = useState(false)

  const [error,setError]=useState(''),[search,setSearch]=useState('')
  const request=useRef<AbortController|null>(null)
  const params=useCallback((offset:number)=>{const q=new URLSearchParams({propertyId,limit:String(PAGE_SIZE),offset:String(offset)});if(filters.platform)q.set('platform',filters.platform);if(filters.sentiment)q.set('sentiment',filters.sentiment);if(filters.status)q.set('status',filters.status);if(search)q.set('search',search);return q},[propertyId,filters,search])
  const fetchReviews=useCallback(async()=>{request.current?.abort();const c=new AbortController();request.current=c;setLoading(true);setLoadingMore(false);setError('');setReviews([]);setTotal(null);try{const r=await fetch(`/api/reviewflow/reviews?${params(0)}`,{cache:'no-store',signal:AbortSignal.any([c.signal,AbortSignal.timeout(20000)])});const body=await r.json();if(!r.ok)throw new Error(body.error||'Reviews could not be loaded.');if(!c.signal.aborted){setReviews(body.reviews);setTotal(body.total)}}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'Reviews could not be loaded.')}finally{if(!c.signal.aborted)setLoading(false)}},[params])
  const loadMore=async()=>{if(loadingMore)return;request.current?.abort();const c=new AbortController();request.current=c;setLoadingMore(true);setError('');try{const r=await fetch(`/api/reviewflow/reviews?${params(reviews.length)}`,{cache:'no-store',signal:AbortSignal.any([c.signal,AbortSignal.timeout(20000)])});const body=await r.json();if(!r.ok)throw new Error(body.error||'More reviews could not be loaded.');if(!c.signal.aborted){setReviews(previous=>[...previous,...body.reviews.filter((r:Review)=>!previous.some(p=>p.id===r.id))]);setTotal(body.total)}}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'More reviews could not be loaded.')}finally{if(!c.signal.aborted)setLoadingMore(false)}}
  useEffect(()=>{const timer=setTimeout(()=>setSearch(searchQuery.trim()),250);return()=>clearTimeout(timer)},[searchQuery])
  useEffect(()=>{void fetchReviews();return()=>request.current?.abort()},[fetchReviews])
  const hasMore=total!==null&&reviews.length<total,filteredReviews=reviews

  const platforms = ['google', 'yelp', 'apartments_com', 'facebook', 'other']
  const sentiments = ['positive', 'neutral', 'negative']
  const statuses = [
    { value: 'pending', label: 'Needs Response' },
    { value: 'draft_ready', label: 'Draft Ready' },
    { value: 'approved', label: 'Approved' },
    { value: 'posted', label: 'Responded' }
  ]

  return (
    <section aria-label="Property reviews" className="space-y-4">
      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            aria-label="Search all review text and names"
            placeholder="Search all review text and names"
            maxLength={200}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${
            showFilters || Object.values(filters).filter(Boolean).length > 0
              ? 'border-indigo-500 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
              : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {Object.values(filters).filter(Boolean).length > 0 && (
            <span className="w-5 h-5 bg-indigo-600 text-white text-xs rounded-full flex items-center justify-center">
              {Object.values(filters).filter(Boolean).length}
            </span>
          )}
        </button>
        <button
          aria-label="Reload reviews"
          onClick={()=>void fetchReviews()}
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
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Platform Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Platform
              </label>
              <div className="flex flex-wrap gap-2">
                {platforms.map(platform => (
                  <button
                    key={platform}
                    aria-label={`Filter ${platform} reviews`}
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

          {Object.values(filters).filter(Boolean).length > 0 && (
            <button
              onClick={() => setFilters({})}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {error&&<div role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-600">{error} <button className="underline" onClick={()=>void fetchReviews()}>Retry review list</button></div>}
      {!loading&&!error&&total!==null&&<p className="text-sm text-slate-500">{total} matching reviews across this property.</p>}
      {/* Reviews Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : error && reviews.length===0 ? null : filteredReviews.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
            No reviews found
          </h3>
          <p className="text-slate-500">
            {searchQuery || Object.values(filters).filter(Boolean).length > 0
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
          {hasMore && (
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
    </section>
  )
}

