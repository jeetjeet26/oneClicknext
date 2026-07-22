'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type MetricCardProps = {
  title: string
  value: string | number
  change?: number
  changeLabel?: string
  /** Shown in place of the change row when no change is available. */
  subtitle?: string
  prefix?: string
  suffix?: string
  icon?: React.ReactNode
  loading?: boolean
  previousValue?: number
  showPrevious?: boolean
}

export function MetricCard({ 
  title, 
  value, 
  change, 
  changeLabel = 'vs last period',
  subtitle,
  prefix = '',
  suffix = '',
  icon,
  loading = false,
  previousValue,
  showPrevious = false
}: MetricCardProps) {
  const isPositive = change !== undefined && change > 0
  const isNegative = change !== undefined && change < 0
  const isNeutral = change === 0

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-24 mb-3"></div>
        <div className="h-8 bg-slate-200 rounded w-32 mb-2"></div>
        <div className="h-3 bg-slate-200 rounded w-20"></div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>
      
      <div className="flex items-end gap-2 mb-2">
        <p className="text-3xl font-bold text-slate-900">
          {prefix}{typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value}{suffix}
        </p>
        {showPrevious && previousValue !== undefined && (
          <p className="text-sm text-slate-400 mb-1">
            vs {prefix}{previousValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}{suffix}
          </p>
        )}
      </div>
      
      {change !== undefined && (
        <div className="flex items-center gap-1.5">
          {isPositive && (
            <>
              <TrendingUp size={14} className="text-emerald-500" />
              <span className="text-sm font-medium text-emerald-600">+{change.toFixed(1)}%</span>
            </>
          )}
          {isNegative && (
            <>
              <TrendingDown size={14} className="text-red-500" />
              <span className="text-sm font-medium text-red-600">{change.toFixed(1)}%</span>
            </>
          )}
          {isNeutral && (
            <>
              <Minus size={14} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-500">0%</span>
            </>
          )}
          <span className="text-xs text-slate-400">{changeLabel}</span>
        </div>
      )}
      {change === undefined && subtitle && (
        <p className="text-xs text-slate-400">{subtitle}</p>
      )}
    </div>
  )
}

