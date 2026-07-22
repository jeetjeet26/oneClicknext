'use client'

import { useState, useEffect } from 'react'
import {
  Bell,
  TrendingUp,
  TrendingDown,
  Tag,
  Building2,
  CheckCircle,
  X,
  Eye,
  RefreshCw,
  AlertTriangle
} from 'lucide-react'

interface MarketAlert {
  id: string
  propertyId: string
  competitorId: string | null
  competitorName?: string
  alertType: 'price_drop' | 'price_increase' | 'new_special' | 'availability_change' | 'new_competitor' | 'competitor_update'
  severity: 'info' | 'warning' | 'critical'
  title: string
  description: string | null
  data: Record<string, unknown>
  isRead: boolean
  isDismissed: boolean
  createdAt: string
}

interface MarketAlertsListProps {
  propertyId: string | undefined
  limit?: number
  compact?: boolean
  onAlertClick?: (alert: MarketAlert) => void
}

const ALERT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  price_drop: TrendingDown,
  price_increase: TrendingUp,
  new_special: Tag,
  availability_change: Building2,
  new_competitor: Building2,
  competitor_update: Building2
}

const ALERT_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  price_drop: { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-300', icon: 'text-green-500' },
  price_increase: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', icon: 'text-red-500' },
  new_special: { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-300', icon: 'text-purple-500' },
  availability_change: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', icon: 'text-blue-500' },
  new_competitor: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', text: 'text-indigo-700 dark:text-indigo-300', icon: 'text-indigo-500' },
  competitor_update: { bg: 'bg-gray-50 dark:bg-gray-700/50', text: 'text-gray-700 dark:text-gray-300', icon: 'text-gray-500' }
}

const SEVERITY_BADGE: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
}

export function MarketAlertsList({ 
  propertyId, 
  limit = 10,
  compact = false,
  onAlertClick
}: MarketAlertsListProps) {
  const [alerts, setAlerts] = useState<MarketAlert[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (propertyId) {
      fetchAlerts()
    }
  }, [propertyId])

  const fetchAlerts = async () => {
    if (!propertyId) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        propertyId,
        limit: limit.toString()
      })

      const res = await fetch(`/api/marketvision/alerts?${params}`)
      const data = await res.json()

      if (res.ok) {
        setAlerts(data.alerts || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch (err) {
      console.error('Error fetching alerts:', err)
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (alertIds: string[]) => {
    if (!propertyId) return

    try {
      const res = await fetch('/api/marketvision/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertIds, action: 'read', propertyId })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to mark alerts as read')
      }

      setAlerts(alerts.map(a => 
        alertIds.includes(a.id) ? { ...a, isRead: true } : a
      ))
      setUnreadCount(Math.max(0, unreadCount - alertIds.length))
    } catch (err) {
      console.error('Error marking alerts as read:', err)
    }
  }

  const dismissAlert = async (alertId: string) => {
    if (!propertyId) return

    try {
      const res = await fetch('/api/marketvision/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertIds: [alertId], action: 'dismiss', propertyId })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to dismiss alert')
      }

      setAlerts(alerts.filter(a => a.id !== alertId))
      if (!alerts.find(a => a.id === alertId)?.isRead) {
        setUnreadCount(Math.max(0, unreadCount - 1))
      }
    } catch (err) {
      console.error('Error dismissing alert:', err)
    }
  }

  const markAllAsRead = async () => {
    if (!propertyId) return

    try {
      const res = await fetch('/api/marketvision/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, action: 'read_all' })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to mark all alerts as read')
      }

      setAlerts(alerts.map(a => ({ ...a, isRead: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error('Error marking all as read:', err)
    }
  }

  const handleAlertClick = (alert: MarketAlert) => {
    if (!alert.isRead) {
      markAsRead([alert.id])
    }
    onAlertClick?.(alert)
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  if (!propertyId) {
    return null
  }

  if (compact) {
    return (
      <div className="space-y-2">
        {loading ? (
          <div className="p-4 text-center">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-500 mx-auto" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            No recent alerts
          </div>
        ) : (
          alerts.slice(0, 5).map(alert => {
            const Icon = ALERT_ICONS[alert.alertType] || Bell
            const colors = ALERT_COLORS[alert.alertType] || ALERT_COLORS.competitor_update
            
            return (
              <div
                key={alert.id}
                onClick={() => handleAlertClick(alert)}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${colors.bg} ${
                  !alert.isRead ? 'ring-2 ring-indigo-500/20' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`w-4 h-4 mt-0.5 ${colors.icon}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${colors.text}`}>
                      {alert.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatTime(alert.createdAt)}
                    </p>
                  </div>
                  {!alert.isRead && (
                    <div className="w-2 h-2 bg-indigo-500 rounded-full" />
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-indigo-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Market Alerts
          </h3>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={fetchAlerts}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Alerts List */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {loading ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-500 mx-auto mb-4" />
            <p className="text-gray-500">Loading alerts...</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-4" />
            <p className="text-gray-500">No market alerts</p>
            <p className="text-sm text-gray-400 mt-1">
              You'll be notified of competitor price changes and updates
            </p>
          </div>
        ) : (
          alerts.map(alert => {
            const Icon = ALERT_ICONS[alert.alertType] || Bell
            const colors = ALERT_COLORS[alert.alertType] || ALERT_COLORS.competitor_update

            return (
              <div
                key={alert.id}
                className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  !alert.isRead ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${colors.bg}`}>
                    <Icon className={`w-5 h-5 ${colors.icon}`} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {alert.title}
                      </p>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${SEVERITY_BADGE[alert.severity]}`}>
                        {alert.severity}
                      </span>
                      {!alert.isRead && (
                        <span className="w-2 h-2 bg-indigo-500 rounded-full" />
                      )}
                    </div>
                    
                    {alert.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {alert.description}
                      </p>
                    )}

                    {/* Price change details */}
                    {(alert.alertType === 'price_drop' || alert.alertType === 'price_increase') && alert.data && (
                      <div className="flex items-center gap-4 text-sm">
                        {typeof alert.data.old_price === 'number' && (
                          <span className="text-gray-500 line-through">
                            ${(alert.data.old_price as number).toLocaleString()}
                          </span>
                        )}
                        {typeof alert.data.new_price === 'number' && (
                          <span className={`font-medium ${
                            alert.alertType === 'price_drop' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            ${(alert.data.new_price as number).toLocaleString()}
                          </span>
                        )}
                        {typeof alert.data.change_percent === 'number' && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            alert.alertType === 'price_drop' 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {alert.alertType === 'price_drop' ? '↓' : '↑'} 
                            {Math.abs(alert.data.change_percent as number)}%
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs text-gray-400">
                        {formatTime(alert.createdAt)}
                      </span>
                      {alert.competitorName && (
                        <span className="text-xs text-gray-500">
                          {alert.competitorName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {!alert.isRead && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          markAsRead([alert.id])
                        }}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        title="Mark as read"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        dismissAlert(alert.id)
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      title="Dismiss"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

