'use client'
import Link from 'next/link'
import {useRef,useState} from 'react'
import {useAddProperty} from '../AddPropertyProvider'
import {acknowledgeCreation} from '@/utils/property-setup/creation-client'
import {savePropertySetup} from '@/utils/property-setup/client'
import {snapshotFromForm} from '@/utils/property-setup/form'
import {SetupSummary} from '@/components/onboarding/SetupSummary'
import {setupPanel,setupButton,setupPrimary} from '@/components/onboarding/IntakeFields'
export function ReviewStep(){
 const {setupHash,setupSnapshot,formData,setStep,setIsLoading,error,setError,createdPropertyId,saveDraft}=useAddProperty()
 const [submitting,setSubmitting]=useState(false)
 const preparedSnapshot=useRef<string|null>(null)
 const snapshot=snapshotFromForm(formData,setupSnapshot)
 async function complete(){if(submitting)return;const key=JSON.stringify(snapshot);if(preparedSnapshot.current!==key){if(!await saveDraft('review'))return;preparedSnapshot.current=key}setSubmitting(true);setIsLoading(true);setError(null);try{if(!createdPropertyId||!setupHash)throw new Error('Recover the saved property before completing setup.');await savePropertySetup(createdPropertyId,{...snapshot,expectedHash:setupHash,reason:'Complete reviewed property setup'},true);acknowledgeCreation(createdPropertyId);setStep('complete')}catch(e){setError(e instanceof Error?e.message:'Completion could not be confirmed.')}finally{setSubmitting(false);setIsLoading(false)}}
 return <section className={setupPanel}><h1 className="text-3xl font-semibold">Review &amp; Finish Setup</h1><p>Saving creates your setup record and relevant tasks. Reviews, connections, and publication remain separate decisions.</p>{error&&<div role="alert" className="space-y-3 rounded-lg bg-red-50 p-3 text-red-800"><p>{error}</p>{createdPropertyId&&<Link className="underline" href={`/dashboard/properties/${createdPropertyId}/edit`} target="_blank">Inspect saved property and history</Link>}<button className={setupButton} onClick={()=>{if(window.confirm('Reload the saved setup? Unsaved changes on this page will be discarded.'))window.location.reload()}}>Reload saved setup</button></div>}<SetupSummary snapshot={snapshot}/><nav aria-label="Edit setup sections" className="flex flex-wrap gap-2">{(['community','contacts','integrations','knowledge']as const).map(step=><button key={step} className={setupButton} onClick={()=>void saveDraft(step)}>Edit {step==='knowledge'?'sources':step}</button>)}</nav><button className={setupPrimary} disabled={submitting} onClick={()=>void complete()}>{submitting?'Saving…':'Add Property'}</button></section>
}
