'use client'
import {useOnboarding} from '../components/OnboardingProvider'
import {CommunityFields} from '@/components/onboarding/SetupFields'
import {setupPanel,setupButton,setupPrimary} from '@/components/onboarding/IntakeFields'
export function CommunityStep(){const{formData,updateCommunity,goToNextStep,goToPreviousStep}=useOnboarding();return <section className={setupPanel}><h1 className="text-3xl font-semibold">Property Details</h1><form className="space-y-6" onSubmit={e=>{e.preventDefault();goToNextStep()}}><CommunityFields value={formData.community} onChange={updateCommunity}/><div className="flex justify-between"><button type="button" className={setupButton} onClick={goToPreviousStep}>Back</button><button className={setupPrimary}>Continue</button></div></form></section>}
