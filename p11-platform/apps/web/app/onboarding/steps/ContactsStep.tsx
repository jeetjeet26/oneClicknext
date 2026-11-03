'use client'
import {useEffect,useRef} from 'react'
import {useOnboarding} from '../components/OnboardingProvider'
import {ContactFields} from '@/components/onboarding/SetupFields'
import {IntakeFields,setupPanel,setupButton,setupPrimary} from '@/components/onboarding/IntakeFields'
export function ContactsStep(){
 const {formData,updateFormData,updateCommunity,addContact,goToNextStep,goToPreviousStep,setError,error}=useOnboarding()
 const seeded=useRef(false)
 useEffect(()=>{if(!seeded.current&&!formData.contacts.length){seeded.current=true;addContact({id:crypto.randomUUID(),type:'primary',name:'',email:'',phone:'',role:''})}},[formData.contacts.length,addContact])
 return <section className={setupPanel}><h1 className="text-3xl font-semibold">Contact Information</h1>{error&&<p role="alert">{error}</p>}<form className="space-y-6" onSubmit={e=>{e.preventDefault();if(!formData.contacts.some(c=>c.type==='primary'&&c.name&&c.email)){setError('Add one primary internal contact with a name and email.');return}setError(null);goToNextStep()}}>
 <IntakeFields section="contacts" value={formData.community.intake} onChange={intake=>updateCommunity({intake})} />
 <ContactFields contacts={formData.contacts} onChange={contacts=>updateFormData('contacts', contacts)} />
 <div className="flex justify-between gap-3"><button type="button" className={setupButton} onClick={goToPreviousStep}>Back</button><button className={setupPrimary}>Continue</button></div></form></section>
}
