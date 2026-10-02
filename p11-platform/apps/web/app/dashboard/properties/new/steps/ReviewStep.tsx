'use client'

import { 
  CheckCircle, ArrowLeft, Sparkles, MapPin, 
  Users, Link2, FileText, AlertCircle, Edit2, Loader2
} from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { useAddProperty, INTEGRATION_CONFIG } from '../AddPropertyProvider'
import {acknowledgeCreation}from '@/utils/property-setup/creation-client'
import {savePropertySetup}from '@/utils/property-setup/client'
import {creationProfile}from '@/utils/property-setup/creation-contracts'
import { getPropertyTypeLabel } from '@/utils/property-types'

interface SectionCardProps {
  icon: React.ReactNode
  title: string
  isComplete: boolean
  onEdit: () => void
  children: React.ReactNode
}

function SectionCard({ icon, title, isComplete, onEdit, children }: SectionCardProps) {
  return (
    <div className={`
      rounded-xl border p-4 transition-all
      ${isComplete 
        ? 'bg-slate-800/50 border-slate-700' 
        : 'bg-amber-500/5 border-amber-500/30'
      }
    `}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${isComplete ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
            {icon}
          </div>
          <h3 className="font-semibold text-white">{title}</h3>
          {isComplete ? (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-400" />
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
        >
          <Edit2 size={16} />
        </button>
      </div>
      <div className="text-sm text-slate-400 space-y-1">
        {children}
      </div>
    </div>
  )
}

export function ReviewStep() {
  const { setupHash,setupSnapshot,formData, setStep, setIsLoading, error, setError, setCreatedPropertyId, editMode, createdPropertyId } = useAddProperty()
  const { community, contacts, integrations, documents } = formData
  const [submitting, setSubmitting] = useState(false)

  const primaryContact = contacts.find(c => c.type === 'primary')
  const billingContact = contacts.find(c => c.type === 'billing')
  const connectedIntegrations = integrations

  const isCommunityComplete = !!community.name
  const isContactsComplete = primaryContact && primaryContact.name && primaryContact.email

  const handleSubmit = async () => {
    if (!isCommunityComplete || !isContactsComplete) {
      setError('Please complete all required sections before continuing')
      return
    }

    setSubmitting(true)
    setIsLoading(true)
    setError(null)

    try {
      if(!createdPropertyId||!setupHash||!setupSnapshot)throw new Error('Return to property details and recover the saved property before finishing setup.')
      const profile={...creationProfile(community),specialFeatures:setupSnapshot.profile.specialFeatures,brandVoice:setupSnapshot.profile.brandVoice,targetAudience:setupSnapshot.profile.targetAudience}
      const result=await savePropertySetup(createdPropertyId,{expectedHash:setupHash,profile,contacts:contacts.map(c=>({id:c.id,type:c.type,name:c.name,email:c.email,phone:c.phone||'',role:c.role||'',billingAddress:c.billingAddress||{street:'',city:'',state:'',zip:''},billingMethod:c.billingMethod||'',specialInstructions:c.specialInstructions||'',needsW9:c.needsW9||false,isPrimary:c.isPrimary??c.type==='primary'})),connectionRequests:integrations.map(i=>({platform:i.platform,accountId:i.accountId||'',accountName:i.accountName||'',notes:i.notes||''})),reason:'Complete reviewed property setup'},true)
      if(!result.id)throw new Error('The setup completion receipt could not be verified.')
      setCreatedPropertyId(createdPropertyId)
      acknowledgeCreation(createdPropertyId)

      // Success! Navigate to complete step
      setStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
      setIsLoading(false)
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl shadow-indigo-500/25 mb-6">
          <CheckCircle className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">
          {editMode.isEditing ? 'Review & Save' : 'Review & Finish Setup'}
        </h1>
        <p className="text-slate-400 text-lg">
          {editMode.isEditing 
            ? 'Review your changes before saving'
            : 'Review the details to finish setting up your saved property'
          }
        </p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl p-6 sm:p-8">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm space-y-2">
            <AlertCircle size={18} />
            <p role="alert">{error}</p>
            {createdPropertyId&&<div className="flex flex-wrap gap-3">
              <Link className="underline" href={`/dashboard/properties/${createdPropertyId}/edit`} target="_blank" rel="noopener noreferrer">Inspect saved property and history</Link>
              <button type="button" className="underline" onClick={()=>{if(window.confirm('Reload the saved property setup? Unsaved changes in this form will be discarded.'))window.location.assign('/dashboard/properties/new')}}>Reload saved setup</button>
            </div>}
          </div>
        )}

        <div className="space-y-4">
          {/* Community */}
          <SectionCard
            icon={<MapPin size={18} />}
            title="Community"
            isComplete={isCommunityComplete}
            onEdit={() => setStep('community')}
          >
            <p><span className="text-white">{community.name || 'Not set'}</span></p>
            {community.type && <p>Type: {getPropertyTypeLabel(community.type)}</p>}
            {community.address.city && (
              <p>{community.address.city}, {community.address.state} {community.address.zip}</p>
            )}
            {community.unitCount !== '' && <p>{community.unitCount} units</p>}
            {community.websiteUrl && (
              <p className="truncate">{community.websiteUrl}</p>
            )}
            {community.amenities.length > 0 && (
              <p>Amenities: {community.amenities.slice(0, 3).join(', ')}{community.amenities.length > 3 ? '...' : ''}</p>
            )}
          </SectionCard>

          {/* Contacts */}
          <SectionCard
            icon={<Users size={18} />}
            title="Contacts"
            isComplete={!!isContactsComplete}
            onEdit={() => setStep('contacts')}
          >
            {primaryContact ? (
              <>
                <p><span className="text-white">{primaryContact.name}</span> (Primary)</p>
                <p>{primaryContact.email}</p>
              </>
            ) : (
              <p className="text-amber-400">No primary contact set</p>
            )}
            {billingContact && (
              <p className="mt-1"><span className="text-white">{billingContact.name}</span> (Billing)</p>
            )}
            {contacts.length > 2 && (
              <p>+{contacts.length - 2} more contact{contacts.length > 3 ? 's' : ''}</p>
            )}
          </SectionCard>

          {/* Integrations */}
          <SectionCard
            icon={<Link2 size={18} />}
            title="Connection plans"
            isComplete={true}
            onEdit={() => setStep('integrations')}
          >
            {connectedIntegrations.length > 0 ? (
              connectedIntegrations.map(i => (
                <p key={i.platform}>{INTEGRATION_CONFIG[i.platform].name} · Planned</p>
              ))
            ) : (
              <p>No connection plans selected yet</p>
            )}
            {integrations.length > connectedIntegrations.length && (
              <p className="text-amber-400">{integrations.length - connectedIntegrations.length} plans for later setup</p>
            )}
          </SectionCard>

          {/* Documents */}
          <SectionCard
            icon={<FileText size={18} />}
            title="Knowledge Base"
            isComplete={true}
            onEdit={() => setStep('knowledge')}
          >
            {documents.length > 0 ? (
              <p>{documents.length} document{documents.length !== 1 ? 's' : ''} ready to process</p>
            ) : (
              <p>No documents uploaded (can be added later)</p>
            )}
          </SectionCard>
        </div>

        {/* What happens next */}
        <div className="mt-6 bg-indigo-500/10 rounded-xl p-4 border border-indigo-500/20">
          <h4 className="font-semibold text-white mb-2">
            {editMode.isEditing ? 'What happens when you save?' : 'What happens next?'}
          </h4>
          <ul className="text-sm text-slate-400 space-y-1">
            {editMode.isEditing ? (
              <>
                <li>• Your community settings will be updated</li>
                <li>• Contact information will be saved</li>
                <li>• Integration settings will be preserved</li>
                <li>• Changes take effect immediately</li>
              </>
            ) : (
              <>
                <li>• Your reviewed property details and contacts will be saved together</li>
                <li>• Uploaded sources keep their own processing status; saving setup does not train a model</li>
                <li>• You&apos;ll get a personalized onboarding checklist</li>
                <li>• Selected services remain plans until separately authorized and checked</li>
              </>
            )}
          </ul>
        </div>

        {/* Navigation Buttons */}
        <div className="flex gap-3 pt-6">
          <button
            type="button"
            onClick={() => setStep('knowledge')}
            disabled={submitting}
            className="flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-700/50 text-slate-300 font-medium rounded-xl hover:bg-slate-700 transition-all disabled:opacity-50"
          >
            <ArrowLeft size={18} />
            Back
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !isCommunityComplete || !isContactsComplete}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:from-indigo-600 hover:to-violet-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {editMode.isEditing ? 'Saving Changes...' : 'Adding Property...'}
              </>
            ) : (
              <>
                {editMode.isEditing ? 'Save Changes' : 'Add Property'}
                <Sparkles size={18} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}


