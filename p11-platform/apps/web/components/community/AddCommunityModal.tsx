'use client'

import { useState, useEffect } from 'react'
import { 
  X, 
  Building2, 
  MapPin, 
  Globe,
  Copy,
  Loader2,
  Check
} from 'lucide-react'
import { PROPERTY_TYPE_OPTIONS } from '@/utils/property-types'

type Property = {
  id: string
  name: string
  address: {
    street?: string
    city?: string
    state?: string
    zip?: string
  } | null
  property_type?: string
  unit_count?: number
  website_url?: string
}

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (property: Property) => void
  existingProperties?: Property[]
}

export function AddCommunityModal({ isOpen, onClose, onSuccess, existingProperties = [] }: Props) {
  const [step, setStep] = useState<'form' | 'template'>('form')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Form data
  const [name, setName] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [propertyType, setPropertyType] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [unitCount, setUnitCount] = useState('')
  const [yearBuilt, setYearBuilt] = useState('')
  
  // Template options
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [copyContacts, setCopyContacts] = useState(true)
  const [copyIntegrations, setCopyIntegrations] = useState(false)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('form')
      setName('')
      setStreet('')
      setCity('')
      setState('')
      setZip('')
      setPropertyType('')
      setWebsiteUrl('')
      setUnitCount('')
      setYearBuilt('')
      setTemplateId(null)
      setCopyContacts(true)
      setCopyIntegrations(false)
      setError(null)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      setError('Community name is required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/properties/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          address: {
            street: street.trim() || null,
            city: city.trim() || null,
            state: state.trim() || null,
            zip: zip.trim() || null,
          },
          propertyType: propertyType || null,
          websiteUrl: websiteUrl.trim() || null,
          unitCount: unitCount ? parseInt(unitCount) : null,
          yearBuilt: yearBuilt ? parseInt(yearBuilt) : null,
          copyFromPropertyId: templateId,
          copyContacts,
          copyIntegrations,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create community')
      }

      onSuccess?.(data.property)
      onClose()
    } catch (err) {
      console.error('Error creating community:', err)
      setError(err instanceof Error ? err.message : 'Failed to create community')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                <Building2 className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add New Community</h2>
                <p className="text-sm text-slate-500">Create another property for your organization</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Content */}
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              {/* Template Selection */}
              {existingProperties.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Copy from existing community
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => setTemplateId(null)}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        templateId === null
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                        templateId === null ? 'bg-indigo-100' : 'bg-slate-100'
                      }`}>
                        <Building2 className={`h-4 w-4 ${templateId === null ? 'text-indigo-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">Start Fresh</p>
                        <p className="text-xs text-slate-500">Create from scratch</p>
                      </div>
                      {templateId === null && <Check className="h-4 w-4 text-indigo-600 ml-auto" />}
                    </button>

                    {existingProperties.map(prop => (
                      <button
                        key={prop.id}
                        type="button"
                        onClick={() => setTemplateId(prop.id)}
                        className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                          templateId === prop.id
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                          templateId === prop.id ? 'bg-indigo-100' : 'bg-slate-100'
                        }`}>
                          <Copy className={`h-4 w-4 ${templateId === prop.id ? 'text-indigo-600' : 'text-slate-400'}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{prop.name}</p>
                          <p className="text-xs text-slate-500">
                            {prop.address?.city && prop.address?.state
                              ? `${prop.address.city}, ${prop.address.state}`
                              : 'Copy settings from this community'
                            }
                          </p>
                        </div>
                        {templateId === prop.id && <Check className="h-4 w-4 text-indigo-600 ml-auto" />}
                      </button>
                    ))}
                  </div>

                  {/* Template options */}
                  {templateId && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-lg space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={copyContacts}
                          onChange={(e) => setCopyContacts(e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-700">Copy contacts</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={copyIntegrations}
                          onChange={(e) => setCopyIntegrations(e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-700">Copy integration settings</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Basic Info */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Community Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="The Reserve at Sandpoint"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  required
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  Address
                </label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    placeholder="Street address"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                    />
                    <input
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="State"
                      className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                    />
                    <input
                      type="text"
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      placeholder="ZIP"
                      className="px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Property Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Property Type
                  </label>
                  <select
                    value={propertyType}
                    onChange={(e) => setPropertyType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  >
                    <option value="">Select type...</option>
                    {PROPERTY_TYPE_OPTIONS.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Unit Count
                  </label>
                  <input
                    type="number"
                    value={unitCount}
                    onChange={(e) => setUnitCount(e.target.value)}
                    placeholder="248"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                    <Globe className="h-4 w-4 text-slate-400" />
                    Website URL
                  </label>
                  <input
                    type="url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Year Built
                  </label>
                  <input
                    type="number"
                    value={yearBuilt}
                    onChange={(e) => setYearBuilt(e.target.value)}
                    placeholder="2020"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                  />
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !name.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Building2 className="h-4 w-4" />
                )}
                Create Property
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// Alias for new naming convention
export const AddPropertyModal = AddCommunityModal