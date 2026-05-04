'use client'

import { Sparkles, Globe, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react'

interface SurfaceScore {
  overallScore: number
  visibilityPct: number
  avgLlmRank: number | null
}

interface ModelComparisonCardProps {
  primary: SurfaceScore | null
  primaryLabel: string
  secondary: SurfaceScore | null
  secondaryLabel: string
  onViewDetails?: () => void
}

export function ModelComparisonCard({
  primary,
  primaryLabel,
  secondary,
  secondaryLabel,
  onViewDetails,
}: ModelComparisonCardProps) {
  if (!primary && !secondary) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-center">
        <p className="text-sm text-gray-500">
          Run audits on at least two surfaces to see comparison insights
        </p>
      </div>
    )
  }

  const scoreDiff = primary && secondary ? secondary.overallScore - primary.overallScore : 0
  const betterModel = scoreDiff > 0 ? 'secondary' : scoreDiff < 0 ? 'primary' : null
  const showImbalanceWarning = Math.abs(scoreDiff) > 10

  // Analyze strengths/weaknesses
  const primaryStrengths = analyzeStrengths(primary)
  const secondaryStrengths = analyzeStrengths(secondary)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
        Model Performance Comparison
      </h3>

      <div className="grid grid-cols-2 gap-6">
        <div className={`space-y-3 ${betterModel === 'primary' ? 'bg-green-50 dark:bg-green-900/10 -m-3 p-3 rounded-lg' : ''}`}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-green-500" />
            <span className="font-medium text-gray-900 dark:text-white">{primaryLabel}</span>
            {betterModel === 'primary' && (
              <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
            )}
            {betterModel === 'secondary' && showImbalanceWarning && (
              <AlertCircle className="w-4 h-4 text-amber-500 ml-auto" />
            )}
          </div>

          {primary ? (
            <>
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">
                  {Math.round(primary.overallScore)}
                </div>
                <div className="text-xs text-gray-500">Score</div>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-600">Visibility</span>
                  <span className="font-medium">{Math.round(primary.visibilityPct)}%</span>
                </div>
                {primary.avgLlmRank && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avg Rank</span>
                    <span className="font-medium">{primary.avgLlmRank.toFixed(1)}</span>
                  </div>
                )}
              </div>

              {primaryStrengths && (
                <div className="text-xs">
                  <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {primaryStrengths.type}:
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">
                    {primaryStrengths.message}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-500">No data yet</div>
          )}
        </div>

        <div className={`space-y-3 ${betterModel === 'secondary' ? 'bg-purple-50 dark:bg-purple-900/10 -m-3 p-3 rounded-lg' : ''}`}>
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-purple-500" />
            <span className="font-medium text-gray-900 dark:text-white">{secondaryLabel}</span>
            {betterModel === 'secondary' && (
              <CheckCircle2 className="w-4 h-4 text-purple-500 ml-auto" />
            )}
            {betterModel === 'primary' && showImbalanceWarning && (
              <AlertCircle className="w-4 h-4 text-amber-500 ml-auto" />
            )}
          </div>

          {secondary ? (
            <>
              <div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">
                  {Math.round(secondary.overallScore)}
                </div>
                <div className="text-xs text-gray-500">Score</div>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-600">Visibility</span>
                  <span className="font-medium">{Math.round(secondary.visibilityPct)}%</span>
                </div>
                {secondary.avgLlmRank && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Avg Rank</span>
                    <span className="font-medium">{secondary.avgLlmRank.toFixed(1)}</span>
                  </div>
                )}
              </div>

              {secondaryStrengths && (
                <div className="text-xs">
                  <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {secondaryStrengths.type}:
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">
                    {secondaryStrengths.message}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-500">No data yet</div>
          )}
        </div>
      </div>

      {/* Recommendation */}
      {primary && secondary && showImbalanceWarning && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <span className="text-gray-700 dark:text-gray-300">
                {betterModel === 'secondary'
                  ? `${secondaryLabel} is outperforming ${primaryLabel} by ${Math.abs(scoreDiff).toFixed(0)} points.`
                  : `${primaryLabel} is outperforming ${secondaryLabel} by ${Math.abs(scoreDiff).toFixed(0)} points.`
                }
              </span>
              {onViewDetails && (
                <button
                  onClick={onViewDetails}
                  className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium mt-2"
                >
                  Balance Optimization
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function analyzeStrengths(
  score: SurfaceScore | null
): { type: 'Strengths' | 'Needs Work'; message: string } | null {
  if (!score) return null

  if (score.visibilityPct === 100 && score.overallScore >= 80) {
    return {
      type: 'Strengths',
      message: 'Excellent across all query types'
    }
  }

  if (score.visibilityPct < 70) {
    return {
      type: 'Needs Work',
      message: 'Low visibility - add specific queries'
    }
  }

  if (score.avgLlmRank && score.avgLlmRank > 2) {
    return {
      type: 'Needs Work',
      message: 'Rankings need improvement'
    }
  }

  return {
    type: 'Strengths',
    message: 'Solid performance overall'
  }
}
