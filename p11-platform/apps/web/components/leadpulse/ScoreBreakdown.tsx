'use client'

import { useState } from 'react'
import {
  Activity,
  Clock,
  Share2,
  FileCheck,
  Brain,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Info,
  RefreshCw,
} from 'lucide-react'

interface ScoreFactor {
  factor: string
  impact: string
  type: 'positive' | 'negative' | 'neutral'
}

interface ScoreBreakdownProps {
  totalScore: number
  engagementScore: number
  timingScore: number
  sourceScore: number
  completenessScore: number
  behaviorScore: number
  factors: ScoreFactor[]
  scoredAt: string
  modelVersion: string
  onRescore?: () => void
  isRescoring?: boolean
}

const SCORE_COMPONENTS = [
  {
    key: 'engagement',
    label: 'Engagement',
    icon: Activity,
    description: 'Recorded event weights plus user messages; capped at 30 points',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  {
    key: 'timing',
    label: 'Timing',
    icon: Clock,
    description: 'Time since the lead was created; capped at 25 points',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  {
    key: 'source',
    label: 'Source Quality',
    icon: Share2,
    description: 'Fixed source weights; capped at 20 points, not learned conversion rates',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  {
    key: 'completeness',
    label: 'Profile Completeness',
    icon: FileCheck,
    description: 'Presence of email, phone, first name and move-in date; up to 15 points',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
  },
  {
    key: 'behavior',
    label: 'Behavior Signals',
    icon: Brain,
    description: '10 points for a booked lead status or completed tour',
    color: 'text-rose-600',
    bgColor: 'bg-rose-100',
  },
]

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-500`}
        style={{ width: `${score}%` }}
      />
    </div>
  )
}

export function ScoreBreakdown({
  totalScore,
  engagementScore,
  timingScore,
  sourceScore,
  completenessScore,
  behaviorScore,
  factors,
  scoredAt,
  modelVersion,
  onRescore,
  isRescoring,
}: ScoreBreakdownProps) {
  const [expanded, setExpanded] = useState(false)

  const scores: Record<string, number> = {
    engagement: engagementScore,
    timing: timingScore,
    source: sourceScore,
    completeness: completenessScore,
    behavior: behaviorScore,
  }

  const positiveFactors = factors.filter(f => f.type === 'positive')
  const negativeFactors = factors.filter(f => f.type === 'negative')

  const timeAgo = formatTimeAgo(new Date(scoredAt))

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Lead Score Breakdown · {totalScore} / 100
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Scored {timeAgo} • Rules {modelVersion}
            </p>
          </div>
          {onRescore && (
            <button
              onClick={onRescore}
              disabled={isRescoring}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRescoring ? 'animate-spin' : ''}`} />
              Rescore
            </button>
          )}
        </div>
      </div>

      {/* Score Components */}
      <div className="p-4 space-y-4">
        {SCORE_COMPONENTS.map(({ key, label, icon: Icon, description, color, bgColor }) => (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${bgColor}`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {label}
                  </span>
                  <button
                    className="ml-1.5 text-gray-400 hover:text-gray-600"
                    title={description}
                  >
                    <Info className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white">
                {scores[key]} / {{ engagement: 30, timing: 25, source: 20, completeness: 15, behavior: 10 }[key]}
              </span>
            </div>
            <ScoreBar
              score={scores[key] / ({ engagement: 30, timing: 25, source: 20, completeness: 15, behavior: 10 }[key] || 100) * 100}
              color={color.replace('text-', 'bg-')}
            />
          </div>
        ))}
      </div>

      {/* Factors Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">Score Factors</span>
          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
            +{positiveFactors.length}
          </span>
          {negativeFactors.length > 0 && (
            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded">
              -{negativeFactors.length}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {/* Expanded Factors */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {positiveFactors.length > 0 && (
            <div className="p-4">
              <h4 className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                Positive Factors
              </h4>
              <ul className="space-y-2">
                {positiveFactors.map((factor, idx) => (
                  <li key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{factor.factor}</span>
                    <span className="text-green-600 font-medium">{factor.impact}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {negativeFactors.length > 0 && (
            <div className="p-4">
              <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5" />
                Negative Factors
              </h4>
              <ul className="space-y-2">
                {negativeFactors.map((factor, idx) => (
                  <li key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{factor.factor}</span>
                    <span className="text-red-600 font-medium">{factor.impact}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {factors.filter(f => f.type === 'neutral').length > 0 && (
            <div className="p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Neutral Factors
              </h4>
              <ul className="space-y-2">
                {factors.filter(f => f.type === 'neutral').map((factor, idx) => (
                  <li key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{factor.factor}</span>
                    <span className="text-gray-500">{factor.impact}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

export default ScoreBreakdown



























