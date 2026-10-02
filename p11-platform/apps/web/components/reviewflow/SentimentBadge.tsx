'use client'

import { Smile, Meh, Frown, AlertTriangle, CircleHelp } from 'lucide-react'

interface SentimentBadgeProps {
  sentiment: 'positive' | 'neutral' | 'negative' | null
  isUrgent?: boolean
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

export function SentimentBadge({ 
  sentiment, 
  isUrgent = false, 
  size = 'md',
  showLabel = true 
}: SentimentBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5'
  }

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16
  }

  if (isUrgent) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 ${sizeClasses[size]}`}>
        <AlertTriangle size={iconSizes[size]} />
        {showLabel && 'Urgent'}
      </span>
    )
  }

  if (sentiment === 'positive') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 ${sizeClasses[size]}`}>
        <Smile size={iconSizes[size]} />
        {showLabel && 'Positive'}
      </span>
    )
  }

  if (sentiment === 'negative') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 ${sizeClasses[size]}`}>
        <Frown size={iconSizes[size]} />
        {showLabel && 'Negative'}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 ${sizeClasses[size]}`}>
      {sentiment==='neutral'?<Meh size={iconSizes[size]} />:<CircleHelp size={iconSizes[size]} />}
      {showLabel && (sentiment==='neutral'?'Neutral':'Not classified')}
    </span>
  )
}

