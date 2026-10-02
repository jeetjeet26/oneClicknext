'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Star, TrendingUp, TrendingDown, MessageCircle, 
  AlertTriangle, Clock, BarChart3, Loader2
} from 'lucide-react'
import {reviewJson} from './ReviewCasePanel'
import { PlatformIcon } from './PlatformIcon'
import { SentimentBadge } from './SentimentBadge'

interface ReviewStatsProps {
  propertyId: string
  days?: number
}

interface Stats {
  ratedReviews:number
  coverageNote:string
  dateFallbackReviews:number
  analysisCoverage:{current:number;staffReview:number;unclassified:number}
  responseEvidence:{staffReported:number;legacyUnverified:number;providerConfirmed:number}
  totalReviews: number
  avgRating: number | null
  responseRate: number | null
  sentimentCounts: {
    positive: number
    neutral: number
    negative: number
  }
  responseCounts: {
    pending: number
    draft_ready: number
    approved: number
    posted: number
    skipped: number
  }
  platformCounts: Record<string, number>
  ticketCounts: {
    open: number
    in_progress: number
    resolved: number
    closed: number
  }
  caseCounts?: {
    open: number
    triaged: number
    awaiting_approval: number
    ready_to_post: number
    remediation: number
    resolved: number
    dismissed: number
    slaBreached: number
  }
  topTopics: Array<{ topic: string; count: number }>
  ratingDistribution: Array<{ rating: number; count: number }>
  recentReviews: Array<{
    id: string
    reviewer_name: string | null
    rating: number | null
    sentiment: string | null
    platform: string
    created_at: string
    observed_at:string
    date_basis:string
  }>
  periodDays: number
}

export function ReviewStats(props:ReviewStatsProps){return <Statistics key={`${props.propertyId}:${props.days||0}`} {...props}/>}
function Statistics({ propertyId, days = 0 }: ReviewStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const [error,setError]=useState(''),[reload,setReload]=useState(0)
  const refresh=useCallback(()=>{setLoading(true);setError('');setStats(null);setReload(n=>n+1)},[])
  useEffect(()=>{const c=new AbortController();void reviewJson<{stats:Stats}>(`/api/reviewflow/stats?propertyId=${propertyId}&days=${days}`,{signal:AbortSignal.any([c.signal,AbortSignal.timeout(20000)])}).then(r=>{if(!c.signal.aborted)setStats(r.stats)}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'Statistics could not be loaded.')}).finally(()=>{if(!c.signal.aborted)setLoading(false)});return()=>c.abort()},[propertyId,days,reload])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    )
  }

  if (error||!stats) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p role="alert">{error||"Statistics could not be loaded."}</p><button className="mt-2 rounded-lg border px-3 py-2 text-sm" onClick={refresh}>Retry review statistics</button>
      </div>
    )
  }

  return (
    <section aria-label="Review statistics" className="space-y-6">
      <p className="text-sm text-slate-500">{stats.coverageNote}</p>
      <p className="text-sm text-slate-500">{stats.ratedReviews} rated reviews · {stats.dateFallbackReviews} reviews use import date. {stats.responseEvidence.staffReported} current responses have staff publication reports; {stats.responseEvidence.legacyUnverified} have only legacy records; {stats.responseEvidence.providerConfirmed} have qualified provider verification.</p>
      {/* Top Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Star}
          iconColor="text-amber-500"
          iconBg="bg-amber-50 dark:bg-amber-900/20"
          label="Average Rating"
          value={stats.avgRating===null?"—":stats.avgRating.toFixed(1)}
          suffix={stats.avgRating===null?undefined:"/5"}
          sublabel={stats.avgRating===null?"No rated reviews":undefined}
        />
        <StatCard
          icon={MessageCircle}
          iconColor="text-indigo-500"
          iconBg="bg-indigo-50 dark:bg-indigo-900/20"
          label="Total Reviews"
          value={stats.totalReviews}
          sublabel={stats.periodDays > 0 ? `Last ${stats.periodDays} days` : 'All time'}
        />
        <StatCard
          icon={Clock}
          iconColor="text-emerald-500"
          iconBg="bg-emerald-50 dark:bg-emerald-900/20"
          label="Recorded response coverage"
          value={stats.responseRate===null?"—":`${stats.responseRate}%`}
          sublabel={stats.responseRate===null?"No eligible reviews":"Excludes skipped responses"}
        />
        <StatCard
          icon={AlertTriangle}
          iconColor="text-red-500"
          iconBg="bg-red-50 dark:bg-red-900/20"
          label="Open Cases"
          value={
            stats.caseCounts
              ? stats.caseCounts.open +
                stats.caseCounts.triaged +
                stats.caseCounts.awaiting_approval +
                stats.caseCounts.ready_to_post +
                stats.caseCounts.remediation
              : stats.ticketCounts.open
          }
          sublabel={
            stats.caseCounts && stats.caseCounts.slaBreached > 0
              ? `${stats.caseCounts.slaBreached} past SLA`
              : undefined
          }
          urgent={(stats.caseCounts?.slaBreached ?? stats.ticketCounts.open) > 0}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Sentiment Breakdown */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-500" />
            Current Analysis Sentiment
          </h3>
          <p className="mb-3 text-sm text-slate-500">{stats.analysisCoverage.current} current analyses; {stats.analysisCoverage.staffReview} need staff review; {stats.analysisCoverage.unclassified} have no current analysis.</p>
          <div className="space-y-4">
            <SentimentBar 
              label="Positive" 
              count={stats.sentimentCounts.positive} 
              total={stats.totalReviews}
              color="bg-emerald-500"
            />
            <SentimentBar 
              label="Neutral" 
              count={stats.sentimentCounts.neutral} 
              total={stats.totalReviews}
              color="bg-slate-400"
            />
            <SentimentBar 
              label="Negative" 
              count={stats.sentimentCounts.negative} 
              total={stats.totalReviews}
              color="bg-red-500"
            />
          </div>
        </div>

        {/* Rating Distribution */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500" />
            Rating Distribution
          </h3>
          <div className="space-y-3">
            {[5, 4, 3, 2, 1].map(rating => {
              const item = stats.ratingDistribution.find(r => r.rating === rating)
              const count = item?.count || 0
              const percentage = stats.totalReviews > 0 
                ? Math.round((count / stats.totalReviews) * 100) 
                : 0
              
              return (
                <div key={rating} className="flex items-center gap-3">
                  <div className="flex items-center gap-1 w-16">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {rating}
                    </span>
                    <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  </div>
                  <div className="flex-1 h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-400 rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-sm text-slate-500 w-12 text-right">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Platform Distribution */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
            Reviews by Platform
          </h3>
          <div className="space-y-3">
            {Object.entries(stats.platformCounts).map(([platform, count]) => (
              <div key={platform} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PlatformIcon platform={platform} size={16} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize">
                    {platform.replace('_', '.')}
                  </span>
                </div>
                <span className="text-sm text-slate-500">{count} reviews</span>
              </div>
            ))}
            {Object.keys(stats.platformCounts).length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">
                No platform data available
              </p>
            )}
          </div>
        </div>

        {/* Top Topics */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
            Most Mentioned Topics
          </h3>
          {stats.topTopics.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {stats.topTopics.map(({ topic, count }) => (
                <span 
                  key={topic}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-700 rounded-full text-sm"
                >
                  <span className="text-slate-700 dark:text-slate-300">{topic}</span>
                  <span className="text-xs text-slate-500 bg-white dark:bg-slate-600 px-1.5 py-0.5 rounded-full">
                    {count}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center py-4">
              No topics identified yet
            </p>
          )}
        </div>
      </div>

      {/* Recent Reviews */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4">
          Recent Reviews
        </h3>
        {stats.recentReviews.length > 0 ? (
          <div className="space-y-3">
            {stats.recentReviews.map(review => (
              <div 
                key={review.id}
                className="flex items-center gap-4 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <PlatformIcon platform={review.platform} size={16} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white truncate">
                    {review.reviewer_name || 'Anonymous'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(review.observed_at).toLocaleDateString()}{review.date_basis==='import_date'?' (import date)':''}
                  </p>
                </div>
                {review.rating && (
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                    <span className="text-sm font-medium">{review.rating}</span>
                  </div>
                )}
                <SentimentBadge 
                  sentiment={review.sentiment as 'positive' | 'neutral' | 'negative' | null} 
                  size="sm" 
                  showLabel={false}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 text-center py-4">
            No recent reviews
          </p>
        )}
      </div>
    </section>
  )
}

function StatCard({ 
  icon: Icon, 
  iconColor, 
  iconBg, 
  label, 
  value, 
  suffix,
  sublabel,
  trend,
  urgent
}: { 
  icon: React.ElementType
  iconColor: string
  iconBg: string
  label: string
  value: string | number
  suffix?: string
  sublabel?: string
  trend?: 'up' | 'down'
  urgent?: boolean
}) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border ${
      urgent ? 'border-red-300 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'
    } p-6`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-sm ${
            trend === 'up' ? 'text-emerald-600' : 'text-red-600'
          }`}>
            {trend === 'up' ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white">
        {value}{suffix && <span className="text-lg text-slate-400">{suffix}</span>}
      </p>
      <p className="text-sm text-slate-500">{label}</p>
      {sublabel && <p className="text-xs text-slate-400 mt-1">{sublabel}</p>}
    </div>
  )
}

function SentimentBar({ 
  label, 
  count, 
  total, 
  color 
}: { 
  label: string
  count: number
  total: number
  color: string
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
        </span>
        <span className="text-sm text-slate-500">
          {count} ({percentage}%)
        </span>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}

