'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Globe,
  Loader2,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { ContentRecommendations } from './ContentRecommendations'

interface AuditRoadmapProps {
  propertyId: string
  runId?: string
}

interface SiteFinding {
  id: string
  category: string
  detector: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  occurrences: number
  affected_urls: string[]
  affected_url_count: number
  status: 'todo' | 'in_progress' | 'fixed' | 'wont_fix'
  owner: string | null
  notes: string | null
  first_detected_at: string
  fixed_at: string | null
}

interface CrawlStatus {
  id: string
  status: string
  seed_url: string
  page_cap: number
  pages_crawled: number
  started_at: string | null
  finished_at: string | null
  error_message: string | null
}

interface ProposedChange {
  url: string
  field: string
  current: string | null
  proposed: string
  rationale: string
}

interface LlmRecommendation {
  id: string
  type: string
  priority: 'high' | 'medium' | 'low'
  owner: string | null
  title: string
  narrative: string
  proposed_changes: ProposedChange[]
  grounding: { finding_ids?: string[]; query_evidence?: string[] }
  status: string
  model_used: string | null
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  crawling_indexing: 'Crawling/Indexing',
  canonicals: 'Canonicals',
  titles: 'Titles',
  descriptions: 'Descriptions',
  h1s: 'H1s',
  content: 'Content',
  links: 'Links',
  images: 'Images',
  security: 'Security',
  urls: 'URLs',
  geo_signals: 'GEO Signals',
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  info: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  fixed: 'Fixed',
  wont_fix: "Won't Fix",
}

const OWNER_LABELS: Record<string, string> = {
  web_developer: 'Web Developer',
  content: 'Content',
  seo: 'SEO',
  partnerships: 'Partnerships',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

export function AuditRoadmap({ propertyId, runId }: AuditRoadmapProps) {
  const [findings, setFindings] = useState<SiteFinding[]>([])
  const [crawl, setCrawl] = useState<CrawlStatus | null>(null)
  const [recommendations, setRecommendations] = useState<LlmRecommendation[]>([])
  const [recommendationSource, setRecommendationSource] = useState<'llm_analyst' | 'legacy_rules' | null>(null)
  const [loading, setLoading] = useState(true)
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [findingsRes, recsRes] = await Promise.all([
        fetch(`/api/propertyaudit/findings?propertyId=${propertyId}&includeFixed=true`),
        fetch(`/api/propertyaudit/recommendations?propertyId=${propertyId}${runId ? `&runId=${runId}` : ''}`),
      ])
      if (findingsRes.ok) {
        const data = await findingsRes.json()
        setFindings(data.findings || [])
        setCrawl(data.latestCrawl || null)
      }
      if (recsRes.ok) {
        const data = await recsRes.json()
        setRecommendationSource(data.source || null)
        if (data.source === 'llm_analyst') {
          setRecommendations(data.recommendations || [])
        }
      }
    } catch (error) {
      console.error('Error loading audit roadmap:', error)
    } finally {
      setLoading(false)
    }
  }, [propertyId, runId])

  useEffect(() => {
    if (propertyId) fetchData()
  }, [propertyId, fetchData])

  // Poll while a crawl is active so the roadmap fills in when it finishes.
  useEffect(() => {
    if (!crawl || (crawl.status !== 'running' && crawl.status !== 'queued')) return
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [crawl, fetchData])

  const updateFinding = async (findingId: string, patch: { status?: string; owner?: string | null; notes?: string | null }) => {
    setSavingId(findingId)
    try {
      const res = await fetch('/api/propertyaudit/findings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId, ...patch }),
      })
      if (res.ok) {
        const data = await res.json()
        setFindings(prev => prev.map(f => (f.id === findingId ? { ...f, ...data.finding } : f)))
      }
    } catch (error) {
      console.error('Error updating finding:', error)
    } finally {
      setSavingId(null)
    }
  }

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredFindings = useMemo(() => {
    return findings.filter(finding => {
      if (severityFilter !== 'all' && finding.severity !== severityFilter) return false
      if (categoryFilter !== 'all' && finding.category !== categoryFilter) return false
      if (statusFilter === 'open' && (finding.status === 'fixed' || finding.status === 'wont_fix')) return false
      if (statusFilter !== 'all' && statusFilter !== 'open' && finding.status !== statusFilter) return false
      return true
    })
  }, [findings, severityFilter, categoryFilter, statusFilter])

  const groupedFindings = useMemo(() => {
    const groups = new Map<string, SiteFinding[]>()
    for (const finding of filteredFindings) {
      const list = groups.get(finding.category) || []
      list.push(finding)
      groups.set(finding.category, list)
    }
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
    for (const list of groups.values()) {
      list.sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5))
    }
    return Array.from(groups.entries())
  }, [filteredFindings])

  const openCount = findings.filter(f => f.status === 'todo' || f.status === 'in_progress').length
  const fixedCount = findings.filter(f => f.status === 'fixed').length
  const totalOccurrences = findings
    .filter(f => f.status !== 'fixed' && f.status !== 'wont_fix')
    .reduce((sum, f) => sum + (f.occurrences || 0), 0)

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    )
  }

  const noCrawlYet = !crawl && findings.length === 0

  return (
    <div className="space-y-6">
      {/* Crawl status */}
      {crawl && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-indigo-500" />
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                Full-site technical crawl
                <span className="ml-2 text-xs text-gray-500 break-all">{crawl.seed_url}</span>
              </div>
              <div className="text-xs text-gray-500">
                {crawl.status === 'running' || crawl.status === 'queued' ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {crawl.status === 'queued' ? 'Queued' : `Crawling — ${crawl.pages_crawled} pages so far (cap ${crawl.page_cap})`}
                  </span>
                ) : crawl.status === 'failed' ? (
                  <span className="text-red-500">Failed: {crawl.error_message || 'unknown error'}</span>
                ) : (
                  `Completed ${formatDate(crawl.finished_at)} — ${crawl.pages_crawled} pages audited`
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{openCount}</div>
              <div className="text-xs text-gray-500">Open Issues</div>
            </div>
            <div>
              <div className="text-lg font-bold text-amber-600">{totalOccurrences.toLocaleString()}</div>
              <div className="text-xs text-gray-500">Occurrences</div>
            </div>
            <div>
              <div className="text-lg font-bold text-green-600">{fixedCount}</div>
              <div className="text-xs text-gray-500">Fixed</div>
            </div>
          </div>
        </div>
      )}

      {noCrawlYet && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-center">
          <Wrench className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No site crawl yet</h3>
          <p className="text-sm text-gray-500">
            Run a GEO audit to trigger the full-site technical crawl. Findings and the LLM roadmap will appear here.
          </p>
        </div>
      )}

      {/* LLM roadmap */}
      {recommendationSource === 'llm_analyst' && recommendations.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Strategic Roadmap</h3>
            <span className="text-xs text-gray-500">
              Generated from crawl findings and AI visibility data
              {recommendations[0]?.model_used ? ` (${recommendations[0].model_used})` : ''}
            </span>
          </div>
          {recommendations.map(rec => (
            <div
              key={rec.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${SEVERITY_STYLES[rec.priority] || SEVERITY_STYLES.info}`}>
                    {rec.priority.toUpperCase()}
                  </span>
                  <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                    {rec.type.replace(/_/g, ' ')}
                  </span>
                  {rec.owner && (
                    <span className="px-2 py-0.5 text-xs bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded">
                      {OWNER_LABELS[rec.owner] || rec.owner}
                    </span>
                  )}
                </div>
              </div>
              <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-2">{rec.title}</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 whitespace-pre-line">{rec.narrative}</p>

              {rec.proposed_changes?.length > 0 && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/30 text-xs font-medium text-gray-700 dark:text-gray-300">
                    Proposed changes ({rec.proposed_changes.length})
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rec.proposed_changes.map((change, idx) => (
                      <div key={idx} className="p-3 text-sm">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs text-gray-500 break-all">{change.url}</span>
                          <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded shrink-0">
                            {change.field.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {change.current && (
                          <div className="text-xs text-gray-400 line-through mb-1 break-words">{change.current}</div>
                        )}
                        <div className="flex items-start gap-2">
                          <span className="flex-1 text-gray-900 dark:text-white break-words">{change.proposed}</span>
                          <button
                            onClick={() => handleCopy(change.proposed, `${rec.id}-${idx}`)}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
                            title="Copy proposed copy"
                          >
                            {copiedKey === `${rec.id}-${idx}` ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        {change.rationale && (
                          <div className="mt-1 text-xs text-gray-500 italic">{change.rationale}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(rec.grounding?.query_evidence?.length || 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {rec.grounding.query_evidence!.slice(0, 5).map((prompt, idx) => (
                    <span key={idx} className="px-2 py-0.5 text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded">
                      “{prompt}”
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Technical findings task list */}
      {findings.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-indigo-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Technical Findings</h3>
              <span className="text-xs text-gray-500">Edits for your web developer and content team</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="px-3 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="all">All Categories</option>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                value={severityFilter}
                onChange={e => setSeverityFilter(e.target.value)}
                className="px-3 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="open">Open</option>
                <option value="all">All Statuses</option>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="fixed">Fixed</option>
                <option value="wont_fix">Won&apos;t Fix</option>
              </select>
              <a
                href={`/api/propertyaudit/findings/export?propertyId=${propertyId}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </a>
            </div>
          </div>

          {groupedFindings.map(([category, categoryFindings]) => (
            <div key={category} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900/30 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {CATEGORY_LABELS[category] || category}
                </span>
                <span className="text-xs text-gray-500">{categoryFindings.length} issue(s)</span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {categoryFindings.map(finding => {
                  const isExpanded = expanded.has(finding.id)
                  return (
                    <div key={finding.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <button onClick={() => toggleExpanded(finding.id)} className="mt-1 text-gray-400 hover:text-gray-600">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded ${SEVERITY_STYLES[finding.severity]}`}>
                              {finding.severity}
                            </span>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{finding.title}</span>
                            {finding.status === 'fixed' && (
                              <span className="flex items-center gap-1 text-xs text-green-600">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Fixed {formatDate(finding.fixed_at)}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{finding.description}</p>
                          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                            <span className="font-medium text-amber-600">{finding.occurrences.toLocaleString()} occurrence(s)</span>
                            <span>Discovered {formatDate(finding.first_detected_at)}</span>
                            <div className="flex items-center gap-1.5">
                              <span>Status:</span>
                              <select
                                value={finding.status}
                                disabled={savingId === finding.id}
                                onChange={e => updateFinding(finding.id, { status: e.target.value })}
                                className="px-2 py-0.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              >
                                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span>Owner:</span>
                              <select
                                value={finding.owner || ''}
                                disabled={savingId === finding.id}
                                onChange={e => updateFinding(finding.id, { owner: e.target.value || null })}
                                className="px-2 py-0.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                              >
                                <option value="">Unassigned</option>
                                {Object.entries(OWNER_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg">
                              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                Affected URLs ({finding.affected_url_count.toLocaleString()} total
                                {finding.affected_urls.length < finding.affected_url_count ? `, showing ${finding.affected_urls.length}` : ''})
                              </div>
                              <ul className="space-y-0.5 max-h-48 overflow-y-auto">
                                {finding.affected_urls.map((url, idx) => (
                                  <li key={idx} className="text-xs text-gray-600 dark:text-gray-400 break-all">{url}</li>
                                ))}
                              </ul>
                              <div className="mt-3">
                                <textarea
                                  defaultValue={finding.notes || ''}
                                  placeholder="Notes for your team…"
                                  rows={2}
                                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                  onBlur={e => {
                                    if (e.target.value !== (finding.notes || '')) {
                                      updateFinding(finding.id, { notes: e.target.value })
                                    }
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {filteredFindings.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 text-center text-sm text-gray-500">
              No findings match the selected filters.
            </div>
          )}
        </div>
      )}

      {/* Legacy fallback while the first crawl/analysis hasn't completed */}
      {recommendationSource === 'legacy_rules' && (
        <div className="space-y-3">
          {findings.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900 rounded-lg text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              The LLM-written roadmap is generated after the next full audit run completes. Showing rule-based guidance meanwhile.
            </div>
          )}
          <ContentRecommendations propertyId={propertyId} runId={runId} />
        </div>
      )}
    </div>
  )
}
