'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { MetricCard } from '@/components/charts'
import { 
  Users, 
  DollarSign, 
  Bot, 
  TrendingUp, 
  MessageSquare, 
  UserPlus,
  ArrowRight,
  FileText,
  RefreshCw,
  Zap
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

type Metric = {
  value: number
  change: number
  period: string
}

type ActivityItem = {
  id: string
  type: 'lead' | 'message_in' | 'message_out'
  title: string
  subtitle: string
  timestamp: string
}

type OverviewData = {
  metrics: {
    totalLeads: Metric
    costPerLead: Metric
    aiResponseRate: Metric
    totalSpend: Metric
    conversions: Metric
    documentsCount: number
  }
  recentActivity: ActivityItem[]
  summary: {
    impressions: number
    clicks: number
    ctr: number
  }
}

export default function DashboardPage() {
  const { currentProperty, loading: propertyLoading } = usePropertyContext()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (propertyLoading || !currentProperty?.id) return
    
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/dashboard/overview?propertyId=${currentProperty.id}`)
      
      if (!response.ok) {
        let message = 'Failed to fetch dashboard data'

        try {
          const result = await response.json()
          if (typeof result?.error === 'string' && result.error.trim().length > 0) {
            message = result.error
          }
        } catch {
          // Ignore JSON parsing errors and keep the fallback message.
        }

        throw new Error(message)
      }
      
      const result = await response.json()
      setData(result)
    } catch (err) {
      console.error('Dashboard fetch error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [currentProperty?.id, propertyLoading])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'lead':
        return <UserPlus size={14} className="text-emerald-500" />
      case 'message_in':
        return <MessageSquare size={14} className="text-blue-500" />
      case 'message_out':
        return <Bot size={14} className="text-indigo-500" />
    }
  }

  const getActivityColor = (type: ActivityItem['type']) => {
    switch (type) {
      case 'lead':
        return 'bg-emerald-500'
      case 'message_in':
        return 'bg-blue-500'
      case 'message_out':
        return 'bg-indigo-500'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
          <p className="text-slate-500 mt-1">
            Performance summary for {currentProperty?.name || 'your property'}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Leads (30d)"
          value={data?.metrics.totalLeads.value ?? 0}
          change={data?.metrics.totalLeads.change}
          changeLabel="vs previous 30d"
          icon={<Users size={20} />}
          loading={loading}
        />
        <MetricCard
          title="Cost Per Lead"
          value={data?.metrics.costPerLead.value?.toFixed(2) ?? '0.00'}
          prefix="$"
          change={data?.metrics.costPerLead.change ? -data.metrics.costPerLead.change : undefined}
          changeLabel="vs previous 30d"
          icon={<DollarSign size={20} />}
          loading={loading}
        />
        <MetricCard
          title="Total Spend (30d)"
          value={data?.metrics.totalSpend.value?.toFixed(0) ?? '0'}
          prefix="$"
          change={data?.metrics.totalSpend.change}
          changeLabel="vs previous 30d"
          icon={<TrendingUp size={20} />}
          loading={loading}
        />
        <MetricCard
          title="AI Response Rate"
          value={data?.metrics.aiResponseRate.value?.toFixed(1) ?? '100.0'}
          suffix="%"
          change={data?.metrics.aiResponseRate.change}
          changeLabel="vs previous 30d"
          icon={<Bot size={20} />}
          loading={loading}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
            <Link 
              href="/dashboard/bi" 
              className="text-sm text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              View all analytics
              <ArrowRight size={14} />
            </Link>
          </div>
          
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-start gap-3 animate-pulse">
                  <div className="h-8 w-8 bg-slate-200 rounded-lg"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : data?.recentActivity && data.recentActivity.length > 0 ? (
            <div className="space-y-4">
              {data.recentActivity.map((activity, idx) => (
                <div 
                  key={activity.id} 
                  className={`flex items-start gap-3 pb-4 ${
                    idx < data.recentActivity.length - 1 ? 'border-b border-slate-100' : ''
                  }`}
                >
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                    activity.type === 'lead' ? 'bg-emerald-50' :
                    activity.type === 'message_in' ? 'bg-blue-50' : 'bg-indigo-50'
                  }`}>
                    {getActivityIcon(activity.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{activity.title}</p>
                    <p className="text-xs text-slate-500 truncate">{activity.subtitle}</p>
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="h-12 w-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Zap size={24} className="text-slate-400" />
              </div>
              <p className="text-slate-500 text-sm mb-1">No recent activity</p>
              <p className="text-slate-400 text-xs">
                Activity will appear here as leads come in and conversations happen
              </p>
            </div>
          )}
        </div>

        {/* Quick Stats & Actions */}
        <div className="space-y-6">
          {/* Performance Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Performance</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-600">Impressions</span>
                  <span className="font-medium text-slate-900">
                    {loading ? '...' : (data?.summary.impressions || 0).toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                    style={{ width: loading ? '0%' : '100%' }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-600">Clicks</span>
                  <span className="font-medium text-slate-900">
                    {loading ? '...' : (data?.summary.clicks || 0).toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                    style={{ 
                      width: loading ? '0%' : 
                        data?.summary.impressions 
                          ? `${Math.min((data.summary.clicks / data.summary.impressions) * 100 * 10, 100)}%`
                          : '0%'
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-600">CTR</span>
                  <span className="font-medium text-slate-900">
                    {loading ? '...' : `${(data?.summary.ctr || 0).toFixed(2)}%`}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                    style={{ 
                      width: loading ? '0%' : `${Math.min((data?.summary.ctr || 0) * 10, 100)}%`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Knowledge Base Status */}
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                <FileText size={20} className="text-indigo-500" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Knowledge Base</h3>
                <p className="text-xs text-slate-500">
                  {loading ? '...' : `${data?.metrics.documentsCount || 0} document chunks`}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/luma"
              className="block w-full py-2.5 bg-white text-center text-sm font-medium text-indigo-600 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition-colors"
            >
              Manage Documents
            </Link>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <Link
                href="/dashboard/bi"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group"
              >
                <div className="h-9 w-9 bg-indigo-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-200 transition-colors">
                  <TrendingUp size={18} className="text-indigo-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">View Analytics</p>
                  <p className="text-xs text-slate-500">MultiChannel BI Dashboard</p>
                </div>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
              <Link
                href="/dashboard/luma"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors group"
              >
                <div className="h-9 w-9 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                  <MessageSquare size={18} className="text-purple-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">Test AI Chat</p>
                  <p className="text-xs text-slate-500">LumaLeasing Assistant</p>
                </div>
                <ArrowRight size={16} className="text-slate-400" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
