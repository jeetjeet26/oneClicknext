'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import {draftFromForm,formFromDraft,organizationDraft,validateCompleteDraft,type OrganizationWorkspace} from '@/utils/property-setup/organization-contracts'
import {clearPendingOrganization,pendingOrganization,postOrganization,organizationUrl,type PendingOrganization} from '@/utils/property-setup/organization-client'
import {knowledgeFetch} from '@/utils/knowledge/material-client'
import { 
  OnboardingContextType, 
  OnboardingFormData, 
  OnboardingStep, 
  OrganizationData,
  CommunityData,
  ContactData,
  IntegrationData,
  IntegrationPlatform,
  UploadedDocument,
  STEPS_ORDER
} from '../types'

const initialFormData: OnboardingFormData = {
  organization: {
    name: '',
    type: '',
    legalName: ''
  },
  community: {
    name: '',
    type: '',
    address: { street: '', city: '', state: '', zip: '' },
    websiteUrl: '',
    additionalUrls: [],
    unitCount: '',
    yearBuilt: '',
    amenities: []
  },
  contacts: [],
  integrations: [],
  documents: [],
  websiteScrapeResult: undefined
}

type Context=OnboardingContextType&{workspace:OrganizationWorkspace|null;pending:PendingOrganization|null;notice:string;saveDraft:(step?:OnboardingStep)=>Promise<{revision:number;draftHash:string}|null>;reloadDraft:()=>Promise<void>;recoverDecision:(cancel?:boolean)=>Promise<void>;completeSetup:()=>Promise<void>;loadHistory:()=>Promise<void>;selectedHistory:Record<string,unknown>|null;readDecision:(id:string)=>Promise<void>}
const OnboardingContext = createContext<Context | undefined>(undefined)

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<OnboardingStep>('organization')
  const [formData, setFormData] = useState<OnboardingFormData>(initialFormData)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const[workspace,setWorkspace]=useState<OrganizationWorkspace|null>(null),[pending,setPending]=useState<PendingOrganization|null>(null),[notice,setNotice]=useState(''),[selectedHistory,setSelectedHistory]=useState<Record<string,unknown>|null>(null)
  const mounted=useRef(false),loadSequence=useRef(0)
  const loadWorkspace=useCallback(async()=>{const token=++loadSequence.current;const value=await knowledgeFetch(organizationUrl())as OrganizationWorkspace;if(!value.actorId||!Array.isArray(value.items))throw new Error('The saved setup could not be verified.');if(value.setup)value.setup.draft=organizationDraft.parse(value.setup.draft);if(!mounted.current||token!==loadSequence.current)return value;setWorkspace(value);setPending(pendingOrganization(value.actorId));setSelectedHistory(null);if(value.setup){setFormData(formFromDraft(value.setup.draft));setStep(value.setup.state==='completed'?'complete':value.setup.draft.step)}return value},[])
  useEffect(()=>{let active=true;mounted.current=true;setIsLoading(true);loadWorkspace().catch(e=>{if(active&&mounted.current){setWorkspace(null);setError(e instanceof Error?e.message:'Saved setup is unavailable.')}}).finally(()=>{if(active&&mounted.current)setIsLoading(false)});return()=>{active=false;mounted.current=false}},[loadWorkspace])
  async function reloadDraft(){setIsLoading(true);setError(null);setWorkspace(null);try{await loadWorkspace()}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Saved setup is unavailable.')}finally{if(mounted.current)setIsLoading(false)}}
  async function saveDraft(nextStep:OnboardingStep=step){if(!workspace||workspace.alreadyMember||workspace.setup?.state==='completed'||pending)return null;setIsLoading(true);setError(null);setNotice('');let wrote=false;try{const draft=draftFromForm(formData,nextStep,workspace.setup?.draft),result=await postOrganization(workspace.actorId,{operation:'save',expectedRevision:workspace.setup?.revision??0,draft,reason:`Save first-time setup draft at ${nextStep}`});wrote=true;if(!mounted.current)return null;setPending(null);setNotice('Setup draft saved privately. Your organization has not been created yet.');const current=await loadWorkspace();if(current.setup?.revision!==result.revision)throw new Error('The saved setup changed again. Review its current version before continuing.');return{revision:Number(result.revision),draftHash:String(result.draftHash)}}catch(e){if(mounted.current){if(wrote)setWorkspace(null);setError(e instanceof Error?e.message:'Setup save could not be confirmed.');setPending(pendingOrganization(workspace.actorId))}return null}finally{if(mounted.current)setIsLoading(false)}}
  async function recoverDecision(cancel=false){if(!pending)return;setIsLoading(true);setError(null);try{const value=cancel?await knowledgeFetch('/api/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:pending.id,operation:'cancel_unused',inputHash:pending.hash,reason:'Cancel only unused first-time setup decision after checking saved state'})}):await knowledgeFetch(organizationUrl({decisionId:pending.id}));const result=value.result||value;if(result.decisionId!==pending.id)throw new Error('The retained setup decision did not match.');if(!mounted.current)return;clearPendingOrganization(pending.actorId,pending.id);setPending(null);setNotice(result.cancelled?'Unused setup decision cancelled. A delayed copy cannot save.':'Saved setup decision recovered.');await loadWorkspace()}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Setup recovery could not be confirmed.')}finally{if(mounted.current)setIsLoading(false)}}
  async function completeSetup(){if(!workspace||pending)return;try{validateCompleteDraft(draftFromForm(formData,'review',workspace.setup?.draft))}catch(e){setError(e instanceof Error?e.message:'Review the complete setup.');return}const saved=await saveDraft('review');if(!saved||!mounted.current)return;setIsLoading(true);setError(null);try{const result=await postOrganization(workspace.actorId,{operation:'complete',expectedRevision:saved.revision,draftHash:saved.draftHash,confirmed:true,reason:'Confirm reviewed organization, first property, contacts and connection plans'});if(result.completed!==true)throw new Error('The setup completion receipt could not be verified.');if(!mounted.current)return;setNotice('Organization and first property saved together. Knowledge and connections still need review.');setPending(null);await loadWorkspace()}catch(e){if(mounted.current){setError(e instanceof Error?e.message:'Setup completion could not be confirmed.');setPending(pendingOrganization(workspace.actorId))}}finally{if(mounted.current)setIsLoading(false)}}
  async function loadHistory(){if(!workspace||workspace.nextOffset===null)return;setIsLoading(true);setError(null);try{const next=await knowledgeFetch(organizationUrl({offset:workspace.nextOffset,expectedHash:workspace.historyHash}))as OrganizationWorkspace;if(mounted.current)setWorkspace({...next,items:[...workspace.items,...next.items]})}catch(e){if(mounted.current){setError(e instanceof Error?e.message:'Setup history is unavailable.');setWorkspace(null)}}finally{if(mounted.current)setIsLoading(false)}}
  async function readDecision(id:string){setIsLoading(true);setError(null);setSelectedHistory(null);try{const value=await knowledgeFetch(organizationUrl({decisionId:id}));if(mounted.current)setSelectedHistory(value.decision)}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Setup decision is unavailable.')}finally{if(mounted.current)setIsLoading(false)}}


  const updateFormData = useCallback(<K extends keyof OnboardingFormData>(
    section: K, 
    data: OnboardingFormData[K]
  ) => {
    setFormData(prev => ({ ...prev, [section]: data }))
  }, [])

  const updateOrganization = useCallback((data: Partial<OrganizationData>) => {
    setFormData(prev => ({
      ...prev,
      organization: { ...prev.organization, ...data }
    }))
  }, [])

  const updateCommunity = useCallback((data: Partial<CommunityData>) => {
    setFormData(prev => ({
      ...prev,
      community: { ...prev.community, ...data }
    }))
  }, [])

  const addContact = useCallback((contact: ContactData) => {
    setFormData(prev => contact.type==='primary'&&prev.contacts.some(c=>c.type==='primary')?prev:({
      ...prev,
      contacts: [...prev.contacts, contact]
    }))
  }, [])

  const updateContact = useCallback((id: string, data: Partial<ContactData>) => {
    setFormData(prev => ({
      ...prev,
      contacts: prev.contacts.map(c => c.id === id ? { ...c, ...data } : c)
    }))
  }, [])

  const removeContact = useCallback((id: string) => {
    setFormData(prev => ({
      ...prev,
      contacts: prev.contacts.filter(c => c.id !== id)
    }))
  }, [])

  const updateIntegration = useCallback((platform: IntegrationPlatform, data: Partial<IntegrationData>) => {
    setFormData(prev => {
      const existing = prev.integrations.find(i => i.platform === platform)
      if (existing) {
        return {
          ...prev,
          integrations: prev.integrations.map(i => 
            i.platform === platform ? { ...i, ...data } : i
          )
        }
      } else {
        return {
          ...prev,
          integrations: [...prev.integrations, {
            platform,
            status: 'pending',
            accountId: '',
            accountName: '',
            notes: '',
            ...data
          }]
        }
      }
    })
  }, [])

  const addDocument = useCallback((doc: UploadedDocument) => {
    setFormData(prev => ({
      ...prev,
      documents: [...prev.documents, doc]
    }))
  }, [])

  const updateDocument = useCallback((id: string, data: Partial<UploadedDocument>) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.map(d => d.id === id ? { ...d, ...data } : d)
    }))
  }, [])

  const removeDocument = useCallback((id: string) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.filter(d => d.id !== id)
    }))
  }, [])

  const canProceed = useCallback(() => {
    switch (step) {
      case 'organization':
        return formData.organization.name.trim().length > 0
      case 'community':
        return formData.community.name.trim().length > 0
      case 'contacts':
        // At least one primary contact required
        return formData.contacts.some(c => c.type === 'primary' && c.name && c.email)
      case 'integrations':
        // Integrations are optional, can always proceed
        return true
      case 'knowledge':
        // Documents are optional, can always proceed
        return true
      case 'review':
        return true
      default:
        return true
    }
  }, [step, formData])

  function goToNextStep(){const i=STEPS_ORDER.indexOf(step);if(i<STEPS_ORDER.length-2)void saveDraft(STEPS_ORDER[i+1])}
  function goToPreviousStep(){const i=STEPS_ORDER.indexOf(step);if(i>0)void saveDraft(STEPS_ORDER[i-1])}

  const value: Context = {
    workspace,pending,notice,saveDraft,reloadDraft,recoverDecision,completeSetup,loadHistory,selectedHistory,readDecision,
    step,
    setStep,
    formData,
    updateFormData,
    updateOrganization,
    updateCommunity,
    addContact,
    updateContact,
    removeContact,
    updateIntegration,
    addDocument,
    updateDocument,
    removeDocument,
    isLoading,
    setIsLoading,
    error,
    setError,
    canProceed,
    goToNextStep,
    goToPreviousStep
  }

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const context = useContext(OnboardingContext)
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider')
  }
  return context
}

