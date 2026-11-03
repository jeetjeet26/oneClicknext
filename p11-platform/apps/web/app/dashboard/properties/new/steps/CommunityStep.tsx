'use client'
import {useEffect,useState} from 'react'
import {useAddProperty} from '../AddPropertyProvider'
import {usePropertyContext} from '@/components/layout/PropertyContext'
import {PropertyTemplatePicker} from '@/components/community/PropertyTemplatePicker'
import {createProperty,recoverPendingCreation,acknowledgeCreation} from '@/utils/property-setup/creation-client'
import {creationProfile,type CreationReceipt} from '@/utils/property-setup/creation-contracts'
import {formFromSnapshot} from '@/utils/property-setup/form'
import {CommunityFields} from '@/components/onboarding/SetupFields'
import {setupPanel,setupButton,setupPrimary} from '@/components/onboarding/IntakeFields'
export function CommunityStep(){
 const {refreshProperties}=usePropertyContext()
 const {setSetupHash,setSetupSnapshot,creationTemplate,setCreationTemplate,templatePending,setTemplatePending,setFormData,setStep,formData,updateCommunity,error,setError,goToNextStep,createdPropertyId,setCreatedPropertyId,isLoading,setIsLoading,restoreDraft}=useAddProperty()
 const [recovered,setRecovered]=useState<CreationReceipt|null>(null),[checking,setChecking]=useState(true)
 useEffect(()=>{let active=true;void recoverPendingCreation().then(value=>{if(active)setRecovered(value)}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Saved creation could not be checked.')}).finally(()=>{if(active)setChecking(false)});return()=>{active=false}},[setError])
 async function accept(value:CreationReceipt,resume:boolean){
  setCreatedPropertyId(value.propertyId);setSetupHash(value.snapshotHash);setSetupSnapshot(value.snapshot);setFormData({...formData,...formFromSnapshot(value.snapshot)});setRecovered(null);setError(null)
  await refreshProperties(value.propertyId)
  if(value.property.onboarding_completed_at){acknowledgeCreation(value.requestId);setStep('complete');return}
  if(resume&&await restoreDraft(value.propertyId,value.snapshotHash))return
  setStep(resume?'community':'contacts')
 }
 async function submit(e:React.FormEvent){e.preventDefault();if(isLoading||checking)return;if(createdPropertyId){goToNextStep();return}if(templatePending&&!creationTemplate){setError('Review and accept the selected template, or choose no template.');return}setIsLoading(true);setError(null);try{await accept(await createProperty(creationProfile(formData.community),creationTemplate),false)}catch(e){setError(e instanceof Error?e.message:'Creation is unconfirmed. Retry the same request.')}finally{setIsLoading(false)}}
 return <section className={setupPanel}><h1 className="text-3xl font-semibold">Add New Community</h1><p>Create a working property, then save and resume its setup. Unreviewed data remains separate from launch readiness.</p>{error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}{checking&&<p role="status">Checking saved setup…</p>}{recovered&&!createdPropertyId&&<div className="space-y-3 rounded-xl border border-indigo-300 p-4"><p>Saved property: {recovered.property.name}</p><button className={setupButton} onClick={()=>{setIsLoading(true);void accept(recovered,true).catch(e=>setError(e.message)).finally(()=>setIsLoading(false))}}>Resume saved property</button><button className={setupButton} onClick={()=>{acknowledgeCreation(recovered.requestId);setRecovered(null)}}>Keep the saved property and start another</button></div>}
 <form className="space-y-6" onSubmit={submit}><CommunityFields value={formData.community} onChange={updateCommunity}/>{!createdPropertyId&&<PropertyTemplatePicker onChange={(selection,pending)=>{setCreationTemplate(selection);setTemplatePending(pending)}}/>}<button className={setupPrimary} disabled={checking||isLoading||!formData.community.name.trim()}>Continue</button></form></section>
}
