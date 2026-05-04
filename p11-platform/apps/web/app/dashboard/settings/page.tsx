'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Settings, 
  Building2, 
  Bell, 
  Key, 
  Palette,
  FileText,
  Save,
  Check,
  Loader2,
  AlertCircle,
  RefreshCw,
  Database,
  ChevronRight,
  CheckCircle2
} from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { ScheduledReportsList } from '@/components/settings/ScheduledReportsList'
import { AdAccountConnections } from '@/components/settings/AdAccountConnections'

type SettingsSection = 'organization' | 'notifications' | 'reports' | 'integrations' | 'appearance'

type OrgSettings = {
  timezone: string
  notifications: {
    new_leads: boolean
    ai_handoff: boolean
    daily_summary: boolean
    weekly_report: boolean
  }
}

type UserPreferences = {
  theme: 'light' | 'dark' | 'system'
  accent_color: 'indigo' | 'purple' | 'blue' | 'emerald'
}

type SettingsData = {
  organization: {
    id: string
    name: string
    subscription_tier: string
    settings: OrgSettings
  }
  preferences: UserPreferences
}

const DEFAULT_ORG_SETTINGS: OrgSettings = {
  timezone: 'America/Los_Angeles',
  notifications: {
    new_leads: true,
    ai_handoff: true,
    daily_summary: true,
    weekly_report: true,
  },
}

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  accent_color: 'indigo',
}

export default function SettingsPage() {
  const { currentProperty } = usePropertyContext()
  const supabase = createClient()
  const [activeSection, setActiveSection] = useState<SettingsSection>('organization')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [crmIntegration, setCrmIntegration] = useState<{ platform: string; status: string } | null>(null)
  
  // Form state
  const [orgName, setOrgName] = useState('')
  const [timezone, setTimezone] = useState('America/Los_Angeles')
  const [notifications, setNotifications] = useState(DEFAULT_ORG_SETTINGS.notifications)
  const [theme, setTheme] = useState<UserPreferences['theme']>('light')
  const [accentColor, setAccentColor] = useState<UserPreferences['accent_color']>('indigo')
  const [subscriptionTier, setSubscriptionTier] = useState('starter')

  // Fetch settings on mount
  const fetchSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/settings')
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load settings')
      }
      
      // Populate form with fetched data
      const settings = data as SettingsData
      setOrgName(settings.organization.name || '')
      setSubscriptionTier(settings.organization.subscription_tier || 'starter')
      setTimezone(settings.organization.settings?.timezone || 'America/Los_Angeles')
      setNotifications({
        ...DEFAULT_ORG_SETTINGS.notifications,
        ...settings.organization.settings?.notifications,
      })
      setTheme(settings.preferences?.theme || 'light')
      setAccentColor(settings.preferences?.accent_color || 'indigo')

      // Check for CRM integration
      if (currentProperty?.id) {
        const { data: crmData } = await supabase
          .from('integration_credentials')
          .select('platform, status')
          .eq('property_id', currentProperty.id)
          .in('platform', ['yardi', 'realpage', 'salesforce', 'hubspot', 'lasso'])
          .eq('status', 'connected')
          .single()
        
        setCrmIntegration(
          crmData
            ? {
                platform: crmData.platform,
                status: crmData.status || 'unknown',
              }
            : null
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [currentProperty?.id, supabase])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization: {
            name: orgName,
            settings: {
              timezone,
              notifications,
            },
          },
          preferences: {
            theme,
            accent_color: accentColor,
          },
        }),
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save settings')
      }
      
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const sections = [
    { id: 'organization' as const, label: 'Organization', icon: Building2 },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'reports' as const, label: 'Scheduled Reports', icon: FileText },
    { id: 'integrations' as const, label: 'Integrations', icon: Key },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette },
  ]

  const timezones = [
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
  ]

  const themes = ['Light', 'Dark', 'System'] as const
  const accentColors = [
    { color: 'bg-indigo-500', name: 'indigo' as const },
    { color: 'bg-purple-500', name: 'purple' as const },
    { color: 'bg-blue-500', name: 'blue' as const },
    { color: 'bg-emerald-500', name: 'emerald' as const },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-indigo-500 mx-auto mb-3" />
          <p className="text-slate-500">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="text-indigo-500" size={28} />
            Settings
          </h1>
          <p className="text-slate-500 mt-1">
            Manage your account and organization preferences
          </p>
        </div>
        <button
          onClick={fetchSettings}
          disabled={loading}
          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <p className="text-red-800 font-medium">Error</p>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <div className="lg:w-56 flex-shrink-0">
          <nav className="bg-white rounded-xl border border-slate-200 p-2 space-y-1">
            {sections.map(section => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                    activeSection === section.id
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={18} />
                  <span className="font-medium">{section.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="bg-white rounded-xl border border-slate-200">
            {/* Organization Settings */}
            {activeSection === 'organization' && (
              <div>
                <div className="px-6 py-4 border-b border-slate-200">
                  <h2 className="font-semibold text-slate-900">Organization Settings</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Manage your organization details and preferences
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Organization Name
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full max-w-md px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Default Timezone
                    </label>
                    <select 
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full max-w-md px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500"
                    >
                      {timezones.map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Subscription Plan
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-medium capitalize">
                        {subscriptionTier}
                      </span>
                      <button className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                        Upgrade Plan →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Notifications Settings */}
            {activeSection === 'notifications' && (
              <div>
                <div className="px-6 py-4 border-b border-slate-200">
                  <h2 className="font-semibold text-slate-900">Notification Preferences</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Control how and when you receive notifications
                  </p>
                </div>
                <div className="p-6 space-y-4">
                  {[
                    { id: 'new_leads' as const, label: 'New Leads', description: 'Get notified when new leads come in' },
                    { id: 'ai_handoff' as const, label: 'AI Handoff Requests', description: 'When AI needs human assistance' },
                    { id: 'daily_summary' as const, label: 'Daily Summary', description: 'Receive daily performance reports' },
                    { id: 'weekly_report' as const, label: 'Weekly Report', description: 'Weekly analytics and insights' },
                  ].map(item => (
                    <div key={item.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.label}</p>
                        <p className="text-sm text-slate-500">{item.description}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={notifications[item.id]}
                          onChange={(e) => setNotifications(prev => ({
                            ...prev,
                            [item.id]: e.target.checked,
                          }))}
                          className="sr-only peer" 
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500/40 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scheduled Reports */}
            {activeSection === 'reports' && (
              <div>
                <div className="px-6 py-4 border-b border-slate-200">
                  <h2 className="font-semibold text-slate-900">Scheduled Reports</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Manage your automated email reports
                  </p>
                </div>
                <div className="p-6">
                  <ScheduledReportsList />
                </div>
              </div>
            )}

            {/* Integrations Settings */}
            {activeSection === 'integrations' && (
              <div>
                <div className="px-6 py-4 border-b border-slate-200">
                  <h2 className="font-semibold text-slate-900">Ad Platform Integrations</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Link your ad accounts to properties for unified analytics
                  </p>
                </div>
                <div className="p-6">
                  <AdAccountConnections />
                  
                  {/* CRM Integration */}
                  <div className="mt-8 pt-6 border-t border-slate-200">
                    <h4 className="text-sm font-medium text-slate-700 mb-4">CRM Integration</h4>
                    <Link href="/dashboard/settings/crm">
                      <div className={`flex items-center justify-between py-3 px-4 rounded-lg transition-all cursor-pointer group border ${
                        crmIntegration 
                          ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-gradient-to-r from-teal-50 to-emerald-50 border-teal-200 hover:from-teal-100 hover:to-emerald-100'
                      }`}>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${
                            crmIntegration 
                              ? 'bg-emerald-500 text-white'
                              : 'bg-teal-500 text-white'
                          }`}>
                            <Database size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-slate-900">
                                {crmIntegration ? 'CRM Connected' : 'CRM Sync Setup'}
                              </p>
                              {crmIntegration && (
                                <CheckCircle2 className="text-emerald-600" size={16} />
                              )}
                            </div>
                            <p className="text-sm text-slate-600">
                              {crmIntegration 
                                ? `${crmIntegration.platform.charAt(0).toUpperCase() + crmIntegration.platform.slice(1)} • Active`
                                : 'Connect Yardi, RealPage, Salesforce, or HubSpot'
                              }
                            </p>
                          </div>
                        </div>
                        <ChevronRight className={`group-hover:translate-x-1 transition-transform ${
                          crmIntegration ? 'text-emerald-600' : 'text-teal-600'
                        }`} size={20} />
                      </div>
                    </Link>
                  </div>
                  
                  {/* Other Integrations - Coming Soon */}
                  <div className="mt-6">
                    <h4 className="text-sm font-medium text-slate-700 mb-4">Other Integrations</h4>
                    <div className="space-y-3">
                      {[
                        { id: 'ga4', label: 'Google Analytics 4', description: 'Website analytics' },
                        { id: 'linkedin', label: 'LinkedIn Ads', description: 'Professional advertising' },
                      ].map(item => (
                        <div key={item.id} className="flex items-center justify-between py-2">
                          <div>
                            <p className="font-medium text-slate-900">{item.label}</p>
                            <p className="text-sm text-slate-500">{item.description}</p>
                          </div>
                          <span className="px-3 py-1 text-xs bg-slate-100 text-slate-500 rounded-full">
                            Coming Soon
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <p className="text-sm text-indigo-700">
                        💡 <strong>Tip:</strong> Google Ads and Meta Ads are now supported! Switch between tabs above to link accounts.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Appearance Settings */}
            {activeSection === 'appearance' && (
              <div>
                <div className="px-6 py-4 border-b border-slate-200">
                  <h2 className="font-semibold text-slate-900">Appearance</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Customize the look and feel of your dashboard
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      Theme
                    </label>
                    <div className="flex gap-3">
                      {themes.map(t => (
                        <button
                          key={t}
                          onClick={() => setTheme(t.toLowerCase() as UserPreferences['theme'])}
                          className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                            theme === t.toLowerCase()
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-3">
                      Accent Color
                    </label>
                    <div className="flex gap-3">
                      {accentColors.map(item => (
                        <button
                          key={item.name}
                          onClick={() => setAccentColor(item.name)}
                          className={`h-8 w-8 rounded-full ${item.color} ring-2 ring-offset-2 transition-all ${
                            accentColor === item.name ? 'ring-indigo-500' : 'ring-transparent'
                          }`}
                          title={item.name.charAt(0).toUpperCase() + item.name.slice(1)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Save Button */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check size={18} />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
