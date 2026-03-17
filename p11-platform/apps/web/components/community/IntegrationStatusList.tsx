'use client'

import { useState } from 'react'
import { 
  Link2,
  Check,
  Clock,
  AlertCircle,
  XCircle,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Loader2
} from 'lucide-react'

type Integration = {
  id: string
  property_id: string
  platform: string
  displayName: string
  account_id: string | null
  account_name: string | null
  access_type: string | null
  status: 'pending' | 'requested' | 'connected' | 'verified' | 'expired' | 'error'
  verified_at: string | null
  last_sync_at: string | null
  last_error: string | null
  notes: string | null
  statusSource?: 'verified_state' | 'manual_unverified'
  readiness?: {
    mode: 'verified_state' | 'manual_unverified'
    ready: boolean
    blockers: string[]
    checkedAt: string
  }
}

type Props = {
  integrations: Integration[]
  propertyId: string
  onUpdate?: () => void
}

const PLATFORM_INFO: Record<string, { icon: string; setupUrl?: string; setupGuide?: string }> = {
  google_analytics: { 
    icon: '📊',
    setupGuide: 'Grant admin access to analytics@p11.com in your GA4 property settings'
  },
  google_search_console: { 
    icon: '🔍',
    setupGuide: 'Add analytics@p11.com as an owner in Search Console'
  },
  google_tag_manager: { 
    icon: '🏷️',
    setupGuide: 'Grant admin access to analytics@p11.com in GTM'
  },
  google_ads: { 
    icon: '📢',
    setupGuide: 'Grant admin access to ads@p11.com in Google Ads'
  },
  google_business_profile: { 
    icon: '📍',
    setupGuide: 'Add marketing@p11.com as a manager in Google Business Profile'
  },
  meta_ads: { 
    icon: '👤',
    setupGuide: 'Send partner request to P11 Agency in Meta Business Manager'
  },
  linkedin_ads: { 
    icon: '💼',
    setupGuide: 'Add marketing@p11.com as an account manager in LinkedIn Campaign Manager'
  },
  tiktok_ads: { 
    icon: '🎵',
    setupGuide: 'Invite marketing@p11.com as an admin in TikTok Ads Manager'
  },
  email_marketing: { 
    icon: '📧',
    setupGuide: 'Share API key or invite P11 to your email marketing platform'
  },
  crm: { 
    icon: '🗂️',
    setupGuide: 'Configure CRM integration settings'
  },
  pms: { 
    icon: '🏢',
    setupGuide: 'Connect your Property Management System'
  },
}

const STATUS_CONFIG = {
  pending: { label: 'Not Started', color: 'text-slate-400', bgColor: 'bg-slate-100', icon: Clock },
  requested: { label: 'Awaiting Access', color: 'text-amber-500', bgColor: 'bg-amber-50', icon: Clock },
  connected: { label: 'Connected', color: 'text-blue-500', bgColor: 'bg-blue-50', icon: Link2 },
  verified: { label: 'Verified', color: 'text-emerald-500', bgColor: 'bg-emerald-50', icon: Check },
  expired: { label: 'Expired', color: 'text-amber-500', bgColor: 'bg-amber-50', icon: AlertCircle },
  error: { label: 'Error', color: 'text-red-500', bgColor: 'bg-red-50', icon: XCircle },
}

export function IntegrationStatusList({ integrations, propertyId, onUpdate }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const handleStatusUpdate = async (integrationId: string, newStatus: string) => {
    setUpdatingId(integrationId)
    try {
      const response = await fetch('/api/community/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrationId,
          status: newStatus,
        }),
      })

      if (!response.ok) throw new Error('Failed to update')
      onUpdate?.()
    } catch (error) {
      console.error('Error updating integration:', error)
    } finally {
      setUpdatingId(null)
    }
  }

  // Group by status
  const connected = integrations.filter(i => i.status === 'verified' || i.status === 'connected')
  const pending = integrations.filter(i => i.status === 'pending' || i.status === 'requested')
  const issues = integrations.filter(i => i.status === 'expired' || i.status === 'error')

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-6 py-4 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <Link2 className="h-5 w-5 text-slate-400" />
          Integrations Status
        </h3>
      </div>

      <div className="p-6 space-y-6">
        {/* Connected */}
        {connected.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Check className="h-4 w-4" />
              Connected ({connected.length})
            </h4>
            <div className="space-y-2">
              {connected.map(integration => (
                <IntegrationItem
                  key={integration.id}
                  integration={integration}
                  isExpanded={expandedId === integration.id}
                  onToggle={() => setExpandedId(expandedId === integration.id ? null : integration.id)}
                  onStatusUpdate={handleStatusUpdate}
                  isUpdating={updatingId === integration.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Pending Setup ({pending.length})
            </h4>
            <div className="space-y-2">
              {pending.map(integration => (
                <IntegrationItem
                  key={integration.id}
                  integration={integration}
                  isExpanded={expandedId === integration.id}
                  onToggle={() => setExpandedId(expandedId === integration.id ? null : integration.id)}
                  onStatusUpdate={handleStatusUpdate}
                  isUpdating={updatingId === integration.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Issues */}
        {issues.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Needs Attention ({issues.length})
            </h4>
            <div className="space-y-2">
              {issues.map(integration => (
                <IntegrationItem
                  key={integration.id}
                  integration={integration}
                  isExpanded={expandedId === integration.id}
                  onToggle={() => setExpandedId(expandedId === integration.id ? null : integration.id)}
                  onStatusUpdate={handleStatusUpdate}
                  isUpdating={updatingId === integration.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {integrations.length === 0 && (
          <div className="text-center py-8">
            <Link2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No integrations configured</p>
            <p className="text-slate-400 text-xs mt-1">Integrations will be added during onboarding</p>
          </div>
        )}
      </div>
    </div>
  )
}

function IntegrationItem({
  integration,
  isExpanded,
  onToggle,
  onStatusUpdate,
  isUpdating,
}: {
  integration: Integration
  isExpanded: boolean
  onToggle: () => void
  onStatusUpdate: (id: string, status: string) => void
  isUpdating: boolean
}) {
  const statusConfig = STATUS_CONFIG[integration.status]
  const platformInfo = PLATFORM_INFO[integration.platform] || { icon: '🔗' }
  const StatusIcon = statusConfig.icon

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{platformInfo.icon}</span>
          <div className="text-left">
            <p className="font-medium text-slate-900 text-sm">{integration.displayName}</p>
            {integration.account_name && (
              <p className="text-xs text-slate-500">{integration.account_name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.color}`}>
            <StatusIcon className="h-3 w-3" />
            {statusConfig.label}
          </span>
          {integration.statusSource === 'verified_state' && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-50 text-indigo-600">
              Auto-verified
            </span>
          )}
          <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-slate-100 bg-slate-50">
          {/* Setup Guide */}
          {platformInfo.setupGuide && integration.status !== 'verified' && (
            <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200">
              <p className="text-xs font-medium text-slate-700 mb-1">Setup Instructions:</p>
              <p className="text-xs text-slate-600">{platformInfo.setupGuide}</p>
            </div>
          )}

          {/* Error message */}
          {integration.last_error && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100">
              <p className="text-xs font-medium text-red-700 mb-1">Error:</p>
              <p className="text-xs text-red-600">{integration.last_error}</p>
            </div>
          )}

          {integration.readiness?.mode === 'verified_state' && integration.readiness.blockers.length > 0 && (
            <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
              <p className="text-xs font-medium text-amber-700 mb-1">Verification blockers:</p>
              <p className="text-xs text-amber-600">{integration.readiness.blockers.join(', ')}</p>
            </div>
          )}

          {/* Last sync info */}
          {integration.last_sync_at && (
            <p className="text-xs text-slate-500 mt-3">
              Last synced: {new Date(integration.last_sync_at).toLocaleDateString()}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3">
            {integration.status === 'pending' && (
              <button
                onClick={() => onStatusUpdate(integration.id, 'requested')}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                Request Access
              </button>
            )}
            {integration.status === 'requested' && (
              <button
                onClick={() => onStatusUpdate(integration.id, 'connected')}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
              >
                {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Mark as Connected
              </button>
            )}
            {(integration.status === 'expired' || integration.status === 'error') && (
              <button
                onClick={() => onStatusUpdate(integration.id, 'requested')}
                disabled={isUpdating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
              >
                {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Retry Connection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

