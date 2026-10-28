'use client'

import { AddPropertyProvider, useAddProperty } from './AddPropertyProvider'
import { StepIndicator } from './StepIndicator'
import {
  CommunityStep,
  ContactsStep,
  IntegrationsStep,
  KnowledgeStep,
  ReviewStep,
  CompleteStep
} from './steps'

function AddPropertyContent() {
  const { step } = useAddProperty()

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
              <h1 className="text-white font-semibold text-lg tracking-tight">Onboarding</h1>
            </div>
          </div>
          <p className="text-center text-sm text-slate-400 mb-6">Add a property, review its details and complete setup.</p>
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

export default function AddPropertyPage() {
  return (
    <AddPropertyProvider>
      <AddPropertyContent />
    </AddPropertyProvider>
  )
}



























