'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, TrendingUp, TrendingDown, Minus, Calendar, ExternalLink } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { getMarketingChannelLabel, normalizeMarketingChannelId } from '@/utils/analytics/channel-identity'

type Campaign = {
  campaign_id: string
  campaign_name: string
  channel: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  cpc: number
  cpa: number
  first_date: string
  last_date: string
}

type CampaignTrend = {
  date: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
}

type CampaignDetailDrawerProps = {
  campaign: Campaign | null
  propertyId: string
  startDate: string
  endDate: string
  onClose: () => void
}

const channelColors: Record<string, string> = {
  meta_ads: '#1877F2',
  google_ads: '#EA4335',
  tiktok_ads: '#000000',
  linkedin_ads: '#0A66C2',
  unknown: '#6366f1',
}

function formatNumber(value: number, decimals: number = 0): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toFixed(decimals)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

type MetricKey = 'spend' | 'clicks' | 'impressions' | 'conversions'

export function CampaignDetailDrawer({
  campaign,
  propertyId,
  startDate,
  endDate,
  onClose,
}: CampaignDetailDrawerProps) {
  const [trends, setTrends] = useState<CampaignTrend[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('spend')

  const fetchTrends = useCallback(async () => {
    if (!campaign) return
    
    setLoading(true)
    try {
      const params = new URLSearchParams({
        propertyId,
        startDate,
        endDate,
        campaignId: campaign.campaign_id,
      })
      
      const response = await fetch(`/api/analytics/campaigns?${params}`)
      if (response.ok) {
        const data = await response.json()
        setTrends(data.trends || [])
      }
    } catch (err) {
      console.error('Error fetching campaign trends:', err)
    } finally {
      setLoading(false)
    }
  }, [campaign, propertyId, startDate, endDate])

  useEffect(() => {
    if (campaign) {
      fetchTrends()
    }
  }, [campaign, fetchTrends])

  if (!campaign) return null

  const normalizedChannel = normalizeMarketingChannelId(campaign.channel)
  const channelColor = channelColors[normalizedChannel] || channelColors.unknown

  const metricConfig: Record<MetricKey, { label: string; color: string; format: (v: number) => string }> = {
    spend: { label: 'Spend', color: '#6366f1', format: (v) => formatCurrency(v) },
    clicks: { label: 'Clicks', color: '#10b981', format: (v) => formatNumber(v) },
    impressions: { label: 'Impressions', color: '#f59e0b', format: (v) => formatNumber(v) },
    conversions: { label: 'Conversions', color: '#8b5cf6', format: (v) => formatNumber(v) },
  }

  const formattedTrends = trends.map(t => ({
    ...t,
    formattedDate: format(parseISO(t.date), 'MMM d'),
  }))

  // Calculate daily averages
  const daysCount = trends.length || 1
  const dailyAvgSpend = campaign.spend / daysCount
  const dailyAvgClicks = campaign.clicks / daysCount
  const dailyAvgImpressions = campaign.impressions / daysCount

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl z-50 overflow-hidden flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-2">
              <span 
                className="inline-flex px-2 py-1 text-xs font-medium rounded-full"
                style={{ 
                  backgroundColor: `${channelColor}15`,
                  color: channelColor,
                }}
              >
                {getMarketingChannelLabel(normalizedChannel)}
              </span>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Calendar size={12} />
                {campaign.first_date} → {campaign.last_date}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 truncate" title={campaign.campaign_name}>
              {campaign.campaign_name}
            </h2>
            <p className="text-sm text-slate-500 mt-1 truncate" title={campaign.campaign_id}>
              ID: {campaign.campaign_id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Key Metrics */}
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
              Key Metrics
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/50 rounded-xl p-4">
                <p className="text-sm text-indigo-600 font-medium mb-1">Total Spend</p>
                <p className="text-2xl font-bold text-indigo-900">{formatCurrency(campaign.spend)}</p>
                <p className="text-xs text-indigo-500 mt-1">{formatCurrency(dailyAvgSpend)}/day avg</p>
              </div>
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl p-4">
                <p className="text-sm text-emerald-600 font-medium mb-1">Conversions</p>
                <p className="text-2xl font-bold text-emerald-900">{campaign.conversions}</p>
                <p className="text-xs text-emerald-500 mt-1">
                  {campaign.cpa > 0 ? `${formatCurrency(campaign.cpa)} CPA` : 'No conversions yet'}
                </p>
              </div>
              <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 rounded-xl p-4">
                <p className="text-sm text-amber-600 font-medium mb-1">Impressions</p>
                <p className="text-2xl font-bold text-amber-900">{formatNumber(campaign.impressions)}</p>
                <p className="text-xs text-amber-500 mt-1">{formatNumber(dailyAvgImpressions)}/day avg</p>
              </div>
              <div className="bg-gradient-to-br from-sky-50 to-sky-100/50 rounded-xl p-4">
                <p className="text-sm text-sky-600 font-medium mb-1">Clicks</p>
                <p className="text-2xl font-bold text-sky-900">{formatNumber(campaign.clicks)}</p>
                <p className="text-xs text-sky-500 mt-1">{formatNumber(dailyAvgClicks)}/day avg</p>
              </div>
            </div>
          </div>

          {/* Performance Rates */}
          <div className="p-6 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
              Performance Rates
            </h3>
            <div className="space-y-4">
              {/* CTR */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">Click-Through Rate (CTR)</p>
                  <p className="text-xs text-slate-400">Clicks / Impressions × 100</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-900">{campaign.ctr.toFixed(2)}%</p>
                  <div className="w-24 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                      style={{ width: `${Math.min(campaign.ctr * 10, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* CPC */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">Cost Per Click (CPC)</p>
                  <p className="text-xs text-slate-400">Spend / Clicks</p>
                </div>
                <p className="text-lg font-bold text-slate-900">
                  {campaign.cpc > 0 ? formatCurrency(campaign.cpc) : '—'}
                </p>
              </div>

              {/* CPA */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">Cost Per Acquisition (CPA)</p>
                  <p className="text-xs text-slate-400">Spend / Conversions</p>
                </div>
                <p className="text-lg font-bold text-slate-900">
                  {campaign.cpa > 0 ? formatCurrency(campaign.cpa) : '—'}
                </p>
              </div>

              {/* Conversion Rate */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">Conversion Rate</p>
                  <p className="text-xs text-slate-400">Conversions / Clicks × 100</p>
                </div>
                <p className="text-lg font-bold text-slate-900">
                  {campaign.clicks > 0 
                    ? `${((campaign.conversions / campaign.clicks) * 100).toFixed(2)}%` 
                    : '—'}
                </p>
              </div>
            </div>
          </div>

          {/* Trend Chart */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                Daily Trends
              </h3>
              <div className="flex gap-1">
                {(Object.keys(metricConfig) as MetricKey[]).map((metric) => (
                  <button
                    key={metric}
                    onClick={() => setSelectedMetric(metric)}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      selectedMetric === metric
                        ? 'text-white'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                    style={selectedMetric === metric ? { backgroundColor: metricConfig[metric].color } : {}}
                  >
                    {metricConfig[metric].label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="h-[200px] bg-slate-100 rounded-lg animate-pulse flex items-center justify-center">
                <p className="text-slate-400">Loading trends...</p>
              </div>
            ) : formattedTrends.length > 0 ? (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={formattedTrends} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={metricConfig[selectedMetric].color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={metricConfig[selectedMetric].color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis 
                      dataKey="formattedDate" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      dy={8}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      dx={-5}
                      tickFormatter={(value) => {
                        if (selectedMetric === 'spend') return `$${formatNumber(value)}`
                        return formatNumber(value)
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                      }}
                      labelStyle={{ color: '#94a3b8', marginBottom: '4px' }}
                      formatter={(value) => {
                        const numeric =
                          typeof value === 'number' ? value : Number(value ?? 0)
                        return [
                          metricConfig[selectedMetric].format(numeric),
                          metricConfig[selectedMetric].label
                        ] as [string, string]
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey={selectedMetric}
                      stroke={metricConfig[selectedMetric].color}
                      strokeWidth={2}
                      fill="url(#trendGradient)"
                      activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[200px] bg-slate-50 rounded-lg flex items-center justify-center">
                <p className="text-slate-400">No trend data available</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
            <button
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              onClick={() => {
                // In a real app, this would open the campaign in the ad platform
                alert(`Open ${campaign.campaign_id} in ${getMarketingChannelLabel(normalizedChannel)}`)
              }}
            >
              <ExternalLink size={16} />
              View in {getMarketingChannelLabel(normalizedChannel).split(' ')[0] || 'Platform'}
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </>
  )
}

