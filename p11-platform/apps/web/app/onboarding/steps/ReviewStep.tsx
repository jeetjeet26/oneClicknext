'use client'

import { 
  CheckCircle, ArrowLeft, Sparkles, Building2, MapPin, 
  Users, Link2, FileText, AlertCircle, Edit2, Loader2
} from 'lucide-react'
import { useOnboarding } from '../components/OnboardingProvider'
import { INTEGRATION_CONFIG } from '../types'
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
  const { formData, setStep, isLoading:submitting, error, completeSetup } = useOnboarding()
  const { organization, community, contacts, integrations, documents } = formData

  const primaryContact = contacts.find(c => c.type === 'primary')
  const billingContact = contacts.find(c => c.type === 'billing')
  const plannedIntegrations = integrations

  const isOrgComplete = !!organization.name
  const isCommunityComplete = !!community.name
  const isContactsComplete = primaryContact && primaryContact.name && primaryContact.email

  const handleSubmit = () => { void completeSetup() }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl shadow-indigo-500/25 mb-6">
          <CheckCircle className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">
          Review & Create
        </h1>
        <p className="text-slate-400 text-lg">
          Double-check your information before we set everything up
        </p>
      </div>

      <div className="bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-slate-700/50 shadow-2xl p-6 sm:p-8">
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Organization */}
          <SectionCard
            icon={<Building2 size={18} />}
            title="Organization"
            isComplete={isOrgComplete}
            onEdit={() => setStep('organization')}
          >
            <p><span className="text-white">{organization.name || 'Not set'}</span></p>
            {organization.type && <p>Type: {organization.type.replace('_', ' ')}</p>}
            {organization.legalName && <p>Legal: {organization.legalName}</p>}
          </SectionCard>

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
            {community.unitCount && <p>{community.unitCount} units</p>}
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
            title="Integrations"
            isComplete={true}
            onEdit={() => setStep('integrations')}
          >
            {plannedIntegrations.length > 0 ? (
              plannedIntegrations.map(i => (
                <p key={i.platform}><span className="text-emerald-400">✓</span> {INTEGRATION_CONFIG[i.platform].name}</p>
              ))
            ) : (
              <p>No integrations configured yet</p>
            )}
            {integrations.length > plannedIntegrations.length && (
              <p className="text-amber-400">{integrations.length - plannedIntegrations.length} pending setup</p>
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
              <p>{documents.length} document{documents.length !== 1 ? 's' : ''} listed for later review</p>
            ) : (
              <p>Private files and website captures can be added after setup</p>
            )}
          </SectionCard>
        </div>

        {/* What happens next */}
        <div className="mt-6 bg-indigo-500/10 rounded-xl p-4 border border-indigo-500/20">
          <h4 className="font-semibold text-white mb-2">What happens next?</h4>
          <ul className="text-sm text-slate-400 space-y-1">
            <li>• We&apos;ll create your organization and community in the platform</li>
            <li>• Knowledge sources require separate private upload, review and publication</li>
            <li>• You&apos;ll get a personalized onboarding checklist</li>
            <li>• Connection plans remain inactive until separately authorized</li>
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
            disabled={submitting || !isOrgComplete || !isCommunityComplete || !isContactsComplete}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:from-indigo-600 hover:to-violet-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                Complete Setup
                <Sparkles size={18} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

