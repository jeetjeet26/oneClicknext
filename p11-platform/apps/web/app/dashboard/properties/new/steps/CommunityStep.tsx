'use client'

import { MapPin, ArrowRight, Globe, Building, Calendar, Hash, Loader2, X, Plus, Link } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAddProperty, AMENITY_OPTIONS } from '../AddPropertyProvider'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import {PropertyTemplatePicker}from '@/components/community/PropertyTemplatePicker'
import {createProperty,recoverPendingCreation,acknowledgeCreation}from '@/utils/property-setup/creation-client'
import {creationProfile,type CreationReceipt}from '@/utils/property-setup/creation-contracts'
import type {AddPropertyFormData}from '../AddPropertyProvider'
import { PROPERTY_TYPE_OPTIONS } from '@/utils/property-types'



export function CommunityStep() {
  const router = useRouter()
  const { refreshProperties } = usePropertyContext()
  const { setupHash,setSetupHash,setSetupSnapshot,creationTemplate,setCreationTemplate,templatePending,setTemplatePending,setFormData,setStep,formData, updateCommunity, error, setError, canProceed, goToNextStep, editMode, createdPropertyId, setCreatedPropertyId, isLoading, setIsLoading } = useAddProperty()
  const { community } = formData
  const [showAmenities, setShowAmenities] = useState(false)


  const[recovered,setRecovered]=useState<CreationReceipt|null>(null)
  const[checkingCreation,setCheckingCreation]=useState(true)
  useEffect(()=>{let active=true;void recoverPendingCreation().then(value=>{if(active)setRecovered(value)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Saved creation could not be checked.')}).finally(()=>{if(active)setCheckingCreation(false)});return()=>{active=false}},[setError])
  async function checkSavedCreation(){setCheckingCreation(true);try{setRecovered(await recoverPendingCreation())}catch(e){setError(e instanceof Error?e.message:'Creation recovery is unavailable.')}finally{setCheckingCreation(false)}}
  async function acceptCreated(value:CreationReceipt){const p=value.snapshot.profile;setCreatedPropertyId(value.propertyId);setSetupHash(value.snapshotHash);setSetupSnapshot(value.snapshot);setFormData({...formData,community:{...community,name:p.name,type:(p.propertyType||'')as AddPropertyFormData['community']['type'],address:p.address,websiteUrl:p.websiteUrl,additionalUrls:p.additionalUrls,unitCount:p.unitCount?.toString()??'',yearBuilt:p.yearBuilt?.toString()??'',amenities:p.amenities},contacts:value.snapshot.contacts.map(c=>({...c,billingMethod:c.billingMethod||undefined})),integrations:value.snapshot.connectionRequests.map(c=>({...c,status:'pending' as const}))});setRecovered(null);setError(null);const ready=await refreshProperties(value.propertyId);if(!ready)setError('The property is saved, but the selector could not refresh. Continue setup with this saved property or retry the selector.');if(value.property.onboarding_completed_at){acknowledgeCreation(value.requestId);setStep('complete');return true}return false;}
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if(isLoading||checkingCreation)return
    if(!community.name.trim()){setError('Community name is required');return}
    if(!createdPropertyId&&templatePending&&!creationTemplate){setError('Review and accept the selected template, or choose no template.');return}
    setError(null)
    if(!createdPropertyId&&!editMode.isEditing){setIsLoading(true);try{const value=await createProperty(creationProfile(community),creationTemplate);if(!await acceptCreated(value))goToNextStep()}catch(e){setError(e instanceof Error?e.message:'Creation is unconfirmed. Check the saved result or retry this request.')}finally{setIsLoading(false)}return}
    if(!setupHash&&!editMode.isEditing){setError('Recover the saved property version before completing setup.');return}
    goToNextStep()
  }

  const toggleAmenity = (amenity: string) => {
    const current = community.amenities || []
    if (current.includes(amenity)) {
      updateCommunity({ amenities: current.filter(a => a !== amenity) })
    } else {
      updateCommunity({ amenities: [...current, amenity] })
    }
  }

  const removeUrlAtIndex = (index: number) => {
    const current = community.additionalUrls || []
    updateCommunity({ additionalUrls: current.filter((_, i) => i !== index) })
  }



  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-xl shadow-cyan-500/25 mb-6">
          <MapPin className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">
          {editMode.isEditing ? 'Edit Community' : 'Add New Community'}
        </h1>
        <p className="text-slate-400 text-lg">
          {editMode.isEditing ? 'Update your property details' : 'Enter your property details'}
        </p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl p-8">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Website URL */}
          <div>
            <label htmlFor="websiteUrl" className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Globe className="w-4 h-4 text-cyan-400" />
              Website URL
            </label>
            <div className="flex gap-2">
              <input
                id="websiteUrl"
                type="url"
                value={community.websiteUrl}
                onChange={(e) => updateCommunity({ websiteUrl: e.target.value })}
                placeholder="https://thereserveatsandpoint.com"
                className="flex-1 px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              />

            </div>

            <p className="mt-2 text-sm text-slate-400">After saving this property, use Website Sources in Community knowledge to capture and review each page. Website addresses alone do not import facts.</p>







            {/* Additional URLs Section */}
            <div className="mt-4 pt-4 border-t border-slate-700/50">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-2">
                <Link className="w-3 h-3" />
                Additional page addresses (optional)
              </label>
              <p className="text-xs text-slate-500 mb-3">
                Add specific page URLs (e.g., amenities, floor plans, pet policy) to include in the knowledge base
              </p>

              {/* URL Input Fields */}
              <div className="space-y-2 mb-3">
                {(community.additionalUrls || []).map((url, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-6 h-6 rounded bg-slate-800 text-slate-500 text-xs flex-shrink-0">
                      {idx + 1}
                    </div>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const updated = [...(community.additionalUrls || [])]
                        updated[idx] = e.target.value
                        updateCommunity({ additionalUrls: updated })
                      }}
                      placeholder="https://example.com/amenities"
                      className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => removeUrlAtIndex(idx)}
                      className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                      title="Remove URL"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add URL Button */}
              <button
                type="button"
                onClick={() => {
                  const current = community.additionalUrls || []
                  updateCommunity({ additionalUrls: [...current, ''] })
                }}
                className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-dashed border-slate-600 text-slate-400 rounded-lg hover:bg-slate-800 hover:border-slate-500 hover:text-slate-300 transition-all text-sm w-full justify-center"
              >
                <Plus className="w-4 h-4" />
                Add URL
              </button>

              {community.additionalUrls && community.additionalUrls.filter(u => u.trim()).length > 0 && (
                <p className="text-xs text-slate-500 mt-3">
                  {community.additionalUrls.filter(u => u.trim()).length + (community.websiteUrl ? 1 : 0)} total URL(s) will be scraped
                </p>
              )}
            </div>
          </div>

          {/* Community Name */}
          <div>
            <label htmlFor="communityName" className="block text-sm font-medium text-slate-300 mb-2">
              Community name <span className="text-red-400">*</span>
            </label>
            <input
              id="communityName"
              type="text"
              value={community.name}
              onChange={(e) => updateCommunity({ name: e.target.value })}
              placeholder="The Reserve at Sandpoint"
              className="w-full px-4 py-3.5 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              autoFocus
            />
          </div>

          {/* Property Type */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">
              Property type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PROPERTY_TYPE_OPTIONS.map(({ value, label, description }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateCommunity({ type: value })}
                  className={`
                    p-3 rounded-xl border-2 text-left transition-all
                    ${community.type === value
                      ? 'border-cyan-400 bg-cyan-500/10 text-white'
                      : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600'
                    }
                  `}
                >
                  <span className="font-medium text-sm block">{label}</span>
                  <span className="text-xs text-slate-500">{description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Address
            </label>
            <input
              type="text"
              value={community.address.street}
              onChange={(e) => updateCommunity({ 
                address: { ...community.address, street: e.target.value } 
              })}
              placeholder="123 Main Street"
              className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all mb-3"
            />
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                value={community.address.city}
                onChange={(e) => updateCommunity({ 
                  address: { ...community.address, city: e.target.value } 
                })}
                placeholder="City"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all text-sm"
              />
              <input
                type="text"
                value={community.address.state}
                onChange={(e) => updateCommunity({ 
                  address: { ...community.address, state: e.target.value } 
                })}
                placeholder="State"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all text-sm"
              />
              <input
                type="text"
                value={community.address.zip}
                onChange={(e) => updateCommunity({ 
                  address: { ...community.address, zip: e.target.value } 
                })}
                placeholder="ZIP"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all text-sm"
              />
            </div>
          </div>

          {/* Unit Count & Year Built */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="unitCount" className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Hash className="w-4 h-4 text-slate-400" />
                Unit count
              </label>
              <input
                id="unitCount"
                type="number"
                min="1"
                value={community.unitCount}
                onChange={(e) => updateCommunity({ unitCount: e.target.value })}
                placeholder="248"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              />
            </div>
            <div>
              <label htmlFor="yearBuilt" className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                Year built
              </label>
              <input
                id="yearBuilt"
                type="number"
                min="1900"
                max={new Date().getFullYear() + 2}
                value={community.yearBuilt}
                onChange={(e) => updateCommunity({ yearBuilt: e.target.value })}
                placeholder="2019"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all"
              />
            </div>
          </div>

          {/* Amenities */}
          <div>
            <button
              type="button"
              onClick={() => setShowAmenities(!showAmenities)}
              className="flex items-center justify-between w-full text-sm font-medium text-slate-300 mb-3 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <Building className="w-4 h-4 text-slate-400" />
                Amenities {community.amenities.length > 0 && (
                  <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 text-xs rounded-full">
                    {community.amenities.length} selected
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500">
                {showAmenities ? 'Hide' : 'Show'} options
              </span>
            </button>

            {showAmenities && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                {AMENITY_OPTIONS.map((amenity) => (
                  <button
                    key={amenity}
                    type="button"
                    onClick={() => toggleAmenity(amenity)}
                    className={`
                      px-3 py-2 rounded-lg text-xs font-medium transition-all text-left
                      ${community.amenities.includes(amenity)
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'
                      }
                    `}
                  >
                    {amenity}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Insights Preview */}


          {!createdPropertyId&&<PropertyTemplatePicker onChange={(selection,pending)=>{setCreationTemplate(selection);setTemplatePending(pending)}}/>}
          {!createdPropertyId&&<div className="mt-4 space-y-2 text-sm text-slate-300">{checkingCreation?<p role="status">Checking saved creation…</p>:<button type="button" className="underline" onClick={()=>void checkSavedCreation()}>Check saved creation</button>}{recovered&&<div role="status"><p>A property was already saved for this browser request: {recovered.property.name}. Resuming replaces this new-property draft with its saved details.</p><button type="button" className="mt-2 rounded-lg border border-slate-500 px-3 py-2" onClick={()=>void acceptCreated(recovered)}>Resume saved property</button><button type="button" className="ml-2 mt-2 underline" onClick={()=>{acknowledgeCreation(recovered.requestId);setRecovered(null)}}>Keep the saved property and start another</button></div>}</div>}
          {createdPropertyId&&<p className="mt-4 text-sm text-slate-300">This property is saved. Further form changes are applied together at the final review. Website addresses do not automatically start an import.</p>}

          {/* Navigation Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.push('/dashboard/community')}
              className="flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-700/50 text-slate-300 font-medium rounded-xl hover:bg-slate-700 transition-all"
            >
              <X size={18} />
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canProceed() || isLoading || checkingCreation}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold rounded-xl shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Creating property...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


