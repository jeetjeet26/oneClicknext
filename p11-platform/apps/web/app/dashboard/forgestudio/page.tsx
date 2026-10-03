'use client'

import { useState } from 'react'
import {PublicationResults} from '@/components/forgestudio/PublicationResults'
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

type TabId = 'campaigns' | 'assets' | 'schedule' | 'results' | 'connections' | 'settings'

const TAB_IDS: TabId[] = ['campaigns', 'assets', 'schedule', 'results', 'connections', 'settings']

export default function ForgeStudioPage() {
  const { currentProperty } = usePropertyContext()
  const searchParams = useSearchParams()
  const routeKey=searchParams.toString()
  const candidateAsset=searchParams.get('assetId')||''
  const initialAssetId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidateAsset)?candidateAsset:undefined
  const candidateBrief=searchParams.get('briefId')||''
  const initialBriefId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidateBrief)?candidateBrief:undefined
  const requestedTab=searchParams.get('tab')
  const routeTab=TAB_IDS.includes(requestedTab as TabId)?requestedTab as TabId:'campaigns'
  const [selectedTab,setSelectedTab]=useState<{route:string;tab:TabId}|null>(null)
  const activeTab=selectedTab?.route===routeKey?selectedTab.tab:routeTab
  const setActiveTab=(tab:TabId)=>setSelectedTab({route:routeKey,tab})
  const [refreshKey, setRefreshKey] = useState(0)



  const tabs = [
    { id: 'campaigns' as TabId, label: 'Campaigns', icon: Megaphone },
    { id: 'assets' as TabId, label: 'Assets', icon: ImageIcon },
    { id: 'schedule' as TabId, label: 'Schedule', icon: Calendar },
    { id: 'results' as TabId, label: 'Results', icon: ShieldCheck },
    { id: 'connections' as TabId, label: 'Connections', icon: Link2 },
    { id: 'settings' as TabId, label: 'Settings', icon: Settings }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-[#eaf0f2] flex items-center justify-center text-[#476d79]">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              <span className="text-slate-900 dark:text-slate-100">ForgeStudio AI</span>
            </h1>
            <p className="text-slate-700 dark:text-slate-300">
              Create, review and publish content for {currentProperty.name}
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
        <div className="console-panel p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#eef3f4] text-[#567985] rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">Content built around your property</h3>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">
            Channel-specific copy generated only from your property facts, brand system, and assets
          </p>
        </div>

        <div className="console-panel p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#eef3f4] text-[#567985] rounded-lg">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">Review before publishing</h3>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">
            Nothing is scheduled or posted until you approve the exact revision
          </p>
        </div>

        <div className="console-panel p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-[#eef3f4] text-[#567985] rounded-lg">
              <Calendar className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">A clear publishing schedule</h3>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">
            Scheduled posts retain their approved content, saved results, and recovery history
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
        <CampaignWorkspace initialBriefId={initialBriefId} key={`${currentProperty.id}:${initialAssetId??''}`} propertyId={currentProperty.id} initialAssetId={initialAssetId} />
      )}

      {activeTab === 'assets' && (
        <AssetGallery key={currentProperty.id} propertyId={currentProperty.id} />
      )}

      {activeTab === 'schedule' && (
        <PublicationCalendar key={currentProperty.id} propertyId={currentProperty.id} refreshTrigger={refreshKey} />
      )}

      {activeTab === 'results' && <PublicationResults key={currentProperty.id} propertyId={currentProperty.id}/>}

      {activeTab === 'connections' && (
        <SocialConnections key={currentProperty.id} propertyId={currentProperty.id} />
      )}

      {activeTab === 'settings' && (
        <ForgeStudioConfig key={currentProperty.id} propertyId={currentProperty.id} />
      )}
    </div>
  )
}
