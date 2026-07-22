'use client'

/**
 * Monitoring settings + durable run history.
 * Replaces the old inert Settings button: comp-set policy, cadence, and a
 * ledger-backed history of what actually ran (including partial outcomes).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  RotateCcw,
  Save,
  Settings,
  XCircle,
} from 'lucide-react'

interface MonitoringConfig {
  is_enabled: boolean
  scrape_frequency: string
  radius_miles: number | null
  max_competitors: number | null
  auto_add: boolean | null
  last_run_at: string | null
  error_count: number | null
  last_error: string | null
}

interface RunRecord {
  id: string
  runType: string
  lifecycleStatus: string
  statusReason: string | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  result: string
}

interface MonitoringPanelProps {
  propertyId: string
}

const RUN_TYPE_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  observation_refresh: 'Observation refresh',
  brand_extraction: 'Brand extraction',
  embedding: 'Embedding',
  change_detection: 'Change detection',
  brief_generation: 'Brief generation',
}

/** Maps a durable run type back to the request that re-triggers it. */
function retryRequestFor(runType: string, propertyId: string): { url: string; body: Record<string, unknown> } | null {
  switch (runType) {
    case 'discovery':
      return { url: '/api/marketvision/scrape', body: { action: 'discover', propertyId } }
    case 'observation_refresh':
      return { url: '/api/marketvision/scrape', body: { action: 'refresh', propertyId } }
    case 'brand_extraction':
      return { url: '/api/marketvision/brand-intelligence', body: { propertyId, forceRefresh: false } }
    case 'brief_generation':
      return { url: '/api/marketvision/brief', body: { propertyId } }
    default:
      return null
  }
}

function runBadge(result: string) {
  switch (result) {
    case 'succeeded':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300 px-2 py-0.5 rounded-full">
          <CheckCircle className="w-3 h-3" /> succeeded
        </span>
      )
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full">
          <AlertCircle className="w-3 h-3" /> partial
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded-full">
          <XCircle className="w-3 h-3" /> failed
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">
          <Clock className="w-3 h-3" /> {result}
        </span>
      )
  }
}

export function MonitoringPanel({ propertyId }: MonitoringPanelProps) {
  const [config, setConfig] = useState<MonitoringConfig | null>(null)
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState({
    isEnabled: true,
    scrapeFrequency: 'daily',
    radiusMiles: 3,
    maxCompetitors: 20,
    autoAdd: true,
  })

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [configRes, runsRes] = await Promise.all([
        fetch(`/api/marketvision/config?propertyId=${propertyId}`),
        fetch(`/api/marketvision/runs?propertyId=${propertyId}&limit=20`),
      ])

      if (configRes.ok) {
        const data = await configRes.json()
        setConfig(data.config)
        if (data.config) {
          setForm({
            isEnabled: data.config.is_enabled ?? true,
            scrapeFrequency: data.config.scrape_frequency ?? 'daily',
            radiusMiles: data.config.radius_miles ?? 3,
            maxCompetitors: data.config.max_competitors ?? 20,
            autoAdd: data.config.auto_add ?? true,
          })
        }
      }
      if (runsRes.ok) {
        const data = await runsRes.json()
        setRuns(data.runs || [])
      }
    } finally {
      setIsLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setIsSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/marketvision/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, ...form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save settings')
      setConfig(data.config)
      setMessage({ type: 'success', text: 'Monitoring settings saved' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save settings',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const retryRun = async (run: RunRecord) => {
    const request = retryRequestFor(run.runType, propertyId)
    if (!request) return
    setRetryingRunId(run.id)
    setMessage(null)
    try {
      const res = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      const data = await res.json()
      if (res.status === 409) {
        setMessage({ type: 'error', text: 'A run of this type is already in progress' })
      } else if (!res.ok) {
        throw new Error(data.error || 'Retry failed')
      } else {
        setMessage({ type: 'success', text: 'Retry started — refresh to see the new run' })
      }
      await load()
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Retry failed',
      })
    } finally {
      setRetryingRunId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading monitoring settings…
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Settings */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-500" /> Monitoring settings
        </h3>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isEnabled}
            onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Monitoring enabled for this property
          </span>
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Refresh cadence
          </label>
          <select
            value={form.scrapeFrequency}
            onChange={(e) => setForm((f) => ({ ...f, scrapeFrequency: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="manual">Manual only</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Discovery radius: {form.radiusMiles} miles
          </label>
          <input
            type="range"
            min="1"
            max="10"
            value={form.radiusMiles}
            onChange={(e) => setForm((f) => ({ ...f, radiusMiles: parseInt(e.target.value) }))}
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Maximum competitors tracked
          </label>
          <select
            value={form.maxCompetitors}
            onChange={(e) => setForm((f) => ({ ...f, maxCompetitors: parseInt(e.target.value) }))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
            <option value={50}>50</option>
          </select>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.autoAdd}
            onChange={(e) => setForm((f) => ({ ...f, autoAdd: e.target.checked }))}
            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Automatically add discovered competitors
          </span>
        </label>

        {message && (
          <p
            className={`text-sm ${message.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}
          >
            {message.text}
          </p>
        )}

        <button
          onClick={save}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 text-sm"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save settings
        </button>

        {config?.last_run_at && (
          <p className="text-xs text-gray-500">
            Last source refresh: {new Date(config.last_run_at).toLocaleString()}
            {typeof config.error_count === 'number' && config.error_count > 0 && (
              <span className="text-amber-600"> · {config.error_count} source errors</span>
            )}
          </p>
        )}
      </section>

      {/* Run history */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-500" /> Run history
        </h3>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">
            No durable runs recorded yet. Batch refreshes, discovery, and brief generation will
            appear here with their real outcomes.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {runs.map((run) => (
              <li key={run.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {RUN_TYPE_LABELS[run.runType] || run.runType}
                  </p>
                  <p className="text-xs text-gray-500">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : 'queued'}
                    {run.errorMessage && (
                      <span className="text-red-500"> · {run.errorMessage}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(run.result === 'failed' || run.result === 'partial') &&
                    retryRequestFor(run.runType, propertyId) && (
                      <button
                        onClick={() => retryRun(run)}
                        disabled={retryingRunId !== null}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                        title="Retry this run"
                      >
                        {retryingRunId === run.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3" />
                        )}
                        Retry
                      </button>
                    )}
                  {runBadge(run.result)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
