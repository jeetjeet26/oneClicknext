import {randomUUID} from 'node:crypto'
import {createServiceClient} from '@/utils/supabase/admin'
import {decideReadiness,readReadiness} from '@/utils/readiness/store'
import {currentApprovedReadiness} from '@/utils/readiness/publication'
import {readinessCapabilities,type ReadinessCapability} from '@/utils/readiness/contracts'
import type {Tables} from '@/types/supabase'
export {evaluateCapabilityReadiness,evaluateRequiredAssetReadiness,includeAdditionalUrlsInOnboardingPayload,normalizeOnboardingAdditionalUrls} from '@/utils/readiness/evaluator'
export type {OnboardingSnapshotPayload} from '@/utils/readiness/evaluator'
type Client=ReturnType<typeof createServiceClient>
export async function buildOnboardingSnapshot(input:{orgId:string;propertyId:string;userId:string;enabledCapabilities?:string[];requestId?:string;reason?:string},client:Client=createServiceClient()){
 const capabilities=[...new Set(input.enabledCapabilities||[])].sort();if(capabilities.some(v=>!readinessCapabilities.includes(v as ReadinessCapability)))throw new Error('Choose supported readiness capabilities.')
 const result=await decideReadiness(input.userId,{propertyId:input.propertyId,requestId:input.requestId||randomUUID(),operation:'build',enabledCapabilities:capabilities as ReadinessCapability[],reason:input.reason||'Build current readiness evidence for review'},client)
 const detail=await readReadiness(input.userId,input.propertyId,{kind:'snapshot',snapshotId:result.snapshotId},client)
 return detail.snapshot as Tables<'property_onboarding_snapshots'>
}
export async function approveOnboardingSnapshot(input:{orgId:string;propertyId:string;snapshotId:string;userId:string;rationale?:string;allowManagerOverride?:boolean;requestId?:string;snapshotHash?:string;sourceHash?:string;confirmed?:boolean},client:Client=createServiceClient()){
 if(!input.confirmed||!input.requestId||!input.snapshotHash||!input.sourceHash)throw new Error('Open readiness review and explicitly approve the exact saved check before continuing.')
 await decideReadiness(input.userId,{propertyId:input.propertyId,requestId:input.requestId,operation:'approve',snapshotId:input.snapshotId,snapshotHash:input.snapshotHash,sourceHash:input.sourceHash,confirmed:true,allowManagerOverride:input.allowManagerOverride,reason:input.rationale||'Approve this exact current readiness check'},client)
 return(await readReadiness(input.userId,input.propertyId,{kind:'snapshot',snapshotId:input.snapshotId},client)).snapshot as Tables<'property_onboarding_snapshots'>
}
export function getLatestApprovedOnboardingSnapshot(propertyId:string,client:Client=createServiceClient()){return currentApprovedReadiness(propertyId,client)}
