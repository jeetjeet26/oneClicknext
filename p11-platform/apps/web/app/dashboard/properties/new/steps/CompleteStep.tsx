'use client'

import { CheckCircle2, Sparkles, ArrowRight, Building2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAddProperty } from '../AddPropertyProvider'
import { useEffect, useState } from 'react'
import { usePropertyContext } from '@/components/layout/PropertyContext'

export function CompleteStep() {
  const router = useRouter()
  const { formData, createdPropertyId, editMode } = useAddProperty()

  const { refreshProperties } = usePropertyContext()
  const [contextStatus, setContextStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const propertyId = createdPropertyId ?? editMode.propertyId

  useEffect(() => {
    let active = true
    void refreshProperties(propertyId || undefined).then(ok => {
      if (active) setContextStatus(ok ? 'ready' : 'error')
    })
    return () => { active = false }
  }, [propertyId, refreshProperties])

  useEffect(() => {
    if (contextStatus !== 'ready') return
    const timer = setTimeout(() => router.push('/dashboard/community'), 3000)
    return () => clearTimeout(timer)
  }, [contextStatus, router])

  async function retryContext() {
    setContextStatus('loading')
    const ok = await refreshProperties(propertyId || undefined)
    setContextStatus(ok ? 'ready' : 'error')
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="text-center">
        {/* Success animation */}
        <div className="relative inline-flex items-center justify-center mb-8">
          <div className="absolute inset-0 w-32 h-32 bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-full animate-ping" />
          <div className="absolute inset-4 w-24 h-24 bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 rounded-full animate-pulse" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 shadow-2xl shadow-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-white" />
          </div>
        </div>

        <h1 className="text-4xl font-bold text-white mb-4">
          {editMode.isEditing ? 'Changes Saved!' : 'Property Added!'}
        </h1>
        
        <p className="text-xl text-slate-300 mb-2">
          {formData.community.name}
        </p>
        
        <p className="text-slate-400 text-lg mb-8 max-w-md mx-auto">
          {editMode.isEditing 
            ? 'Your property changes have been saved successfully.'
            : 'Your new community has been saved to your organization.'
          }
        </p>

        {/* Quick stats */}
        <div className="flex justify-center gap-4 mb-8">
          <div className="px-4 py-2 bg-slate-800/60 rounded-xl border border-slate-700">
            <p className="text-2xl font-bold text-emerald-400">{formData.contacts.length}</p>
            <p className="text-xs text-slate-500">Contacts</p>
          </div>
          <div className="px-4 py-2 bg-slate-800/60 rounded-xl border border-slate-700">
            <p className="text-2xl font-bold text-cyan-400">{formData.integrations.filter(i => i.status === 'connected').length}</p>
            <p className="text-xs text-slate-500">Connection plans</p>
          </div>
          <div className="px-4 py-2 bg-slate-800/60 rounded-xl border border-slate-700">
            <p className="text-2xl font-bold text-rose-400">{formData.documents.length}</p>
            <p className="text-xs text-slate-500">Documents</p>
          </div>
        </div>

        {/* Next steps */}
        <div className="bg-slate-800/40 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6 mb-8 max-w-md mx-auto text-left">
          <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            Next Steps
          </h3>
          <ul className="space-y-2 text-sm text-slate-400">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              Complete any pending integration setups
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              Upload documents for grounded property answers
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              Configure LumaLeasing chatbot settings
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 mt-0.5">✓</span>
              Review your onboarding checklist
            </li>
          </ul>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            disabled={contextStatus !== 'ready'}
            onClick={() => {
              router.push('/dashboard/community')
            }}
            className="disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2 px-6 py-3.5 bg-slate-700/50 text-slate-300 font-medium rounded-xl hover:bg-slate-700 transition-all"
          >
            <Building2 size={18} />
            Back to Property
          </button>
          <button
            disabled={contextStatus !== 'ready'}
            onClick={() => {
              router.push('/dashboard')
            }}
            className="disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2 px-8 py-3.5 bg-gradient-to-r from-emerald-500 to-cyan-600 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all"
          >
            Go to Dashboard
            <ArrowRight size={18} />
          </button>
        </div>

        {contextStatus === 'error' && <div role="alert" className="mt-6 text-amber-300">
          <p>We couldn’t load the saved property. Your changes do not need to be submitted again.</p>
          <button type="button" onClick={() => void retryContext()} className="mt-2 underline">Retry loading saved property</button>
        </div>}
        <p role="status" className="text-slate-500 text-sm mt-6">
          {contextStatus === 'ready' ? 'Opening your property in a few seconds…' : contextStatus === 'loading' ? 'Loading your saved property…' : 'Your property is saved. Reload its details to continue.'}
        </p>
      </div>
    </div>
  )
}


