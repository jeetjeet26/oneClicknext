'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, ExternalLink, Award, AlertTriangle } from 'lucide-react'
import { type Surface } from '@/utils/propertyaudit/types'

interface CompetitorMention {
  name: string
  domain: string
  mentionCount: number
  avgRank: number
  citationCount: number
}

interface DomainStats {
  domain: string
  count: number
  isBrandDomain: boolean
}

interface CompetitorInsightsProps {
  propertyId: string
  surface?: Surface | 'both'
}

export function CompetitorInsights({ propertyId, surface = 'both' }: CompetitorInsightsProps) {
  const [competitors, setCompetitors] = useState<CompetitorMention[]>([])
  const [domains, setDomains] = useState<DomainStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (propertyId) {
      fetchInsights()
    }
  }, [propertyId, surface])

  const fetchInsights = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/propertyaudit/insights?propertyId=${propertyId}&surface=${surface}`)
      const data = await res.json()

      if (res.ok) {
        setCompetitors(data.competitors || [])
        setDomains(data.domains || [])
      }
    } catch (error) {
      console.error('Error fetching insights:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    )
  }

  const brandDomains = domains.filter(d => d.isBrandDomain)
  const competitorDomains = domains.filter(d => !d.isBrandDomain).slice(0, 5)
  const totalCitations = domains.reduce((sum, d) => sum + d.count, 0)
  const brandCitations = brandDomains.reduce((sum, d) => sum + d.count, 0)
  const brandSOV = totalCitations > 0 ? (brandCitations / totalCitations) * 100 : 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Brand vs Competitors */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Award className="w-4 h-4 text-indigo-500" />
          Brand Performance
        </h3>

        <div className="space-y-4">
          {/* Brand SOV */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Your Share of Voice</span>
              <span className="text-lg font-bold text-indigo-600">
                {brandSOV.toFixed(1)}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${Math.min(100, brandSOV)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {brandCitations} of {totalCitations} total citations
            </p>
          </div>

          {/* Top Competitors */}
          {competitors.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                Top Competitors Mentioned
              </h4>
              <div className="space-y-2">
                {competitors.slice(0, 3).map((comp, idx) => (
                  <div
                    key={comp.domain}
                    className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-600">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {comp.name}
                        </p>
                        <p className="text-xs text-gray-500">{comp.domain}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{comp.mentionCount}x</p>
                      <p className="text-xs text-gray-500">Avg: #{comp.avgRank.toFixed(1)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3">
            <h4 className="text-xs font-medium text-amber-900 dark:text-amber-100 mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Recommendations
            </h4>
            <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
              {brandSOV < 30 && (
                <li>• Low SOV - Consider adding more branded content and backlinks</li>
              )}
              {competitors.length > 0 && competitors[0].mentionCount > brandCitations && (
                <li>• {competitors[0].name} appears more frequently - analyze their content strategy</li>
              )}
              {brandCitations === 0 && (
                <li>• No brand citations found - improve domain authority and content quality</li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Citation Domains */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-500" />
          Top Cited Domains
        </h3>

        <div className="space-y-2">
          {/* Brand domains first */}
          {brandDomains.map((domain) => (
            <div
              key={domain.domain}
              className="flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 p-3"
            >
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {domain.domain}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">Your brand</p>
                </div>
              </div>
              <span className="text-sm font-bold text-green-600">{domain.count}</span>
            </div>
          ))}

          {/* Competitor domains */}
          {competitorDomains.map((domain, idx) => (
            <div
              key={domain.domain}
              className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-600">
                  {brandDomains.length + idx + 1}
                </span>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {domain.domain}
                </p>
              </div>
              <span className="text-sm font-medium text-gray-600">{domain.count}</span>
            </div>
          ))}

          {domains.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">
              No citation data available yet. Run an audit first.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}









