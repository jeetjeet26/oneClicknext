'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback, useRef, type ComponentProps } from 'react'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import {
  PropertyProfileCard,
  ContactsManager,
  IntegrationStatusList,
  KnowledgeSourcesList,
  OnboardingChecklist,
  PropertyUnitsCard,
  ChatbotContextStatusCard
} from '@/components/community'
import { BrandIdentitySection } from '@/components/community/BrandIdentitySection'
import { SiteForgeReadinessCard } from '@/components/community/SiteForgeReadinessCard'
import { OnboardingTruthEditor } from '@/components/community/OnboardingTruthEditor'
import {
  Building2,
  BookOpen,
  ClipboardCheck,
  Plus,
  RefreshCw,
  Loader2,
  AlertCircle
} from 'lucide-react'

type Tab = 'overview' | 'knowledge' | 'checklist'

async function extractFetchError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    if (typeof data?.error === 'string' && data.error.trim().length > 0) {
      return data.error
    }
  } catch {
    // Ignore JSON parsing errors and return fallback details.
  }
  return `${fallback} (${response.status})`
}

export default function PropertyDashboardPage() {
  const { currentProperty } = usePropertyContext()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    if (['knowledgeGroup', 'knowledgeFile', 'knowledgeSource', 'assistantFactVersion', 'unitReview', 'knowledgeCapture'].some(key => query.has(key))) setActiveTab('knowledge')
  }, [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Data states
  const [profile, setProfile] = useState<ComponentProps<typeof PropertyProfileCard>['profile']>(null)
  const [property, setProperty] = useState<ComponentProps<typeof PropertyProfileCard>['property'] | null>(null)
  const [contacts, setContacts] = useState<ComponentProps<typeof ContactsManager>['contacts']>([])
  const [integrations, setIntegrations] = useState<ComponentProps<typeof IntegrationStatusList>['integrations']>([])
  const [knowledgeData, setKnowledgeData] = useState<{
    sources: ComponentProps<typeof KnowledgeSourcesList>['sources']
    sourceCount?: number
    hasWebsiteSources?: boolean
    documentsCount: number
    uniqueDocuments: number
    categories: Record<string, number>
    insights: string[]
  } | null>(null)
  const [propertyUnits, setPropertyUnits] = useState<ComponentProps<typeof PropertyUnitsCard>['units']>([])
  
  const requestRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    requestRef.current?.abort()
    if (!currentProperty?.id) return
    const controller = new AbortController()
    requestRef.current = controller
    
    setLoading(true)
    setError(null)
    setKnowledgeData(null)

    try {
      // Fetch all data in parallel
      const [profileRes, contactsRes, integrationsRes, knowledgeRes, unitsRes] = await Promise.all([
        fetch(`/api/community/profile?propertyId=${currentProperty.id}`, { signal: controller.signal, cache: 'no-store' }),
        fetch(`/api/community/contacts?propertyId=${currentProperty.id}`, { signal: controller.signal, cache: 'no-store' }),
        fetch(`/api/community/integrations?propertyId=${currentProperty.id}`, { signal: controller.signal, cache: 'no-store' }),
        fetch(`/api/community/knowledge-sources?propertyId=${currentProperty.id}`, { signal: controller.signal, cache: 'no-store' }),
        fetch(`/api/properties/${currentProperty.id}/units`, { signal: controller.signal, cache: 'no-store' }),
      ])

      const failures: string[] = []
      if (!profileRes.ok) {
        failures.push(`profile: ${await extractFetchError(profileRes, 'Failed to fetch profile')}`)
      }
      if (!contactsRes.ok) {
        failures.push(`contacts: ${await extractFetchError(contactsRes, 'Failed to fetch contacts')}`)
      }
      if (!integrationsRes.ok) {
        failures.push(`integrations: ${await extractFetchError(integrationsRes, 'Failed to fetch integrations')}`)
      }
      if (!knowledgeRes.ok) {
        failures.push(`knowledge: ${await extractFetchError(knowledgeRes, 'Failed to fetch knowledge sources')}`)
      }
      if (!unitsRes.ok) {
        failures.push(`units: ${await extractFetchError(unitsRes, 'Failed to fetch property units')}`)
      }


      const [profileData, contactsData, integrationsData, knowledgeDataRes, unitsData] = await Promise.all([
        profileRes.ok ? profileRes.json() : Promise.resolve(null),
        contactsRes.ok ? contactsRes.json() : Promise.resolve(null),
        integrationsRes.ok ? integrationsRes.json() : Promise.resolve(null),
        knowledgeRes.ok ? knowledgeRes.json() : Promise.resolve(null),
        unitsRes.ok ? unitsRes.json() : Promise.resolve(null),
      ])

      if (controller.signal.aborted) return
      if (failures.length) setError(`Some data could not be loaded: ${failures.join('; ')}`)
      setProfile(profileData?.profile ?? null)
      setProperty(profileData?.property || currentProperty)
      setContacts(contactsData?.contacts || [])
      setIntegrations(integrationsData?.integrations || [])
      setKnowledgeData(knowledgeDataRes)
      setPropertyUnits(unitsData?.units || [])
    } catch (err) {
      if (controller.signal.aborted) return
      console.error('Error fetching community data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [currentProperty])

  useEffect(() => {
    void fetchData()
    return () => requestRef.current?.abort()
  }, [fetchData])

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview', icon: Building2 },
    { id: 'knowledge' as Tab, label: 'Knowledge Base', icon: BookOpen },
    { id: 'checklist' as Tab, label: 'Onboarding', icon: ClipboardCheck },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Property</h1>
          <p className="text-slate-500 mt-1">
            Manage your property information and knowledge base
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <Link
            href="/dashboard/properties/new"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            Add Property
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div aria-label="Property sections" className="bg-white rounded-xl border border-slate-200 p-1 flex gap-1 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-2 sm:px-4 py-2.5 rounded-lg whitespace-nowrap text-sm font-medium transition-colors flex-1 justify-center ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <tab.icon size={18} aria-hidden="true" className="hidden sm:block shrink-0" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">Error loading data</p>
            <p className="text-sm text-red-700 mt-1 break-words">{error}</p>
            <button type="button" onClick={() => void fetchData()} disabled={loading} className="mt-3 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">Retry loading data</button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div role="status" aria-label="Loading property data" className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
        </div>
      )}

      {/* Tab Content */}
      {!loading && (
        <>
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Property Profile Card */}
              <PropertyProfileCard
                profile={profile}
                property={property || {...currentProperty,address:null}}
                onUpdate={() => fetchData()}
              />

              {/* Two Column Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Contacts */}
                <ContactsManager
                  contacts={contacts}
                  propertyId={currentProperty?.id || ''}
                  onUpdate={() => fetchData()}
                />

                {/* Integrations */}
                <IntegrationStatusList
                  integrations={integrations}
                  propertyId={currentProperty?.id || ''}
                  onUpdate={() => fetchData()}
                />
              </div>

              {/* Brand Identity Section */}
              {currentProperty?.id && (
                <BrandIdentitySection 
                  propertyId={currentProperty.id} 
                  propertyName={currentProperty.name}
                />
              )}

              {/* Knowledge Summary */}
              <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-100 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-indigo-500" />
                    AI Knowledge Base
                  </h3>
                  <button
                    onClick={() => setActiveTab('knowledge')}
                    className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                  >
                    View All →
                  </button>
                </div>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{knowledgeData?.documentsCount ?? 'Unavailable'}</p>
                    <p className="text-xs text-slate-500">Total Chunks</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{knowledgeData?.sourceCount ?? 'Unavailable'}</p>
                    <p className="text-xs text-slate-500">Sources</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{knowledgeData?.uniqueDocuments ?? 'Unavailable'}</p>
                    <p className="text-xs text-slate-500">Material groups</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Knowledge Base Tab */}
          {activeTab === 'knowledge' && (
            <div className="space-y-6">
              <ChatbotContextStatusCard propertyId={currentProperty?.id || ''} />

              <KnowledgeSourcesList
                sources={knowledgeData?.sources ?? []}
                hasWebsiteSources={knowledgeData?.hasWebsiteSources}
                documentsCount={knowledgeData?.documentsCount ?? 0}
                uniqueDocuments={knowledgeData?.uniqueDocuments ?? 0}
                categories={knowledgeData?.categories ?? {}}
                insights={knowledgeData?.insights ?? []}
                propertyId={currentProperty?.id || ''}
                onRefresh={() => fetchData()}
              />

              {/* Property Units & Pricing */}
              <PropertyUnitsCard
                units={propertyUnits}
                propertyId={currentProperty?.id || ''}
              />


            </div>
          )}

          {/* Onboarding Checklist Tab */}
          {activeTab === 'checklist' && (
            <div className="space-y-6">
              <OnboardingTruthEditor propertyId={currentProperty?.id || ''} />
              <SiteForgeReadinessCard propertyId={currentProperty?.id || ''} />
              <OnboardingChecklist
                key={currentProperty?.id}
                propertyId={currentProperty?.id || ''}
              />
            </div>
          )}
        </>
      )}

    </div>
  )
}

