'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { DocumentUploader } from '@/components/luma/DocumentUploader'
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
  const { currentProperty, properties } = usePropertyContext()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Data states
  const [profile, setProfile] = useState<any>(null)
  const [property, setProperty] = useState<any>(null)
  const [contacts, setContacts] = useState<any[]>([])
  const [integrations, setIntegrations] = useState<any[]>([])
  const [knowledgeData, setKnowledgeData] = useState<{
    sources: any[]
    documentsCount: number
    uniqueDocuments: number
    categories: Record<string, number>
    insights: string[]
  }>({ sources: [], documentsCount: 0, uniqueDocuments: 0, categories: {}, insights: [] })
  const [tasksData, setTasksData] = useState<{
    tasks: any[]
    stats: {
      total: number
      completed: number
      inProgress: number
      pending: number
      blocked: number
      progress: number
    }
  }>({ tasks: [], stats: { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0, progress: 0 } })
  const [propertyUnits, setPropertyUnits] = useState<any[]>([])
  
  // Modal states
  const [showUploadModal, setShowUploadModal] = useState(false)

  const fetchData = useCallback(async () => {
    if (!currentProperty?.id) return
    
    setLoading(true)
    setError(null)

    try {
      // Fetch all data in parallel
      const [profileRes, contactsRes, integrationsRes, knowledgeRes, tasksRes, unitsRes] = await Promise.all([
        fetch(`/api/community/profile?propertyId=${currentProperty.id}`),
        fetch(`/api/community/contacts?propertyId=${currentProperty.id}`),
        fetch(`/api/community/integrations?propertyId=${currentProperty.id}`),
        fetch(`/api/community/knowledge-sources?propertyId=${currentProperty.id}`),
        fetch(`/api/community/tasks?propertyId=${currentProperty.id}`),
        fetch(`/api/properties/${currentProperty.id}/units`),
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
      if (!tasksRes.ok) {
        failures.push(`tasks: ${await extractFetchError(tasksRes, 'Failed to fetch onboarding tasks')}`)
      }
      if (!unitsRes.ok) {
        failures.push(`units: ${await extractFetchError(unitsRes, 'Failed to fetch property units')}`)
      }

      if (failures.length > 0) {
        setError(`Some data could not be loaded: ${failures.join('; ')}`)
      }

      const [profileData, contactsData, integrationsData, knowledgeDataRes, tasksDataRes, unitsData] = await Promise.all([
        profileRes.ok ? profileRes.json() : Promise.resolve(null),
        contactsRes.ok ? contactsRes.json() : Promise.resolve(null),
        integrationsRes.ok ? integrationsRes.json() : Promise.resolve(null),
        knowledgeRes.ok ? knowledgeRes.json() : Promise.resolve(null),
        tasksRes.ok ? tasksRes.json() : Promise.resolve(null),
        unitsRes.ok ? unitsRes.json() : Promise.resolve(null),
      ])

      setProfile(profileData?.profile ?? null)
      setProperty(profileData?.property || currentProperty)
      setContacts(contactsData?.contacts || [])
      setIntegrations(integrationsData?.integrations || [])
      setKnowledgeData(knowledgeDataRes ?? { sources: [], documentsCount: 0, uniqueDocuments: 0, categories: {}, insights: [] })
      setTasksData(tasksDataRes ?? { tasks: [], stats: { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0, progress: 0 } })
      setPropertyUnits(unitsData?.units || [])
    } catch (err) {
      console.error('Error fetching community data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [currentProperty?.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleAddSuccess = (newProperty: any) => {
    // Refresh the property list
    window.location.reload()
  }

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
          <button
            onClick={() => window.location.href = '/dashboard/properties/new'}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            Add Property
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 p-1 flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex-1 justify-center ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800">Error loading data</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
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
                property={property || currentProperty}
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
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{knowledgeData.documentsCount}</p>
                    <p className="text-xs text-slate-500">Total Chunks</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{knowledgeData.sources.length}</p>
                    <p className="text-xs text-slate-500">Sources</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{knowledgeData.insights.length}</p>
                    <p className="text-xs text-slate-500">Insights</p>
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
                sources={knowledgeData.sources}
                documentsCount={knowledgeData.documentsCount}
                uniqueDocuments={knowledgeData.uniqueDocuments}
                categories={knowledgeData.categories}
                insights={knowledgeData.insights}
                propertyId={currentProperty?.id || ''}
                onRefresh={() => fetchData()}
                onUploadClick={() => setShowUploadModal(true)}
              />

              {/* Property Units & Pricing */}
              <PropertyUnitsCard
                units={propertyUnits}
                propertyId={currentProperty?.id || ''}
              />

              {/* Upload Section */}
              {showUploadModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-slate-900">Upload Document</h3>
                        <button
                          onClick={() => setShowUploadModal(false)}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          ×
                        </button>
                      </div>
                      <DocumentUploader
                        onUploadComplete={() => {
                          fetchData()
                          setShowUploadModal(false)
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Onboarding Checklist Tab */}
          {activeTab === 'checklist' && (
            <OnboardingChecklist
              tasks={tasksData.tasks}
              stats={tasksData.stats}
              onRefresh={() => fetchData()}
            />
          )}
        </>
      )}

    </div>
  )
}

