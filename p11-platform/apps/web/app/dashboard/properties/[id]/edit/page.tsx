'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AddPropertyProvider, AddPropertyFormData, ContactData, IntegrationData, UploadedDocument } from '../../new/AddPropertyProvider'
import { StepIndicator } from '../../new/StepIndicator'
import {
  CommunityStep,
  ContactsStep,
  IntegrationsStep,
  KnowledgeStep,
  ReviewStep,
  CompleteStep
} from '../../new/steps'
import { useAddProperty } from '../../new/AddPropertyProvider'
import { Loader2 } from 'lucide-react'

// API response types
interface PropertyContact {
  id: string
  contact_type: 'primary' | 'secondary' | 'billing' | 'emergency'
  name: string
  email: string
  phone?: string
  role?: string
  billing_address?: {
    street?: string
    city?: string
    state?: string
    zip?: string
  }
  billing_method?: string
  special_instructions?: string
  needs_w9?: boolean
}

interface PropertyIntegration {
  id: string
  platform: string
  status: string
  account_id?: string
  account_name?: string
  notes?: string
}

interface PropertyDocument {
  id: string
  name: string
  file_size?: number
  mime_type?: string
}

interface PropertyData {
  id: string
  name: string
  address?: {
    street?: string
    city?: string
    state?: string
    zip?: string
  }
  settings?: {
    community_type?: string
    unit_count?: number
    year_built?: number
    website_url?: string
    amenities?: string[]
  }
  website_url?: string | null
  property_type?: string | null
  unit_count?: number | null
  year_built?: number | null
  amenities?: string[] | null
  contacts: PropertyContact[]
  integrations: PropertyIntegration[]
  documents: PropertyDocument[]
}

function EditPropertyContent() {
  const { step, editMode } = useAddProperty()

  const title = editMode.isEditing ? 'Edit Property' : 'Add Property'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col">
      {/* Animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/3 rounded-full blur-3xl" />
        {/* Grid pattern */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
            backgroundSize: '64px 64px'
          }}
        />
      </div>

      {/* Header with step indicator */}
      {step !== 'complete' && (
        <div className="relative z-10 pt-8 pb-4 px-4">
          <div className="max-w-3xl mx-auto mb-4">
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">P11</span>
              </div>
              <span className="text-white font-semibold text-lg tracking-tight">{title}</span>
            </div>
          </div>
          <StepIndicator currentStep={step} />
        </div>
      )}

      {/* Main content */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          {step === 'community' && <CommunityStep />}
          {step === 'contacts' && <ContactsStep />}
          {step === 'integrations' && <IntegrationsStep />}
          {step === 'knowledge' && <KnowledgeStep />}
          {step === 'review' && <ReviewStep />}
          {step === 'complete' && <CompleteStep />}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 pb-6 text-center">
        <p className="text-slate-600 text-sm">
          P11 Platform • Intelligent Marketing for Multifamily
        </p>
      </div>
    </div>
  )
}

function transformPropertyToFormData(property: PropertyData): AddPropertyFormData {
  // Transform contacts from API format to form format
  const contacts: ContactData[] = property.contacts.map(contact => ({
    id: contact.id,
    type: contact.contact_type,
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    role: contact.role || '',
    billingAddress: contact.billing_address ? {
      street: contact.billing_address.street || '',
      city: contact.billing_address.city || '',
      state: contact.billing_address.state || '',
      zip: contact.billing_address.zip || ''
    } : undefined,
    billingMethod: contact.billing_method as ContactData['billingMethod'],
    specialInstructions: contact.special_instructions,
    needsW9: contact.needs_w9
  }))

  // Transform integrations from API format to form format
  const integrations: IntegrationData[] = property.integrations.map(integration => ({
    platform: integration.platform as IntegrationData['platform'],
    status: integration.status as IntegrationData['status'],
    accountId: integration.account_id || '',
    accountName: integration.account_name || '',
    notes: integration.notes || ''
  }))

  // Transform documents from API format to form format
  const documents: UploadedDocument[] = property.documents.map(doc => ({
    id: doc.id,
    name: doc.name,
    size: doc.file_size || 0,
    type: doc.mime_type || 'application/octet-stream',
    status: 'completed' as const
  }))

  return {
    community: {
      name: property.name || '',
      type: (property.property_type || property.settings?.community_type || '') as AddPropertyFormData['community']['type'],
      address: {
        street: property.address?.street || '',
        city: property.address?.city || '',
        state: property.address?.state || '',
        zip: property.address?.zip || ''
      },
      websiteUrl: property.website_url || property.settings?.website_url || '',
      additionalUrls: [],
      unitCount: property.unit_count?.toString() || property.settings?.unit_count?.toString() || '',
      yearBuilt: property.year_built?.toString() || property.settings?.year_built?.toString() || '',
      amenities: property.amenities || property.settings?.amenities || []
    },
    contacts,
    integrations,
    documents,
    websiteScrapeResult: undefined
  }
}

export default function EditPropertyPage() {
  const params = useParams()
  const propertyId = params.id as string
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [initialData, setInitialData] = useState<AddPropertyFormData | null>(null)

  useEffect(() => {
    async function fetchProperty() {
      try {
        const response = await fetch(`/api/properties/${propertyId}`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load property')
        }

        const formData = transformPropertyToFormData(data.property)
        setInitialData(formData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load property')
      } finally {
        setLoading(false)
      }
    }

    if (propertyId) {
      fetchProperty()
    }
  }, [propertyId])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-cyan-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading property data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-red-400 text-2xl">!</span>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Error Loading Property</h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <a 
            href="/dashboard/community"
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-700 text-white rounded-xl hover:bg-slate-600 transition-colors"
          >
            Back to Property
          </a>
        </div>
      </div>
    )
  }

  return (
    <AddPropertyProvider initialData={initialData!} propertyId={propertyId}>
      <EditPropertyContent />
    </AddPropertyProvider>
  )
}

