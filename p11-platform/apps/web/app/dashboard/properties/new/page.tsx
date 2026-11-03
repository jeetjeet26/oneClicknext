'use client'
import {AddPropertyProvider,useAddProperty} from './AddPropertyProvider'
import {CommunityStep,ContactsStep,IntegrationsStep,KnowledgeStep,ReviewStep,CompleteStep} from './steps'
import {WizardLayout} from '@/components/onboarding/WizardLayout'
import {setupButton} from '@/components/onboarding/IntakeFields'
function Content(){const{step,createdPropertyId,saveDraft,draftNotice,dirty,error,isLoading}=useAddProperty();return <WizardLayout step={step}>{createdPropertyId&&step!=='complete'&&<div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-300 bg-white p-4 dark:bg-slate-900"><button className={setupButton} disabled={isLoading} onClick={()=>void saveDraft()}>Save draft</button><span role="status">{isLoading?'Saving…':dirty?'Unsaved changes':draftNotice||'Saved setup'}</span></div>}{error&&step!=='review'&&step!=='community'&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}<fieldset disabled={isLoading} className="min-w-0">{step==='community'&&<CommunityStep/>}{step==='contacts'&&<ContactsStep/>}{step==='integrations'&&<IntegrationsStep/>}{step==='knowledge'&&<KnowledgeStep/>}{step==='review'&&<ReviewStep/>}{step==='complete'&&<CompleteStep/>}</fieldset></WizardLayout>}
export default function AddPropertyPage(){return <AddPropertyProvider><Content/></AddPropertyProvider>}
