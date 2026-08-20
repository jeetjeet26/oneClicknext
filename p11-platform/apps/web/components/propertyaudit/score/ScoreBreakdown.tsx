'use client'

import { useState } from 'react'
import { Info, ChevronDown, ChevronUp } from 'lucide-react'

interface ScoreBreakdownProps {
  score: number
  breakdown: {
    position: number
    link: number
    sov: number
    accuracy: number
  }
  compact?: boolean
}

const WEIGHTS = {
  position: 0.45,
  link: 0.25,
  sov: 0.20,
  accuracy: 0.10
}

const COLORS = {
  position: 'bg-indigo-500',
  link: 'bg-blue-500',
  sov: 'bg-green-500',
  accuracy: 'bg-yellow-500'
}

const LABELS = {
  position: 'Position',
  link: 'Link Rank',
  sov: 'Share of Voice',
  accuracy: 'Accuracy'
}

const TITLE = 'Citation quality'

export function ScoreBreakdown({ score, breakdown, compact = false }: ScoreBreakdownProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (compact) {
    return (
      <div className="relative inline-block">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="group inline-flex items-center gap-1 text-sm font-semibold text-gray-900 dark:text-white hover:text-indigo-600"
          title="View score breakdown"
        >
          <span>{score.toFixed(1)}</span>
          <Info className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100" />
        </button>

        {isExpanded && (
          <div className="absolute right-0 z-20 mt-2 min-w-[220px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-lg">
            <div className="space-y-2.5">
              {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((key) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <span className={`h-2 w-2 rounded-full ${COLORS[key]}`} />
                    {LABELS[key]} ({(WEIGHTS[key] * 100).toFixed(0)}%)
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {breakdown[key].toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between text-sm"
      >
        <span className="font-semibold text-gray-900 dark:text-white">
          {TITLE}: {score.toFixed(1)}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          {isExpanded ? 'Hide' : 'Show'} breakdown
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
          {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((key) => (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <span className={`h-2 w-2 rounded-full ${COLORS[key]}`} />
                  {LABELS[key]} ({(WEIGHTS[key] * 100).toFixed(0)}%)
                </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {breakdown[key].toFixed(0)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className={`h-full ${COLORS[key]} transition-all`}
                  style={{ width: `${Math.min(100, breakdown[key])}%` }}
                />
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-400">Weighted Total</span>
              <span className="font-bold text-gray-900 dark:text-white">{score.toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Compact inline score with color-coded ring
export function ScoreRing({ 
  score, 
  size = 60 
}: { 
  score: number
  size?: number 
}) {
  const strokeWidth = size * 0.1
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = (score / 100) * circumference

  const getColor = () => {
    if (score >= 75) return 'stroke-green-500'
    if (score >= 50) return 'stroke-blue-500'
    if (score >= 25) return 'stroke-yellow-500'
    return 'stroke-red-500'
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="rotate-[-90deg]"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-gray-200 dark:stroke-gray-700"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          className={getColor()}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {Math.round(score)}
        </span>
      </div>
    </div>
  )
}









