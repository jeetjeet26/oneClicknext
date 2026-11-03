'use client'
import {useAddProperty} from '../AddPropertyProvider'
import {ConnectionFields} from '@/components/onboarding/SetupFields'
import {IntakeFields,setupPanel,setupButton,setupPrimary} from '@/components/onboarding/IntakeFields'
export function IntegrationsStep(){const{formData,setFormData,updateCommunity,goToNextStep,goToPreviousStep}=useAddProperty();return <section className={setupPanel}><h1 className="text-3xl font-semibold">Plan Your Connections</h1><IntakeFields section="products" value={formData.community.intake} onChange={intake=>updateCommunity({intake})}/><ConnectionFields values={formData.integrations} onChange={integrations=>setFormData({ ...formData, integrations })}/><div className="flex justify-between"><button className={setupButton} onClick={goToPreviousStep}>Back</button><button className={setupPrimary} onClick={goToNextStep}>Continue</button></div></section>}
