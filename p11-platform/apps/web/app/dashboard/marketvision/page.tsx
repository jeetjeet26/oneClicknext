'use client'

import {useRouter, useSearchParams} from 'next/navigation'
import type {Competitor} from '@/utils/marketvision/records'
import type {CompetitorProfile} from '@/utils/marketvision/profiles'
import { useState, useCallback } from 'react'
import {sendMarketDecision,marketNumber} from '@/utils/marketvision/decision-client'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { 
  MarketSummary, 
  CompetitorList, 
  CompetitorForm, 
  RentComparisonChart,
  PriceTrendChart,
  MarketAlertsList,
  CompetitorDetailDrawer
} from '@/components/marketvision'
import {CompetitorIntakePanel} from '@/components/marketvision/CompetitorIntakePanel'
import { BrandIntelligenceDashboard } from '@/components/marketvision/BrandIntelligenceDashboard'
import { MarketBriefView } from '@/components/marketvision/MarketBriefView'
import { MonitoringPanel } from '@/components/marketvision/MonitoringPanel'
import { SemanticSearchPanel } from '@/components/marketvision/SemanticSearchPanel'
import {
  Eye,
  TrendingUp,
  Building2,
  Bell,
  RefreshCw,
  FileText,
  MessageSquare,
} from 'lucide-react'

type CompetitorUnitInput = {
  unitType: string
  bedrooms: number
  bathrooms: number | null
  sqftMin: string
  sqftMax: string
  rentMin: string
  rentMax: string
  availableCount: string
}

type CompetitorFormData = {
  reason: string
  name: string
  address: string
  websiteUrl: string
  phone: string
  unitsCount: string
  yearBuilt: string
  propertyType: string
  amenities: string[]
  notes: string
  units: CompetitorUnitInput[]
}

type TabId = 'intake' | 'brief' | 'overview' | 'competitors' | 'brand-intel' | 'ask' | 'alerts' | 'monitoring'

export default function MarketVisionPage() {
  const { currentProperty } = usePropertyContext()
  const router=useRouter()
  const searchParams=useSearchParams(),candidateTab=searchParams.get('tab')
  const routeTab=(['intake','brief','overview','competitors','brand-intel','ask','alerts','monitoring']as const).includes(candidateTab as TabId)?candidateTab as TabId:'competitors'
  const activeTab=routeTab
  const setActiveTab=(tab:TabId)=>{const params=new URLSearchParams(searchParams);params.set('tab',tab);params.delete('runId');params.delete('competitorId');params.delete('requestId');params.delete('brandCompetitorId');params.delete('brandRequestId');router.push(`/dashboard/marketvision?${params}`,{scroll:false})}
  const candidateRun=searchParams.get('runId')??'',openRequestId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidateRun)?candidateRun:undefined
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null)
  const [viewingCompetitor, setViewingCompetitor] = useState<CompetitorProfile | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1)
  }, [])

  const competitorValues = (data: CompetitorFormData) => ({name:data.name,address:data.address.trim()||null,website_url:data.websiteUrl.trim()||null,phone:data.phone.trim()||null,units_count:marketNumber(data.unitsCount),year_built:marketNumber(data.yearBuilt),property_type:data.propertyType,amenities:data.amenities,notes:data.notes.trim()||null})
  const handleAddCompetitor = async (data: CompetitorFormData) => {
    if (!currentProperty) return
    await sendMarketDecision('/api/marketvision/competitors','POST', {propertyId:currentProperty.id,action:'create',reason:data.reason,values:competitorValues(data),units:data.units.map(u=>({unit_type:u.unitType,bedrooms:u.bedrooms,bathrooms:marketNumber(u.bathrooms),sqft_min:marketNumber(u.sqftMin),sqft_max:marketNumber(u.sqftMax),rent_min:marketNumber(u.rentMin),rent_max:marketNumber(u.rentMax),available_count:marketNumber(u.availableCount),deposit:null,move_in_specials:null}))})
    handleRefresh()
  }
  const handleEditCompetitor = async (data: CompetitorFormData) => {
    if (!editingCompetitor || !currentProperty) return
    await sendMarketDecision('/api/marketvision/competitors','PUT',{propertyId:currentProperty.id,action:'save',competitorId:editingCompetitor.id,expectedVersion:editingCompetitor.version,reason:data.reason,values:competitorValues(data)})
    handleRefresh()
    setEditingCompetitor(null)
  }

  const tabs = [
    { id: 'competitors' as TabId, label: 'Competitors', icon: Building2 },
    { id: 'overview' as TabId, label: 'Overview', icon: Eye },
    { id: 'alerts' as TabId, label: 'Alerts', icon: Bell },
    { id: 'brief' as TabId, label: 'Reports', icon: FileText },
  ]
  const tools = [
    {id:'intake' as TabId,label:'Import competitors'},
    {id:'brand-intel' as TabId,label:'Review brand evidence'},
    {id:'ask' as TabId,label:'Search reviewed evidence'},
    {id:'monitoring' as TabId,label:'Monitoring and saved work'},
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-emerald-500" />
            <span className="text-gray-900 dark:text-gray-100">MarketVision 360</span>
          </h1>
          <p className="text-gray-700 dark:text-gray-300 mt-1">
            Competitive intelligence and market analysis
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">Tools <select aria-label="MarketVision tools" value={tools.some(t=>t.id===activeTab)?activeTab:''} onChange={e=>{if(e.target.value)setActiveTab(e.target.value as TabId)}} className="ml-2 rounded border bg-white px-3 py-2 text-slate-900"><option value="">Choose a tool</option>{tools.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <button onClick={handleRefresh} className="flex items-center gap-2 rounded border px-4 py-2 text-sm"><RefreshCw className="h-4 w-4"/>Reload view</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav aria-label="MarketVision sections" className="flex gap-6 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                aria-current={activeTab===tab.id?'page':undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {tools.some(t=>t.id===activeTab)&&<div className="flex flex-wrap items-center gap-3 text-sm"><button onClick={()=>setActiveTab('competitors')} className="text-emerald-700 underline">Back to competitors</button><span className="text-slate-500">Tools / {tools.find(t=>t.id===activeTab)?.label}</span></div>}
      {/* Tab Content */}
      {activeTab === 'brief' && currentProperty?.id && (
        <MarketBriefView
          key={`brief-${refreshKey}`}
          propertyId={currentProperty.id}
        />
      )}

      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Market Summary */}
          <MarketSummary 
            key={`summary-${refreshKey}`}
            propertyId={currentProperty?.id} 
            onRefresh={handleRefresh}
          />

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RentComparisonChart 
              key={`comparison-${currentProperty?.id}-${refreshKey}`}
              propertyId={currentProperty?.id}
              ourPropertyName={currentProperty?.name}
            />
            <PriceTrendChart 
              key={`trends-${refreshKey}`}
              propertyId={currentProperty?.id}
            />
          </div>

          {/* Recent Alerts */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-500" />
                Recent Alerts
              </h3>
              <button
                onClick={() => setActiveTab('alerts')}
                className="text-sm text-indigo-600 hover:text-indigo-700"
              >
                View all →
              </button>
            </div>
            <MarketAlertsList 
              key={`alerts-compact-${refreshKey}`}
              propertyId={currentProperty?.id}
              limit={5}
              compact
            />
          </div>
        </div>
      )}

      {activeTab === 'intake' && currentProperty?.id && <CompetitorIntakePanel propertyId={currentProperty.id}/>}

      {activeTab === 'competitors' && (
        <CompetitorList
          key={`competitors-${currentProperty?.id}-${refreshKey}`}
          propertyId={currentProperty?.id}
          onAddClick={() => setShowAddForm(true)}
          onEditClick={(competitor) => setEditingCompetitor(competitor)}
          onViewClick={(competitor) => setViewingCompetitor(competitor)}
          onRefresh={handleRefresh}
        />
      )}

      {activeTab === 'brand-intel' && currentProperty?.id && (
        <BrandIntelligenceDashboard
          key={`brand-intel-${refreshKey}`}
          propertyId={currentProperty.id}
          propertyName={currentProperty.name}
        />
      )}

      {activeTab === 'ask' && currentProperty?.id && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-1">
              <MessageSquare className="w-5 h-5 text-indigo-500" />
              Evidence search
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Search reviewed competitor statements and exact source quotations. Each search
              keeps its scope, coverage and results for later review.
            </p>
            <SemanticSearchPanel propertyId={currentProperty.id} />
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <MarketAlertsList
          key={`alerts-full-${refreshKey}`}
          propertyId={currentProperty?.id}
          limit={50}
        />
      )}

      {activeTab === 'monitoring' && currentProperty?.id && (
        <MonitoringPanel openRequestId={openRequestId}
          key={`monitoring-${refreshKey}`}
          propertyId={currentProperty.id}
        />
      )}

      {/* Add Competitor Modal */}
      {showAddForm && currentProperty && (
        <CompetitorForm
          propertyId={currentProperty.id}
          onSubmit={handleAddCompetitor}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {/* Edit Competitor Modal */}
      {editingCompetitor && currentProperty && editingCompetitor.propertyId===currentProperty.id && (
        <CompetitorForm
          propertyId={currentProperty.id}
          initialData={{
            name: editingCompetitor.name,
            address: editingCompetitor.address || '',
            websiteUrl: editingCompetitor.websiteUrl || '',
            phone: editingCompetitor.phone || '',
            unitsCount: editingCompetitor.unitsCount?.toString() || '',
            yearBuilt: editingCompetitor.yearBuilt?.toString() || '',
            propertyType: editingCompetitor.propertyType,
            amenities: editingCompetitor.amenities,
            notes: editingCompetitor.notes || ''
          }}
          onSubmit={handleEditCompetitor}
          onClose={() => setEditingCompetitor(null)}
          isEdit
        />
      )}

      {/* Competitor Detail Drawer */}
      {activeTab==='competitors' && viewingCompetitor && viewingCompetitor.propertyId===currentProperty?.id && (
        (() => {
          const drawerCompetitor = {
            ...viewingCompetitor,
            photos: viewingCompetitor.photos ?? [],
            notes: viewingCompetitor.notes ?? null
          }
          return (
            <CompetitorDetailDrawer
              key={drawerCompetitor.id}
              profile={viewingCompetitor}
              competitor={drawerCompetitor}
              onClose={() => setViewingCompetitor(null)}
              onEdit={(comp) => {
                setViewingCompetitor(null)
                // Ensure required fields exist for our edit state
                setEditingCompetitor({
                  ...comp,
                  photos: comp.photos ?? [],
                  notes: comp.notes ?? null
                })
              }}
            />
          )
        })()
      )}

    </div>
  )
}
