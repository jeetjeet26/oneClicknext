'use client'

import {SetupStatus} from './components/SetupStatus'
import { OnboardingProvider, useOnboarding } from './components/OnboardingProvider'
import { StepIndicator } from './components/StepIndicator'
import {
  OrganizationStep,
  CommunityStep,
  ContactsStep,
  IntegrationsStep,
  KnowledgeStep,
  ReviewStep,
  CompleteStep
} from './steps'

function OnboardingContent() {
  const { step,workspace,pending,isLoading } = useOnboarding()

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
              <span className="text-white font-semibold text-lg tracking-tight">Platform</span>
            </div>
          </div>
          <StepIndicator currentStep={step} />
        </div>
      )}

      {/* Main content */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          <SetupStatus/>
          {workspace?.alreadyMember&&<section className="space-y-4 text-slate-300"><h1 className="text-2xl font-semibold text-white">Your account already has an organization</h1><p>Continue in the console to add or edit a property.</p><a className="inline-block rounded-lg bg-indigo-600 px-4 py-3 text-white" href="/dashboard">Open dashboard</a></section>}
          {workspace&&!workspace.alreadyMember&&workspace.setup?.state!=='completed'&&<fieldset disabled={isLoading||!!pending} className="min-w-0">
          {step === 'organization' && <OrganizationStep />}
          {step === 'community' && <CommunityStep />}
          {step === 'contacts' && <ContactsStep />}
          {step === 'integrations' && <IntegrationsStep />}
          {step === 'knowledge' && <KnowledgeStep />}
          {step === 'review' && <ReviewStep />}
          </fieldset>}
          {workspace?.setup?.state==='completed'&&<CompleteStep/>}
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 pb-6 text-center">
        <p className="text-slate-600 text-sm">
          P11 Platform • Property operations and marketing
        </p>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  return (
    <OnboardingProvider>
      <OnboardingContent />
    </OnboardingProvider>
  )
}
