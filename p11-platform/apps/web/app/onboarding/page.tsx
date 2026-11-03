'use client'
import {SetupStatus} from './components/SetupStatus'
import {OnboardingProvider,useOnboarding} from './components/OnboardingProvider'
import {OrganizationStep,CommunityStep,ContactsStep,IntegrationsStep,KnowledgeStep,ReviewStep,CompleteStep} from './steps'
import {WizardLayout} from '@/components/onboarding/WizardLayout'
function Content(){const{step,workspace,pending,isLoading}=useOnboarding();return <WizardLayout step={step} account><SetupStatus/>{workspace?.alreadyMember&&<section><h1 className="text-2xl font-semibold">Your account already has an organization</h1><p>Continue in the console to add or edit a property.</p><a className="underline" href="/dashboard">Open dashboard</a></section>}{workspace&&!workspace.alreadyMember&&workspace.setup?.state!=='completed'&&<fieldset disabled={isLoading||!!pending} className="min-w-0">{step==='organization'&&<OrganizationStep/>}{step==='community'&&<CommunityStep/>}{step==='contacts'&&<ContactsStep/>}{step==='integrations'&&<IntegrationsStep/>}{step==='knowledge'&&<KnowledgeStep/>}{step==='review'&&<ReviewStep/>}</fieldset>}{workspace?.setup?.state==='completed'&&<CompleteStep/>}</WizardLayout>}
export default function OnboardingPage(){return <OnboardingProvider><Content/></OnboardingProvider>}
