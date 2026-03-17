'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { 
  RefreshCw, CheckCircle2, XCircle, Link2, SkipForward, 
  TrendingUp, AlertTriangle, ExternalLink, ChevronRight
} from 'lucide-react'

interface SyncStats {
  total_synced: number
  created: number
  linked: number
  failed: number
  skipped: number
  success_rate: number
}

interface SyncHistoryItem {
  id: string
  first_name: string
  last_name: string
  email: string
  crm_sync_status: 'pending' | 'retrying' | 'created' | 'linked' | 'failed' | 'skipped' | 'dead_lettered'
  crm_synced_at: string
  external_crm_id: string | null
  crm_sync_error: string | null
}

interface DeadLetterItem {
  id: string
  first_name: string
  last_name: string
  email: string
  crm_sync_error: string | null
  crm_sync_retry_count: number | null
  crm_dead_lettered_at: string | null
}

interface CRMSyncMonitorProps {
  propertyId: string
  showHistory?: boolean
  compact?: boolean
}

const STATUS_CONFIG = {
  pending: {
    icon: RefreshCw,
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    label: 'Queued',
  },
  retrying: {
    icon: RefreshCw,
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
    label: 'Retry Scheduled',
  },
  created: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    label: 'Created in CRM',
  },
  linked: {
    icon: Link2,
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    label: 'Linked to Existing',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    label: 'Sync Failed',
  },
  skipped: {
    icon: SkipForward,
    color: 'text-slate-400',
    bg: 'bg-slate-400/10',
    label: 'Skipped',
  },
  dead_lettered: {
    icon: AlertTriangle,
    color: 'text-red-300',
    bg: 'bg-red-400/10',
    label: 'Dead Lettered',
  },
}

export function CRMSyncMonitor({ 
  propertyId, 
  showHistory = true,
  compact = false 
}: CRMSyncMonitorProps) {
  const [stats, setStats] = useState<SyncStats | null>(null)
  const [history, setHistory] = useState<SyncHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deadLetters, setDeadLetters] = useState<DeadLetterItem[]>([])
  const [requeueingLeadId, setRequeueingLeadId] = useState<string | null>(null)
  const [replayingLeadId, setReplayingLeadId] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch stats
      const statsResponse = await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync-stats',
          propertyId,
        }),
      })
      const statsData = await statsResponse.json()
      
      if (statsData.success) {
        setStats(statsData.stats)
      }

      // Fetch history
      if (showHistory) {
        const historyResponse = await fetch('/api/integrations/crm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync-history',
            propertyId,
            limit: 10,
          }),
        })
        const historyData = await historyResponse.json()
        
        if (historyData.success) {
          setHistory(historyData.history || [])
        }
      }

      const deadLetterResponse = await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dead-letter-list',
          propertyId,
          limit: 10,
        }),
      })
      const deadLetterData = await deadLetterResponse.json()
      if (deadLetterData.success) {
        setDeadLetters(deadLetterData.leads || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CRM sync data')
    } finally {
      setLoading(false)
    }
  }

  const requeueDeadLetter = async (leadId: string) => {
    setRequeueingLeadId(leadId)
    try {
      await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'requeue-dead-letter',
          propertyId,
          leadIds: [leadId],
        }),
      })
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to requeue dead-letter lead')
    } finally {
      setRequeueingLeadId(null)
    }
  }

  const replayDeadLetterNow = async (leadId: string) => {
    setReplayingLeadId(leadId)
    try {
      await fetch('/api/integrations/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'replay-dead-letter-now',
          propertyId,
          leadId,
        }),
      })
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replay dead-letter lead')
    } finally {
      setReplayingLeadId(null)
    }
  }

  useEffect(() => {
    fetchData()
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [propertyId])

  if (loading && !stats) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6 animate-pulse">
        <div className="h-6 bg-slate-700 rounded w-1/3 mb-4" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-slate-700 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
        <AlertTriangle className="text-red-400" size={20} />
        <span className="text-red-300">{error}</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className={`bg-slate-800/50 rounded-xl border border-slate-700 ${compact ? 'p-4' : 'p-6'}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`font-semibold text-white ${compact ? 'text-sm' : 'text-lg'}`}>
            CRM Sync Status
          </h3>
          <button
            onClick={fetchData}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {stats && (
          <>
            {/* Success Rate */}
            <div className="mb-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Success Rate</span>
                <span className={`font-bold text-lg ${
                  stats.success_rate >= 90 ? 'text-emerald-400' :
                  stats.success_rate >= 70 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {stats.success_rate}%
                </span>
              </div>
              <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${
                    stats.success_rate >= 90 ? 'bg-emerald-500' :
                    stats.success_rate >= 70 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${stats.success_rate}%` }}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-4'} gap-3`}>
              <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp size={14} className="text-slate-400" />
                  <span className="text-xs text-slate-400 uppercase">Total</span>
                </div>
                <span className="text-xl font-bold text-white">{stats.total_synced}</span>
              </div>

              <div className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span className="text-xs text-emerald-400 uppercase">Created</span>
                </div>
                <span className="text-xl font-bold text-emerald-300">{stats.created}</span>
              </div>

              <div className="bg-blue-500/10 rounded-lg p-3 border border-blue-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <Link2 size={14} className="text-blue-400" />
                  <span className="text-xs text-blue-400 uppercase">Linked</span>
                </div>
                <span className="text-xl font-bold text-blue-300">{stats.linked}</span>
              </div>

              <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle size={14} className="text-red-400" />
                  <span className="text-xs text-red-400 uppercase">Failed</span>
                </div>
                <span className="text-xl font-bold text-red-300">{stats.failed}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sync History */}
      {showHistory && history.length > 0 && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
          <h3 className="font-semibold text-white mb-4">Recent Sync Activity</h3>
          
          <div className="space-y-2">
            {history.map((item) => {
              const statusConfig = STATUS_CONFIG[item.crm_sync_status]
              const StatusIcon = statusConfig.icon
              
              return (
                <div 
                  key={item.id}
                  className={`flex items-center gap-3 p-3 rounded-lg ${statusConfig.bg} border border-slate-700`}
                >
                  <StatusIcon size={18} className={statusConfig.color} />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white truncate">
                        {item.first_name} {item.last_name}
                      </span>
                      {item.external_crm_id && (
                        <span className="text-xs text-slate-500 font-mono">
                          {item.external_crm_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">{item.email}</span>
                  </div>
                  
                  <div className="text-right">
                    <span className={`text-xs ${statusConfig.color}`}>
                      {statusConfig.label}
                    </span>
                    <div className="text-xs text-slate-500">
                      {new Date(item.crm_synced_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  
                  {item.crm_sync_error && (
                    <button 
                      className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                      title={item.crm_sync_error}
                    >
                      <AlertTriangle size={16} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {deadLetters.length > 0 && (
        <div className="bg-red-500/5 rounded-xl border border-red-500/30 p-6">
          <h3 className="font-semibold text-white mb-4">Dead-Letter CRM Sync Queue</h3>
          <div className="space-y-2">
            {deadLetters.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
              >
                <AlertTriangle size={18} className="text-red-300" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white truncate">
                      {item.first_name} {item.last_name}
                    </span>
                    <span className="text-xs text-slate-500">
                      retries: {item.crm_sync_retry_count ?? 0}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 truncate">{item.email}</div>
                  {item.crm_sync_error && (
                    <div className="text-xs text-red-200 truncate">{item.crm_sync_error}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => requeueDeadLetter(item.id)}
                    disabled={requeueingLeadId === item.id || replayingLeadId === item.id}
                    className="px-2 py-1 text-xs rounded bg-slate-700 text-slate-100 hover:bg-slate-600 disabled:opacity-50"
                  >
                    {requeueingLeadId === item.id ? 'Requeueing...' : 'Requeue'}
                  </button>
                  <button
                    onClick={() => replayDeadLetterNow(item.id)}
                    disabled={requeueingLeadId === item.id || replayingLeadId === item.id}
                    className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {replayingLeadId === item.id ? 'Replaying...' : 'Replay now'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default CRMSyncMonitor

