'use client'

/**
 * Market Brief - the default MarketVision surface.
 *
 * Answers, in order: what changed, why it matters for this property, and
 * what to consider next. Every claim shows its evidence (source record,
 * observation time, competitor) and every recommendation shows confidence,
 * freshness, and rank. No fabricated progress or freshness.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'

interface Citation {
  sourceKind: string
  sourceId: string
  captureId: string | null
  competitorId: string | null
  competitorName: string | null
  observedAt: string | null
}

interface BriefChange {
  changeType: string
  competitorName: string
  unitType: string | null
  bedrooms: number | null
  previousValue: number | null
  currentValue: number | null
  changeAmount: number | null
  changePercent: number | null
  observedAt: string
  freshnessDays: number
  citations: Citation[]
}

interface BriefInsight {
  insightType: string
  headline: string
  detail: string
  confidence: number
  limitations: string[]
  citations: Citation[]
}

interface BriefRecommendation {
  id: string
  recommendationType: string
  title: string
  rationale: string
  impact: number
  confidence: number
  freshness: number
  reversibility: number
  rankScore: number
  citations: Citation[]
}

interface Brief {
  schemaVersion: string
  generatedAt: string
  windowDays: number
  coverage: {
    competitorsTotal: number
    competitorsWithRecentObservations: number
    observationsInWindow: number
  }
  changes: BriefChange[]
  positions: Array<{
    bedrooms: number
    subjectRentMin: number | null
    marketAvgRent: number | null
    marketMinRent: number | null
    marketMaxRent: number | null
    competitorsSampled: number
    relativeToMarketPct: number | null
    position: string
  }>
  movements: Array<{
    bedrooms: number
    direction: string
    netChangePct: number | null
    observations: number
    competitorsCovered: number
    windowDays: number
  }>
  insights: BriefInsight[]
  recommendations: BriefRecommendation[]
}

interface ProposalRecord {
  id: string
  actionType: string
  proposalDecisionStatus: string
  executionStatus: string
  proposedAt: string
  outcomes: Array<{
    kpiName: string
    outcomeStatus: string
    deltaValue: number | null
  }>
}

interface MarketBriefViewProps {
  propertyId: string
}

/** Maps a recommendation type to the governed proposal class that reviews it. */
function proposalTypeFor(recommendationType: string): string {
  switch (recommendationType) {
    case 'brandforge_positioning_review':
    case 'siteforge_content_patch':
    case 'forgestudio_messaging_brief':
      return recommendationType
    default:
      // pricing_review, concession_review, operator_task
      return 'operator_pricing_review'
  }
}

const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  brandforge_positioning_review: 'BrandForge positioning review',
  siteforge_content_patch: 'SiteForge content patch draft',
  forgestudio_messaging_brief: 'ForgeStudio messaging brief',
  operator_pricing_review: 'Pricing/concession review task',
}

function EvidenceList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">
        Derived from aggregate data; no single-source citation.
      </p>
    )
  }
  return (
    <ul className="space-y-1">
      {citations.map((citation, idx) => (
        <li key={`${citation.sourceId}-${idx}`} className="text-xs text-gray-600 dark:text-gray-400">
          <span className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">
            {citation.sourceKind}
          </span>{' '}
          {citation.competitorName && <span>{citation.competitorName} · </span>}
          {citation.observedAt && (
            <span>observed {new Date(citation.observedAt).toLocaleString()}</span>
          )}
          {citation.captureId && (
            <span className="text-gray-400"> · capture {citation.captureId.slice(0, 8)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function EvidenceToggle({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        Evidence ({citations.length})
      </button>
      {open && (
        <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
          <EvidenceList citations={citations} />
        </div>
      )}
    </div>
  )
}

export function MarketBriefView({ propertyId }: MarketBriefViewProps) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [proposals, setProposals] = useState<ProposalRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposalStatus, setProposalStatus] = useState<
    Record<string, 'creating' | 'created' | 'duplicate' | 'error'>
  >({})

  const loadBrief = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [briefRes, proposalsRes] = await Promise.all([
        fetch(`/api/marketvision/brief?propertyId=${propertyId}`),
        fetch(`/api/marketvision/proposals?propertyId=${propertyId}`),
      ])
      const data = await briefRes.json()
      if (!briefRes.ok) throw new Error(data.error || 'Failed to load brief')
      setBrief(data.brief)
      if (proposalsRes.ok) {
        const proposalsData = await proposalsRes.json()
        setProposals(proposalsData.proposals || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brief')
    } finally {
      setIsLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    loadBrief()
  }, [loadBrief])

  const createProposal = async (rec: BriefRecommendation) => {
    setProposalStatus((s) => ({ ...s, [rec.id]: 'creating' }))
    try {
      const res = await fetch('/api/marketvision/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          proposalType: proposalTypeFor(rec.recommendationType),
          recommendation: rec,
        }),
      })
      if (res.status === 409) {
        setProposalStatus((s) => ({ ...s, [rec.id]: 'duplicate' }))
        return
      }
      if (!res.ok) throw new Error('Failed to create proposal')
      setProposalStatus((s) => ({ ...s, [rec.id]: 'created' }))
      // Refresh the proposals ledger so the new entry shows immediately.
      const proposalsRes = await fetch(`/api/marketvision/proposals?propertyId=${propertyId}`)
      if (proposalsRes.ok) {
        const proposalsData = await proposalsRes.json()
        setProposals(proposalsData.proposals || [])
      }
    } catch {
      setProposalStatus((s) => ({ ...s, [rec.id]: 'error' }))
    }
  }

  const generateBrief = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/marketvision/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate brief')
      setBrief(data.brief)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setIsGenerating(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading market brief…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-500" />
            Market Brief
          </h2>
          {brief && (
            <p className="text-sm text-gray-500">
              Generated {new Date(brief.generatedAt).toLocaleString()} · last {brief.windowDays}{' '}
              days · {brief.coverage.competitorsWithRecentObservations}/
              {brief.coverage.competitorsTotal} competitors with fresh observations
            </p>
          )}
        </div>
        <button
          onClick={generateBrief}
          disabled={isGenerating}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {brief ? 'Regenerate Brief' : 'Generate Brief'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {!brief && !error && (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <Sparkles className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
          <p className="text-gray-700 dark:text-gray-300 font-medium">No brief yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Generate your first Market Brief to see what changed, why it matters, and what to
            consider next.
          </p>
        </div>
      )}

      {brief && (
        <>
          {/* What changed */}
          <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">What changed?</h3>
            {brief.changes.length === 0 ? (
              <p className="text-sm text-gray-500">
                No competitor changes observed in the last {brief.windowDays} days
                {brief.coverage.observationsInWindow === 0 &&
                  ' — no observations were collected in this window. Refresh sources to keep this brief trustworthy.'}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {brief.changes.slice(0, 10).map((change, idx) => (
                  <li key={idx} className="py-3">
                    <div className="flex items-start gap-3">
                      {change.changeType === 'price_drop' ? (
                        <ArrowDownRight className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      ) : change.changeType === 'price_increase' ? (
                        <ArrowUpRight className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <RefreshCw className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {change.competitorName}
                          {change.unitType ? ` · ${change.unitType}` : ''}
                          {': '}
                          {change.changeType === 'availability_change'
                            ? `availability ${change.previousValue} → ${change.currentValue}`
                            : `$${change.previousValue} → $${change.currentValue}`}
                          {change.changePercent !== null && (
                            <span
                              className={
                                change.changePercent < 0 ? 'text-red-600' : 'text-emerald-600'
                              }
                            >
                              {' '}
                              ({change.changePercent > 0 ? '+' : ''}
                              {change.changePercent}%)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          Observed {new Date(change.observedAt).toLocaleString()} (
                          {change.freshnessDays === 0
                            ? 'today'
                            : `${change.freshnessDays}d ago`}
                          )
                        </p>
                        <EvidenceToggle citations={change.citations} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Why it matters */}
          <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
              Why does it matter?
            </h3>
            {brief.insights.length === 0 ? (
              <p className="text-sm text-gray-500">
                No significant market signals in this window.
              </p>
            ) : (
              <div className="space-y-4">
                {brief.insights.map((insight, idx) => (
                  <div
                    key={idx}
                    className="border border-gray-100 dark:border-gray-700 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-gray-900 dark:text-white text-sm">
                        {insight.headline}
                      </p>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {Math.round(insight.confidence * 100)}% confidence
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {insight.detail}
                    </p>
                    {insight.limitations.length > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                        Limitations: {insight.limitations.join(' ')}
                      </p>
                    )}
                    <EvidenceToggle citations={insight.citations} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* What to consider */}
          <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
              What should we consider?
            </h3>
            {brief.recommendations.length === 0 ? (
              <p className="text-sm text-gray-500">
                No recommendations — nothing in the current evidence calls for action.
              </p>
            ) : (
              <div className="space-y-4">
                {brief.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="border border-gray-100 dark:border-gray-700 rounded-lg p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-gray-900 dark:text-white text-sm flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                        {rec.title}
                      </p>
                      <span className="text-xs font-mono text-gray-500 whitespace-nowrap">
                        rank {rec.rankScore}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {rec.rationale}
                    </p>
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      <span>impact {Math.round(rec.impact * 100)}%</span>
                      <span>confidence {Math.round(rec.confidence * 100)}%</span>
                      <span>freshness {Math.round(rec.freshness * 100)}%</span>
                      <span>reversibility {Math.round(rec.reversibility * 100)}%</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <EvidenceToggle citations={rec.citations} />
                      <div className="flex items-center gap-2">
                        {proposalStatus[rec.id] === 'created' && (
                          <span className="text-xs text-emerald-600">
                            Proposal created — awaiting review
                          </span>
                        )}
                        {proposalStatus[rec.id] === 'duplicate' && (
                          <span className="text-xs text-amber-600">
                            Proposal already exists for this recommendation
                          </span>
                        )}
                        {proposalStatus[rec.id] === 'error' && (
                          <span className="text-xs text-red-600">Failed to create proposal</span>
                        )}
                        {proposalStatus[rec.id] !== 'created' && (
                          <button
                            onClick={() => createProposal(rec)}
                            disabled={proposalStatus[rec.id] === 'creating'}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            title={`Create governed proposal: ${PROPOSAL_TYPE_LABELS[proposalTypeFor(rec.recommendationType)]}`}
                          >
                            {proposalStatus[rec.id] === 'creating' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                            Create proposal
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* What happens next / did it work */}
          {proposals.length > 0 && (
            <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                Proposals &amp; outcomes
              </h3>
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {proposals.map((proposal) => (
                  <li key={proposal.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {PROPOSAL_TYPE_LABELS[proposal.actionType] || proposal.actionType}
                        </p>
                        <p className="text-xs text-gray-500">
                          Proposed {new Date(proposal.proposedAt).toLocaleString()}
                        </p>
                        {proposal.outcomes.length > 0 && (
                          <p className="text-xs mt-1 text-gray-600 dark:text-gray-400">
                            Outcomes:{' '}
                            {proposal.outcomes
                              .map(
                                (outcome) =>
                                  `${outcome.kpiName} ${outcome.outcomeStatus}${
                                    outcome.deltaValue !== null
                                      ? ` (${outcome.deltaValue > 0 ? '+' : ''}${outcome.deltaValue})`
                                      : ''
                                  }`
                              )
                              .join(', ')}
                          </p>
                        )}
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                          proposal.proposalDecisionStatus === 'approved' ||
                          proposal.proposalDecisionStatus === 'modified'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : proposal.proposalDecisionStatus === 'denied'
                              ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        }`}
                      >
                        {proposal.proposalDecisionStatus === 'proposed'
                          ? 'awaiting review'
                          : proposal.proposalDecisionStatus}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-500 mt-3">
                Proposals are reviewed (approve / deny / modify with rationale) before any
                downstream product acts on them. MarketVision never auto-publishes or auto-prices.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
