'use client'

import { useState, useEffect } from 'react'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { LeadPulseInsights } from '@/components/leadpulse'
import { LeadScoreBadge, LeadScoreRing } from '@/components/leadpulse/LeadScoreBadge'
import { ScoreBreakdown } from '@/components/leadpulse/ScoreBreakdown'
import {
  Sparkles,
  Users,
  Zap,
  RefreshCw,
  Settings,
  TrendingUp,
  Filter,
  Search,
  ChevronRight,
  Clock,
} from 'lucide-react'

interface Lead {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  source: string
  status: string
  score: number | null
  score_bucket: string | null
  created_at: string
}

interface LeadWithScore extends Lead {
  scoreDetails?: {
    totalScore: number
    engagementScore: number
    timingScore: number
    sourceScore: number
    completenessScore: number
    behaviorScore: number
    factors: { factor: string; impact: string; type: 'positive' | 'negative' | 'neutral' }[]
    workflowOutcomes?: {
      workflowStatus: string | null
      pending: number
      sent: number
      skipped: number
      failed: number
      retried: number
      nextActionAt: string | null
      lastActionAt: string | null
    }
    scoredAt: string
    modelVersion: string
  }
}

export default function LeadPulsePage() {
  const { currentProperty } = usePropertyContext()
  const [leads, setLeads] = useState<LeadWithScore[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState<LeadWithScore | null>(null)
  const [loadingScore, setLoadingScore] = useState(false)
  const [isRescoring, setIsRescoring] = useState(false)
  const [filter, setFilter] = useState<'all' | 'hot' | 'warm' | 'cold' | 'unqualified'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchLeads()
  }, [currentProperty?.id])

  const fetchLeads = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (currentProperty?.id) {
        params.set('propertyId', currentProperty.id)
      }
      params.set('limit', '100')

      const res = await fetch(`/api/leads?${params}`)
      const data = await res.json()

      if (res.ok) {
        setLeads(data.leads || [])
      }
    } catch (err) {
      console.error('Error fetching leads:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchLeadScore = async (lead: Lead) => {
    setSelectedLead({ ...lead })
    setLoadingScore(true)

    try {
      const res = await fetch(`/api/leadpulse/score?leadId=${lead.id}`)
      const data = await res.json()

      if (res.ok && data.score) {
        setSelectedLead({
          ...lead,
          score: data.score.totalScore,
          score_bucket: data.score.scoreBucket,
          scoreDetails: data.score,
        })
      }
    } catch (err) {
      console.error('Error fetching score:', err)
    } finally {
      setLoadingScore(false)
    }
  }

  const rescoreAllLeads = async () => {
    if (!currentProperty?.id) return

    setIsRescoring(true)
    try {
      const res = await fetch('/api/leadpulse/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: currentProperty.id }),
      })
      const data = await res.json()

      if (res.ok) {
        console.log(`Rescored ${data.successful}/${data.processed} leads`)
        fetchLeads()
      }
    } catch (err) {
      console.error('Error rescoring leads:', err)
    } finally {
      setIsRescoring(false)
    }
  }

  const rescoreSelectedLead = async () => {
    if (!selectedLead) return

    setLoadingScore(true)
    try {
      const res = await fetch('/api/leadpulse/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLead.id }),
      })
      const data = await res.json()

      if (res.ok && data.score) {
        setSelectedLead({
          ...selectedLead,
          score: data.score.totalScore,
          score_bucket: data.score.scoreBucket,
          scoreDetails: data.score,
        })
        // Update in list too
        setLeads(leads.map(l =>
          l.id === selectedLead.id
            ? { ...l, score: data.score.totalScore, score_bucket: data.score.scoreBucket }
            : l
        ))
      }
    } catch (err) {
      console.error('Error rescoring lead:', err)
    } finally {
      setLoadingScore(false)
    }
  }

  // Filter and sort leads
  const filteredLeads = leads
    .filter(lead => {
      if (filter !== 'all' && lead.score_bucket !== filter) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          lead.first_name?.toLowerCase().includes(query) ||
          lead.last_name?.toLowerCase().includes(query) ||
          lead.email?.toLowerCase().includes(query)
        )
      }
      return true
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-indigo-500" />
            <span className="text-gray-900 dark:text-gray-100">LeadPulse</span>
          </h1>
          <p className="text-gray-700 dark:text-gray-300 mt-1">
            AI-powered lead scoring and prioritization
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={rescoreAllLeads}
            disabled={isRescoring || !currentProperty?.id}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isRescoring ? 'animate-spin' : ''}`} />
            {isRescoring ? 'Rescoring...' : 'Rescore All'}
          </button>
          <button className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Insights Dashboard */}
      <LeadPulseInsights
        propertyId={currentProperty?.id}
      />

      {/* Lead List with Scores */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {/* List Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-gray-500" />
              Leads by Score
            </h2>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search leads..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 w-64 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700"
                />
              </div>
              {/* Filter */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                {(['all', 'hot', 'warm', 'cold', 'unqualified'] as const).map((bucket) => (
                  <button
                    key={bucket}
                    onClick={() => setFilter(bucket)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      filter === bucket
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {bucket === 'all' ? 'All' : bucket.charAt(0).toUpperCase() + bucket.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Lead Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-4" />
              <p className="text-gray-500">Loading leads...</p>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No leads found</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Score
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Lead
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Source
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Created
                  </th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => fetchLeadScore(lead)}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${
                      selectedLead?.id === lead.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <LeadScoreRing
                        score={lead.score}
                        bucket={lead.score_bucket as 'hot' | 'warm' | 'cold' | 'unqualified' | null}
                        size={50}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {lead.first_name} {lead.last_name}
                        </p>
                        <p className="text-sm text-gray-500">{lead.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {lead.source || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 capitalize">
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(lead.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="w-5 h-5 text-gray-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Score Detail Drawer */}
      {selectedLead && (
        <div className="fixed inset-y-0 right-0 w-96 bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700 overflow-y-auto z-50">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {selectedLead.first_name} {selectedLead.last_name}
              </h3>
              <p className="text-sm text-gray-500">{selectedLead.email}</p>
            </div>
            <button
              onClick={() => setSelectedLead(null)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-6">
            {/* Score Overview */}
            <div className="text-center py-4">
              <LeadScoreRing
                score={selectedLead.score}
                bucket={selectedLead.score_bucket as 'hot' | 'warm' | 'cold' | 'unqualified' | null}
                size={100}
              />
              <div className="mt-3">
                <LeadScoreBadge
                  score={selectedLead.score}
                  bucket={selectedLead.score_bucket as 'hot' | 'warm' | 'cold' | 'unqualified' | null}
                  size="lg"
                />
              </div>
            </div>

            {/* Score Breakdown */}
            {loadingScore ? (
              <div className="text-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                <p className="text-sm text-gray-500 mt-2">Loading score details...</p>
              </div>
            ) : selectedLead.scoreDetails ? (
              <>
                <ScoreBreakdown
                  totalScore={selectedLead.scoreDetails.totalScore}
                  engagementScore={selectedLead.scoreDetails.engagementScore}
                  timingScore={selectedLead.scoreDetails.timingScore}
                  sourceScore={selectedLead.scoreDetails.sourceScore}
                  completenessScore={selectedLead.scoreDetails.completenessScore}
                  behaviorScore={selectedLead.scoreDetails.behaviorScore}
                  factors={selectedLead.scoreDetails.factors}
                  scoredAt={selectedLead.scoreDetails.scoredAt}
                  modelVersion={selectedLead.scoreDetails.modelVersion}
                  onRescore={rescoreSelectedLead}
                  isRescoring={loadingScore}
                />

                {selectedLead.scoreDetails.workflowOutcomes && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Workflow Outcome Context
                    </h4>
                    <p className="mt-1 text-xs text-gray-500">
                      Status: {selectedLead.scoreDetails.workflowOutcomes.workflowStatus || 'none'}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-700">
                        Pending: {selectedLead.scoreDetails.workflowOutcomes.pending}
                      </div>
                      <div className="rounded bg-green-100 px-2 py-1 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                        Sent: {selectedLead.scoreDetails.workflowOutcomes.sent}
                      </div>
                      <div className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-700">
                        Skipped: {selectedLead.scoreDetails.workflowOutcomes.skipped}
                      </div>
                      <div className="rounded bg-red-100 px-2 py-1 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                        Failed: {selectedLead.scoreDetails.workflowOutcomes.failed}
                      </div>
                      <div className="rounded bg-indigo-100 px-2 py-1 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                        Retried: {selectedLead.scoreDetails.workflowOutcomes.retried}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <Zap className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Score details not available</p>
              </div>
            )}

            {/* Quick Actions */}
            <div className="space-y-2">
              <button className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
                Contact Lead
              </button>
              <button className="w-full px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium">
                Schedule Tour
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

