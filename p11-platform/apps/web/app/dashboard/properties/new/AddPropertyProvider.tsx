'use client'

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react'
import type { PropertyType } from '@/utils/property-types'

// Types for Add Property flow (reuses onboarding types but skips org step)
export type AddPropertyStep = 
  | 'community' 
  | 'contacts' 
  | 'integrations' 
  | 'knowledge' 
  | 'review' 
  | 'complete'

export const ADD_PROPERTY_STEPS: AddPropertyStep[] = [
  'community',
  'contacts',
  'integrations',
  'knowledge',
  'review',
  'complete'
]

// Edit mode type
export type EditMode = {
  isEditing: boolean
  propertyId?: string
}

export const STEP_CONFIG: Record<AddPropertyStep, {
  title: string
  subtitle: string
  order: number
}> = {
  community: {
    title: 'Community Details',
    subtitle: 'Property information',
    order: 1
  },
  contacts: {
    title: 'Contacts',
    subtitle: 'Key people & billing',
    order: 2
  },
  integrations: {
    title: 'Integrations',
    subtitle: 'Connect your platforms',
    order: 3
  },
  knowledge: {
    title: 'Knowledge Base',
    subtitle: 'Upload documents',
    order: 4
  },
  review: {
    title: 'Review',
    subtitle: 'Confirm & launch',
    order: 5
  },
  complete: {
    title: 'Complete',
    subtitle: 'All done!',
    order: 6
  }
}

export type CommunityType = PropertyType

export type ContactType = 'primary' | 'secondary' | 'billing' | 'emergency'

export type BillingMethod = 
  | 'ops_merchant' 
  | 'nexus' 
  | 'ach' 
  | 'check' 
  | 'credit_card' 
  | 'other'

export type IntegrationPlatform = 
  | 'google_analytics'
  | 'google_search_console'
  | 'google_tag_manager'
  | 'google_ads'
  | 'google_business_profile'
  | 'meta_ads'
  | 'linkedin_ads'
  | 'tiktok_ads'
  | 'email_marketing'
  | 'crm'
  | 'pms'

export type IntegrationStatus = 
  | 'pending' 
  | 'requested' 
  | 'connected' 
  | 'verified' 
  | 'expired' 
  | 'error'

export interface Address {
  street: string
  city: string
  state: string
  zip: string
}

export interface CommunityData {
  name: string
  type: CommunityType | ''
  address: Address
  websiteUrl: string
  additionalUrls: string[]  // Additional pages to scrape into knowledge base
  unitCount: string
  yearBuilt: string
  amenities: string[]
}

export interface ContactData {
  id: string
  type: ContactType
  name: string
  email: string
  phone: string
  role: string
  billingAddress?: Address
  billingMethod?: BillingMethod
  specialInstructions?: string
  needsW9?: boolean
}

export interface IntegrationData {
  platform: IntegrationPlatform
  status: IntegrationStatus
  accountId: string
  accountName: string
  notes: string
}

export interface UploadedDocument {
  id: string
  name: string
  size: number
  type: string
  status: 'pending' | 'uploading' | 'completed' | 'error'
  chunks?: number
  error?: string
  metadata?: Record<string, unknown>
}

export interface WebsiteScrapeResult {
  success: boolean
  propertyName?: string
  amenities: string[]
  petPolicy?: {
    petsAllowed: boolean
    deposit?: number
    monthlyRent?: number
    weightLimitLbs?: number
    maxPets?: number
    breedRestrictions?: boolean
    details?: string[]
  }
  unitTypes: string[]
  specials: string[]
  contactInfo?: {
    phone?: string
    email?: string
    address?: string
    officeHours?: string
  }
  officeHours?: string
  brandVoice?: string
  targetAudience?: string
  neighborhoodInfo?: string
  pagesScraped: number
  chunksCreated: number
  documentsCreated?: number
  error?: string
}

export interface AddPropertyFormData {
  community: CommunityData
  contacts: ContactData[]
  integrations: IntegrationData[]
  documents: UploadedDocument[]
  websiteScrapeResult?: WebsiteScrapeResult
}

export interface AddPropertyContextType {
  step: AddPropertyStep
  setStep: (step: AddPropertyStep) => void
  formData: AddPropertyFormData
  updateCommunity: (data: Partial<CommunityData>) => void
  addContact: (contact: ContactData) => void
  updateContact: (id: string, data: Partial<ContactData>) => void
  removeContact: (id: string) => void
  updateIntegration: (platform: IntegrationPlatform, data: Partial<IntegrationData>) => void
  addDocument: (doc: UploadedDocument) => void
  updateDocument: (id: string, data: Partial<UploadedDocument>) => void
  removeDocument: (id: string) => void
  setWebsiteScrapeResult: (result: WebsiteScrapeResult | undefined) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  error: string | null
  setError: (error: string | null) => void
  canProceed: () => boolean
  goToNextStep: () => void
  goToPreviousStep: () => void
  createdPropertyId: string | null
  setCreatedPropertyId: (id: string | null) => void
  editMode: EditMode
  setFormData: (data: AddPropertyFormData) => void
}

const initialFormData: AddPropertyFormData = {
  community: {
    name: '',
    type: '',
    address: { street: '', city: '', state: '', zip: '' },
    websiteUrl: '',
    additionalUrls: [],
    unitCount: '',
    yearBuilt: '',
    amenities: []
  },
  contacts: [],
  integrations: [],
  documents: [],
  websiteScrapeResult: undefined
}

const AddPropertyContext = createContext<AddPropertyContextType | undefined>(undefined)

interface AddPropertyProviderProps {
  children: ReactNode
  initialData?: AddPropertyFormData
  propertyId?: string
}

export function AddPropertyProvider({ children, initialData, propertyId }: AddPropertyProviderProps) {
  const [step, setStep] = useState<AddPropertyStep>('community')
  const [formData, setFormData] = useState<AddPropertyFormData>(initialData || initialFormData)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdPropertyId, setCreatedPropertyId] = useState<string | null>(propertyId || null)
  const [editMode] = useState<EditMode>({
    isEditing: !!propertyId,
    propertyId: propertyId
  })

  const updateCommunity = useCallback((data: Partial<CommunityData>) => {
    setFormData(prev => ({
      ...prev,
      community: { ...prev.community, ...data }
    }))
  }, [])

  const addContact = useCallback((contact: ContactData) => {
    setFormData(prev => ({
      ...prev,
      contacts: [...prev.contacts, contact]
    }))
  }, [])

  const updateContact = useCallback((id: string, data: Partial<ContactData>) => {
    setFormData(prev => ({
      ...prev,
      contacts: prev.contacts.map(c => c.id === id ? { ...c, ...data } : c)
    }))
  }, [])

  const removeContact = useCallback((id: string) => {
    setFormData(prev => ({
      ...prev,
      contacts: prev.contacts.filter(c => c.id !== id)
    }))
  }, [])

  const updateIntegration = useCallback((platform: IntegrationPlatform, data: Partial<IntegrationData>) => {
    setFormData(prev => {
      const existing = prev.integrations.find(i => i.platform === platform)
      if (existing) {
        return {
          ...prev,
          integrations: prev.integrations.map(i => 
            i.platform === platform ? { ...i, ...data } : i
          )
        }
      } else {
        return {
          ...prev,
          integrations: [...prev.integrations, {
            platform,
            status: 'pending',
            accountId: '',
            accountName: '',
            notes: '',
            ...data
          }]
        }
      }
    })
  }, [])

  const addDocument = useCallback((doc: UploadedDocument) => {
    setFormData(prev => ({
      ...prev,
      documents: [...prev.documents, doc]
    }))
  }, [])

  const updateDocument = useCallback((id: string, data: Partial<UploadedDocument>) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.map(d => d.id === id ? { ...d, ...data } : d)
    }))
  }, [])

  const removeDocument = useCallback((id: string) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.filter(d => d.id !== id)
    }))
  }, [])

  const setWebsiteScrapeResult = useCallback((result: WebsiteScrapeResult | undefined) => {
    setFormData(prev => ({
      ...prev,
      websiteScrapeResult: result
    }))
  }, [])

  const canProceed = useCallback(() => {
    switch (step) {
      case 'community':
        return formData.community.name.trim().length > 0
      case 'contacts':
        // At least one primary contact required
        return formData.contacts.some(c => c.type === 'primary' && c.name && c.email)
      case 'integrations':
        return true
      case 'knowledge':
        return true
      case 'review':
        return true
      default:
        return true
    }
  }, [step, formData])

  const goToNextStep = useCallback(() => {
    const currentIndex = ADD_PROPERTY_STEPS.indexOf(step)
    if (currentIndex < ADD_PROPERTY_STEPS.length - 1) {
      setStep(ADD_PROPERTY_STEPS[currentIndex + 1])
    }
  }, [step])

  const goToPreviousStep = useCallback(() => {
    const currentIndex = ADD_PROPERTY_STEPS.indexOf(step)
    if (currentIndex > 0) {
      setStep(ADD_PROPERTY_STEPS[currentIndex - 1])
    }
  }, [step])

  const value: AddPropertyContextType = {
    step,
    setStep,
    formData,
    updateCommunity,
    addContact,
    updateContact,
    removeContact,
    updateIntegration,
    addDocument,
    updateDocument,
    removeDocument,
    setWebsiteScrapeResult,
    isLoading,
    setIsLoading,
    error,
    setError,
    canProceed,
    goToNextStep,
    goToPreviousStep,
    createdPropertyId,
    setCreatedPropertyId,
    editMode,
    setFormData
  }

  return (
    <AddPropertyContext.Provider value={value}>
      {children}
    </AddPropertyContext.Provider>
  )
}

export function useAddProperty() {
  const context = useContext(AddPropertyContext)
  if (context === undefined) {
    throw new Error('useAddProperty must be used within an AddPropertyProvider')
  }
  return context
}

// Re-export constants for step components
export const AMENITY_OPTIONS = [
  'Pool',
  'Fitness Center',
  'Dog Park',
  'Business Center',
  'Clubhouse',
  'Playground',
  'Tennis Court',
  'Basketball Court',
  'Volleyball Court',
  'BBQ Area',
  'Fire Pit',
  'Rooftop Deck',
  'Parking Garage',
  'EV Charging',
  'Package Lockers',
  'Concierge',
  'Movie Theater',
  'Game Room',
  'Spa/Sauna',
  'Yoga Studio',
  'Co-Working Space',
  'Pet Spa',
  'Bike Storage',
  'Storage Units',
  'On-Site Maintenance',
  'Gated Community',
  '24/7 Security'
]

export const INTEGRATION_CONFIG: Record<IntegrationPlatform, {
  name: string
  description: string
  icon: string
  setupInstructions?: string
}> = {
  google_analytics: {
    name: 'Google Analytics',
    description: 'Track website traffic and conversions',
    icon: 'BarChart2',
    setupInstructions: 'Grant admin access to p11marketing@gmail.com in GA4'
  },
  google_search_console: {
    name: 'Google Search Console',
    description: 'Monitor search performance',
    icon: 'Search',
    setupInstructions: 'Add p11marketing@gmail.com as a user with Full access'
  },
  google_tag_manager: {
    name: 'Google Tag Manager',
    description: 'Manage tracking tags',
    icon: 'Code',
    setupInstructions: 'Grant admin access to p11marketing@gmail.com'
  },
  google_ads: {
    name: 'Google Ads',
    description: 'Manage paid search campaigns',
    icon: 'DollarSign',
    setupInstructions: 'Grant admin access via Google Ads → Tools → Access & Security'
  },
  google_business_profile: {
    name: 'Google Business Profile',
    description: 'Manage your Google listing',
    icon: 'MapPin',
    setupInstructions: 'Add p11marketing@gmail.com as a manager'
  },
  meta_ads: {
    name: 'Meta Ads',
    description: 'Facebook & Instagram advertising',
    icon: 'Facebook',
    setupInstructions: 'Grant partner access in Meta Business Manager'
  },
  linkedin_ads: {
    name: 'LinkedIn Ads',
    description: 'Professional network advertising',
    icon: 'Linkedin',
    setupInstructions: 'Add P11 as an account manager in Campaign Manager'
  },
  tiktok_ads: {
    name: 'TikTok Ads',
    description: 'Short-form video advertising',
    icon: 'Video',
    setupInstructions: 'Grant access via TikTok Ads Manager'
  },
  email_marketing: {
    name: 'Email Marketing',
    description: 'Mailchimp, Constant Contact, etc.',
    icon: 'Mail'
  },
  crm: {
    name: 'CRM System',
    description: 'Entrata, RealPage, Yardi, etc.',
    icon: 'Database'
  },
  pms: {
    name: 'Property Management',
    description: 'Your PMS software',
    icon: 'Home'
  }
}


