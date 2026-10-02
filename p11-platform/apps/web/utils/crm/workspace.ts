import {createAdminClient} from '@/utils/supabase/admin'
export const CRM_PLATFORMS = ['crm','yardi','realpage','salesforce','hubspot','lasso'] as const
export async function crmRpc(name:string,args:Record<string,unknown>):Promise<Record<string,unknown>> {
 const client=createAdminClient()
 const rpcClient = client as unknown as {rpc: (name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await rpcClient.rpc(name,args)
 if(error || !data || typeof data!=='object' || Array.isArray(data))throw new Error('CRM result could not be confirmed')
 return data
}
/** Never return a stored token or secret in a connection DTO. */
export function publicIntegration<T extends {credentials?:unknown}>(row:T) {
 const {credentials,...safe}=row
 const saved=row as unknown as Record<string,unknown>
 const qualified=(CRM_PLATFORMS as readonly string[]).includes(String(saved.platform))?{mapping_validated:!!saved.mapping_validated&&!!saved.crm_approved_review_id&&!!saved.crm_validation_receipt_id}:{}
 return {...safe,...qualified,hasCredentials:!!credentials && typeof credentials==='object' && Object.keys(credentials).length>0}
}
