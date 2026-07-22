'use client'

import { useState, useEffect } from 'react'
import { 
  Settings, Loader2, Save, Bell, Zap, Clock, Palette, 
  Globe, Trash2, RefreshCw, Check, AlertCircle, ExternalLink,
  Link2, Unlink
} from 'lucide-react'
import { PlatformIcon } from './PlatformIcon'

interface Config {
  property_id: string
  google_business_id: string | null
  google_connected: boolean
  yelp_business_id: string | null
  yelp_connected: boolean
  apartments_com_property_url: string | null
  apartments_com_connected: boolean
  facebook_page_id: string | null
  facebook_connected: boolean
  auto_respond_positive: boolean
  auto_respond_threshold: number
  response_delay_minutes: number
  default_tone: string
  property_personality: string | null
  notify_on_negative: boolean
  notify_on_urgent: boolean
  notification_email: string | null
  slack_webhook_url: string | null
  poll_frequency_hours: number
  is_active: boolean
}

interface Connection {
  id: string
  platform: string
  place_id: string | null
  google_maps_url: string | null
  yelp_business_id: string | null
  yelp_business_url: string | null
  connection_type: string
  sync_frequency: string
  is_active: boolean
  last_sync_at: string | null
  total_reviews_synced: number
  error_count: number
  last_error: string | null
  limitation_note: string | null
  created_at: string
  capabilities?: {
    ingest: boolean
    deepLink: boolean
    reply: boolean
    verifyReply: boolean
    deleteReply: boolean
    limitation?: string | null
  }
  deep_link?: string | null
}

interface ReviewFlowConfigProps {
  propertyId: string
}

function CapabilityChip({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      className={`text-[11px] px-1.5 py-0.5 rounded ${
        enabled
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
          : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 line-through'
      }`}
    >
      {label}
    </span>
  )
}

export function ReviewFlowConfig({ propertyId }: ReviewFlowConfigProps) {
  const [config, setConfig] = useState<Config | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [configRes, connectionsRes] = await Promise.all([
          fetch(`/api/reviewflow/config?propertyId=${propertyId}`),
          fetch(`/api/reviewflow/connections?propertyId=${propertyId}`)
        ])
        
        if (configRes.ok) {
          const data = await configRes.json()
          setConfig(data.config)
        }
        
        if (connectionsRes.ok) {
          const data = await connectionsRes.json()
          setConnections(data.connections || [])
        }
      } catch (error) {
        console.error('Error fetching config:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [propertyId])

  const updateConfig = (updates: Partial<Config>) => {
    if (config) {
      setConfig({ ...config, ...updates })
      setHasChanges(true)
    }
  }

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    try {
      const res = await fetch('/api/reviewflow/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, ...config })
      })
      if (res.ok) {
        setHasChanges(false)
      }
    } catch (error) {
      console.error('Error saving config:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleSyncNow = async (platform: string) => {
    setSyncingPlatform(platform)
    setConnectionError(null)
    
    try {
      const res = await fetch('/api/reviewflow/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, platform })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Sync failed')
      }
      
      // Refresh connections to show updated sync time
      const connectionsRes = await fetch(`/api/reviewflow/connections?propertyId=${propertyId}`)
      if (connectionsRes.ok) {
        const data = await connectionsRes.json()
        setConnections(data.connections || [])
      }
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Sync failed')
    } finally {
      setSyncingPlatform(null)
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Are you sure you want to disconnect this platform? Reviews will not be deleted.')) {
      return
    }
    
    try {
      const res = await fetch(`/api/reviewflow/connections?connectionId=${connectionId}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        setConnections(connections.filter(c => c.id !== connectionId))
      }
    } catch (error) {
      console.error('Error disconnecting:', error)
    }
  }

  const formatLastSync = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  const getPlatformDisplayName = (platform: string): string => {
    const names: Record<string, string> = {
      google: 'Google Business',
      yelp: 'Yelp',
      apartments_com: 'Apartments.com',
      facebook: 'Facebook'
    }
    return names[platform] || platform
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-rose-500" />
      </div>
    )
  }

  if (!config) return null

  return (
    <div className="space-y-6">
      {/* Save Bar */}
      {hasChanges && (
        <div className="sticky top-0 z-10 flex items-center justify-between bg-rose-600 text-white px-4 py-3 rounded-lg shadow-lg">
          <span>You have unsaved changes</span>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-1.5 bg-white text-rose-600 rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      )}

      {/* Connection Error */}
      {connectionError && (
        <div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{connectionError}</span>
          <button onClick={() => setConnectionError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <span className="sr-only">Dismiss</span>×
          </button>
        </div>
      )}

      {/* Active Status */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-rose-500 to-pink-600 rounded-xl flex items-center justify-center">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">ReviewFlow AI</h3>
              <p className="text-sm text-slate-500">Automated review management</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.is_active}
              onChange={(e) => updateConfig({ is_active: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-14 h-7 bg-slate-200 peer-focus:ring-4 peer-focus:ring-rose-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-rose-600"></div>
            <span className="ml-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              {config.is_active ? 'Active' : 'Inactive'}
            </span>
          </label>
        </div>
      </div>

      {/* Platform Connections */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-500" />
          Connected Platforms
        </h3>
        
        {connections.length === 0 ? (
          <div className="text-center py-8">
            <Link2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 mb-2">No platforms connected yet</p>
            <p className="text-sm text-slate-400">
              Click &quot;Import Reviews&quot; to connect Google, Yelp, or other platforms.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {connections.map((connection) => (
              <div 
                key={connection.id}
                className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-xl"
              >
                <div className="flex items-center gap-4">
                  <PlatformIcon platform={connection.platform} size={24} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">
                        {getPlatformDisplayName(connection.platform)}
                      </span>
                      {connection.is_active ? (
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Connected</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">Inactive</span>
                      )}
                      <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 rounded-full capitalize">
                        {connection.connection_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                      <span>Last sync: {formatLastSync(connection.last_sync_at)}</span>
                      <span>•</span>
                      <span>{connection.total_reviews_synced || 0} reviews synced</span>
                      {connection.error_count > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-amber-600">{connection.error_count} errors</span>
                        </>
                      )}
                    </div>
                    {connection.capabilities && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <CapabilityChip label="Ingest" enabled={connection.capabilities.ingest} />
                        <CapabilityChip label="Direct reply" enabled={connection.capabilities.reply} />
                        <CapabilityChip label="Verify" enabled={connection.capabilities.verifyReply} />
                        {!connection.capabilities.reply && (
                          <span className="text-xs text-slate-400">manual posting only</span>
                        )}
                      </div>
                    )}
                    {(connection.capabilities?.limitation || connection.limitation_note) && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {connection.capabilities?.limitation || connection.limitation_note}
                      </p>
                    )}
                    {connection.last_error && connection.error_count > 0 && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Last error: {connection.last_error}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSyncNow(connection.platform)}
                    disabled={syncingPlatform === connection.platform}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50"
                  >
                    {syncingPlatform === connection.platform ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Sync Now
                  </button>
                  <button
                    onClick={() => handleDisconnect(connection.id)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                    title="Disconnect"
                  >
                    <Unlink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-Draft Settings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          Auto-Draft Settings
        </h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-300">Auto-draft replies to positive reviews</span>
              <p className="text-sm text-slate-500">
                Automatically prepare draft replies for your approval. Nothing is
                posted publicly without a human decision.
              </p>
            </div>
            <input
              type="checkbox"
              checked={config.auto_respond_positive}
              onChange={(e) => updateConfig({ auto_respond_positive: e.target.checked })}
              className="w-5 h-5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
          </label>

          {config.auto_respond_positive && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Minimum rating for auto-draft
              </label>
              <select
                value={config.auto_respond_threshold}
                onChange={(e) => updateConfig({ auto_respond_threshold: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
              >
                <option value={5}>5 stars only</option>
                <option value={4}>4+ stars</option>
                <option value={3}>3+ stars</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Response Tone */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Palette className="w-5 h-5 text-purple-500" />
          Response Style
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Default Tone</label>
            <select
              value={config.default_tone}
              onChange={(e) => updateConfig({ default_tone: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
            >
              <option value="professional">Professional</option>
              <option value="empathetic">Empathetic</option>
              <option value="friendly">Friendly</option>
              <option value="apologetic">Apologetic</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Property Personality</label>
            <input
              type="text"
              placeholder="e.g., luxury, family-friendly, pet-friendly, urban"
              value={config.property_personality || ''}
              onChange={(e) => updateConfig({ property_personality: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
            />
            <p className="text-xs text-slate-500 mt-1">Helps AI match your property&apos;s brand voice</p>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-rose-500" />
          Notifications
        </h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <span className="font-medium text-slate-700 dark:text-slate-300">Notify on negative reviews</span>
            <input
              type="checkbox"
              checked={config.notify_on_negative}
              onChange={(e) => updateConfig({ notify_on_negative: e.target.checked })}
              className="w-5 h-5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="font-medium text-slate-700 dark:text-slate-300">Notify on urgent reviews</span>
            <input
              type="checkbox"
              checked={config.notify_on_urgent}
              onChange={(e) => updateConfig({ notify_on_urgent: e.target.checked })}
              className="w-5 h-5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
            />
          </label>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Notification Email</label>
            <input
              type="email"
              placeholder="team@property.com"
              value={config.notification_email || ''}
              onChange={(e) => updateConfig({ notification_email: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Slack Webhook URL</label>
            <input
              type="url"
              placeholder="https://hooks.slack.com/..."
              value={config.slack_webhook_url || ''}
              onChange={(e) => updateConfig({ slack_webhook_url: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
            />
          </div>
        </div>
      </div>

      {/* Polling Settings */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-500" />
          Review Polling
        </h3>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Check for new reviews every</label>
          <select
            value={config.poll_frequency_hours}
            onChange={(e) => updateConfig({ poll_frequency_hours: parseInt(e.target.value) })}
            className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
          >
            <option value={1}>1 hour</option>
            <option value={3}>3 hours</option>
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
          </select>
        </div>
      </div>
    </div>
  )
}
