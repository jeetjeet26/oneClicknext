'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import {
  AssetGallery,
  ForgeStudioConfig,
  SocialConnections,
  CampaignWorkspace,
  PublicationCalendar
} from '@/components/forgestudio'
import {
  Sparkles,
  Image as ImageIcon,
  Calendar,
  Settings,
  RefreshCw,
  ShieldCheck,
  Link2,
  Megaphone
} from 'lucide-react'

type TabId = 'campaigns' | 'assets' | 'schedule' | 'connections' | 'settings'

const TAB_IDS: TabId[] = ['campaigns', 'assets', 'schedule', 'connections', 'settings']

export default function ForgeStudioPage() {
  const { currentProperty } = usePropertyContext()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabId>('campaigns')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const requestedTab = searchParams.get('tab')
    if (requestedTab && TAB_IDS.includes(requestedTab as TabId)) {
      setActiveTab(requestedTab as TabId)
    }
  }, [searchParams])

  const tabs = [
    { id: 'campaigns' as TabId, label: 'Campaigns', icon: Megaphone },
    { id: 'assets' as TabId, label: 'Assets', icon: ImageIcon },
    { id: 'schedule' as TabId, label: 'Schedule', icon: Calendar },
    { id: 'connections' as TabId, label: 'Connections', icon: Link2 },
    { id: 'settings' as TabId, label: 'Settings', icon: Settings }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 flex items-center justify-center text-white shadow-xl shadow-violet-500/30">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              <span className="text-slate-900 dark:text-slate-900">ForgeStudio AI</span>
            </h1>
            <p className="text-slate-700 dark:text-slate-300">
              Content operating system for {currentProperty.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRefreshKey(prev => prev + 1)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Feature Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl p-5 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">Grounded AI Drafts</h3>
          </div>
          <p className="text-sm text-white/80">
            Channel-specific copy generated only from your property facts, brand system, and assets
          </p>
        </div>

        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl p-5 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">You Approve Everything</h3>
          </div>
          <p className="text-sm text-white/80">
            Nothing is scheduled or posted until you approve the exact revision
          </p>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl p-5 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Calendar className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">Reliable Publishing</h3>
          </div>
          <p className="text-sm text-white/80">
            Scheduled posts publish once, with full attempt history and retry visibility
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <nav className="flex gap-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'campaigns' && (
        <CampaignWorkspace propertyId={currentProperty.id} />
      )}

      {activeTab === 'assets' && (
        <AssetGallery propertyId={currentProperty.id} />
      )}

      {activeTab === 'schedule' && (
        <PublicationCalendar propertyId={currentProperty.id} refreshTrigger={refreshKey} />
      )}

      {activeTab === 'connections' && (
        <SocialConnections propertyId={currentProperty.id} />
      )}

      {activeTab === 'settings' && (
        <ForgeStudioConfig propertyId={currentProperty.id} />
      )}
    </div>
  )
}
