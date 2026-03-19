'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { getMarketingChannelLabel, normalizeMarketingChannelId } from '@/utils/analytics/channel-identity'

type ChannelData = {
  channel: string
  spend: number
  conversions: number
  cpa: number
  color: string
}

type ChannelBreakdownProps = {
  data: ChannelData[]
  title?: string
  loading?: boolean
  metric?: 'spend' | 'conversions' | 'cpa'
}

const CHANNEL_COLORS: Record<string, string> = {
  meta_ads: '#1877F2',
  google_ads: '#EA4335',
  ga4: '#F9AB00',
  tiktok_ads: '#000000',
  linkedin_ads: '#0A66C2',
  default: '#6366f1',
}

export function ChannelBreakdown({ 
  data, 
  title = 'Channel Performance',
  loading = false,
  metric = 'spend'
}: ChannelBreakdownProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="h-6 bg-slate-200 rounded w-40 mb-6 animate-pulse"></div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <div className="h-8 bg-slate-200 rounded flex-1"></div>
              <div className="h-8 bg-slate-200 rounded w-20"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const formattedData = data.map((d) => {
    const channel = normalizeMarketingChannelId(d.channel)
    return {
      ...d,
      channel,
      displayName: getMarketingChannelLabel(channel),
      color: CHANNEL_COLORS[channel] || CHANNEL_COLORS.default,
    }
  })

  const metricConfig = {
    spend: { label: 'Spend', prefix: '$', suffix: '' },
    conversions: { label: 'Conversions', prefix: '', suffix: '' },
    cpa: { label: 'Cost per Acquisition', prefix: '$', suffix: '' },
  }

  const config = metricConfig[metric]

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="text-lg font-semibold text-slate-900 mb-6">{title}</h3>
      
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={formattedData} layout="vertical" margin={{ left: 20, right: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={true} vertical={false} />
          
          <XAxis 
            type="number"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            tickFormatter={(value) => {
              if (metric === 'spend' || metric === 'cpa') return `$${value.toLocaleString()}`
              return value.toLocaleString()
            }}
          />
          
          <YAxis 
            type="category"
            dataKey="displayName"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#334155', fontSize: 13, fontWeight: 500 }}
            width={100}
          />
          
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: 'none',
              borderRadius: '8px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
            labelStyle={{ color: '#94a3b8', marginBottom: '8px' }}
            itemStyle={{ color: '#fff' }}
            formatter={(value) => {
              const numeric =
                typeof value === 'number' ? value : Number(value ?? 0)
              return [
                `${config.prefix}${numeric.toLocaleString()}${config.suffix}`,
                config.label
              ] as [string, string]
            }}
          />
          
          <Bar dataKey={metric} radius={[0, 4, 4, 0]} maxBarSize={32}>
            {formattedData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex flex-wrap gap-4">
          {formattedData.map((channel) => (
            <div key={channel.channel} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: channel.color }}
              />
              <span className="text-sm text-slate-600">{channel.displayName}</span>
              <span className="text-sm font-medium text-slate-900">
                {config.prefix}{channel[metric].toLocaleString()}{config.suffix}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}















