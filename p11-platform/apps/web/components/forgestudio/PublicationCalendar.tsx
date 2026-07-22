'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'

interface PublicationRow {
  id: string
  platform: string
  status: string
  scheduled_for: string
  timezone: string
  attempt_count: number
  max_attempts: number
  last_error: string | null
  remote_post_url: string | null
  published_at: string | null
  social_content_variants: {
    caption: string
    content_format: string
  } | null
  social_connections: {
    account_name: string
    account_username: string | null
  } | null
}

interface PublicationCalendarProps {
  propertyId: string
  refreshTrigger?: number
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700' },
  queued: { label: 'Queued', className: 'bg-blue-100 text-blue-700' },
  publishing: { label: 'Publishing…', className: 'bg-amber-100 text-amber-700' },
  reconciling: { label: 'Verifying…', className: 'bg-amber-100 text-amber-700' },
  published: { label: 'Published', className: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500' },
}

export function PublicationCalendar({ propertyId, refreshTrigger }: PublicationCalendarProps) {
  const [publications, setPublications] = useState<PublicationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rescheduleId, setRescheduleId] = useState<string | null>(null)
  const [rescheduleAt, setRescheduleAt] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/forgestudio/publications?propertyId=${propertyId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load publications')
      setPublications(data.publications || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load publications')
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    load()
  }, [load, refreshTrigger])

  const patchPublication = async (publicationId: string, body: Record<string, unknown>) => {
    setBusyId(publicationId)
    setError(null)
    try {
      const res = await fetch(`/api/forgestudio/publications/${publicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      setRescheduleId(null)
      setRescheduleAt('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const upcoming = publications.filter((publication) =>
    ['scheduled', 'queued', 'publishing', 'reconciling'].includes(publication.status)
  )
  const history = publications
    .filter((publication) => ['published', 'failed', 'cancelled'].includes(publication.status))
    .sort((a, b) => (a.scheduled_for < b.scheduled_for ? 1 : -1))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    )
  }

  const renderRow = (publication: PublicationRow, editable: boolean) => {
    const status = STATUS_STYLES[publication.status] ?? {
      label: publication.status,
      className: 'bg-slate-100 text-slate-600',
    }
    const isBusy = busyId === publication.id
    return (
      <div
        key={publication.id}
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-900 dark:text-white capitalize">
                {publication.platform}
              </span>
              <span className="text-xs text-slate-500">
                {publication.social_connections?.account_username ||
                  publication.social_connections?.account_name}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${status.className}`}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 truncate mt-1">
              {publication.social_content_variants?.caption}
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(publication.scheduled_for).toLocaleString()} ({publication.timezone})
              </span>
              {publication.attempt_count > 0 && (
                <span>
                  attempt {publication.attempt_count}/{publication.max_attempts}
                </span>
              )}
              {publication.remote_post_url && (
                <a
                  href={publication.remote_post_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-violet-600 hover:text-violet-700"
                >
                  View post <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            {publication.last_error && publication.status === 'failed' && (
              <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {publication.last_error}
              </p>
            )}
          </div>

          {editable && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => {
                  setRescheduleId(rescheduleId === publication.id ? null : publication.id)
                  setRescheduleAt('')
                }}
                disabled={isBusy}
                className="px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Reschedule
              </button>
              <button
                onClick={() => {
                  if (confirm('Cancel this scheduled publication?')) {
                    patchPublication(publication.id, { action: 'cancel' })
                  }
                }}
                disabled={isBusy}
                className="px-2.5 py-1.5 text-xs text-red-600 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Cancel'}
              </button>
            </div>
          )}
        </div>

        {rescheduleId === publication.id && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <input
              type="datetime-local"
              value={rescheduleAt}
              onChange={(event) => setRescheduleAt(event.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <button
              onClick={() =>
                rescheduleAt &&
                patchPublication(publication.id, {
                  action: 'reschedule',
                  scheduledFor: new Date(rescheduleAt).toISOString(),
                })
              }
              disabled={!rescheduleAt || isBusy}
              className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Publication schedule
          </h3>
          <p className="text-sm text-slate-500">
            Every entry is an approved revision headed to one account. Cancel or move anything
            before it starts publishing.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4" /> Upcoming ({upcoming.length})
        </h4>
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-6 text-center">
            Nothing scheduled. Approve a revision in the Campaigns tab, then schedule it here.
          </p>
        ) : (
          <div className="space-y-3">{upcoming.map((publication) => renderRow(publication, true))}</div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4" /> History
          </h4>
          <div className="space-y-3">
            {history.slice(0, 20).map((publication) => renderRow(publication, false))}
          </div>
        </div>
      )}
    </div>
  )
}
