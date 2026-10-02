import {createServiceClient} from '@/utils/supabase/admin'
import type {Tables} from '@/types/supabase'
export async function currentApprovedReadiness(propertyId:string,client:unknown=createServiceClient(),snapshotId?:string,contentHash?:string){
 const db=client as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc('readiness_publication_snapshot',{p_property_id:propertyId,...(snapshotId?{p_snapshot_id:snapshotId}:{}),...(contentHash?{p_content_hash:contentHash}:{})})
 if(error||!data)throw new Error('Current readiness evidence could not be verified.')
 if(data.state!=='ready')return null
 if(data.propertyId!==propertyId||!data.snapshot||typeof data.snapshot!=='object')throw new Error('The readiness source does not match this property.')
 return data.snapshot as Tables<'property_onboarding_snapshots'>
}
export async function requireCurrentReadiness(propertyId:string,snapshotId:string,contentHash:string,client:unknown=createServiceClient()){
 const snapshot=await currentApprovedReadiness(propertyId,client,snapshotId,contentHash)
 if(!snapshot)throw new Error('Pinned readiness is unavailable or changed. Build and explicitly review current readiness before continuing.')
 return snapshot
}
