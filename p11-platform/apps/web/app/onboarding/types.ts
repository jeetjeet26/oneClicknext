// Onboarding Types for Phase 1

import type { PropertyType } from '@/utils/property-types'

export type OnboardingStep = 
  | 'organization' 
  | 'community' 
  | 'contacts' 
  | 'integrations' 
  | 'knowledge' 
  | 'review' 
  | 'complete'

// Alias for backward compatibility
export type CommunityType = PropertyType

export type OrganizationType = 
  | 'pmc' // Property Management Company
  | 'owner_operator' 
  | 'developer' 
  | 'reit'
  | 'other'

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

export interface OrganizationData {
  name: string
  type: OrganizationType | ''
  legalName: string
}

// Property data (internally uses 'community' key for backward compat)
export interface PropertyData {
  name: string
  type: PropertyType | ''
  address: Address
  websiteUrl: string
  additionalUrls: string[]  // Additional pages to scrape into knowledge base
  unitCount: string
  yearBuilt: string
  amenities: string[]
}

// Alias for backward compatibility
export type CommunityData = PropertyData

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

export interface OnboardingFormData {
  organization: OrganizationData
  community: CommunityData
  contacts: ContactData[]
  integrations: IntegrationData[]
  documents: UploadedDocument[]
  websiteScrapeResult?: WebsiteScrapeResult
}

export interface OnboardingContextType {
  step: OnboardingStep
  setStep: (step: OnboardingStep) => void
  formData: OnboardingFormData
  updateFormData: <K extends keyof OnboardingFormData>(
    section: K, 
    data: OnboardingFormData[K]
  ) => void
  updateOrganization: (data: Partial<OrganizationData>) => void
  updateCommunity: (data: Partial<CommunityData>) => void
  addContact: (contact: ContactData) => void
  updateContact: (id: string, data: Partial<ContactData>) => void
  removeContact: (id: string) => void
  updateIntegration: (platform: IntegrationPlatform, data: Partial<IntegrationData>) => void
  addDocument: (doc: UploadedDocument) => void
  updateDocument: (id: string, data: Partial<UploadedDocument>) => void
  removeDocument: (id: string) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  error: string | null
  setError: (error: string | null) => void
  canProceed: () => boolean
  goToNextStep: () => void
  goToPreviousStep: () => void
}

// Step configuration
export const STEP_CONFIG: Record<OnboardingStep, {
  title: string
  subtitle: string
  icon: string
  order: number
}> = {
  organization: {
    title: 'Organization',
    subtitle: 'Tell us about your company',
    icon: 'Building2',
    order: 1
  },
  community: {
    title: 'Property Details',
    subtitle: 'Property information',
    icon: 'MapPin',
    order: 2
  },
  contacts: {
    title: 'Contacts',
    subtitle: 'Key people & billing',
    icon: 'Users',
    order: 3
  },
  integrations: {
    title: 'Integrations',
    subtitle: 'Connect your platforms',
    icon: 'Link',
    order: 4
  },
  knowledge: {
    title: 'Knowledge Base',
    subtitle: 'Upload documents',
    icon: 'FileText',
    order: 5
  },
  review: {
    title: 'Review',
    subtitle: 'Confirm & launch',
    icon: 'CheckCircle',
    order: 6
  },
  complete: {
    title: 'Complete',
    subtitle: 'All done!',
    icon: 'Sparkles',
    order: 7
  }
}

export const STEPS_ORDER: OnboardingStep[] = [
  'organization',
  'community', 
  'contacts',
  'integrations',
  'knowledge',
  'review',
  'complete'
]

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
  setupUrl?: string
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

