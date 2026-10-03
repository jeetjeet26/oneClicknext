import type {createServiceClient} from '@/utils/supabase/admin'
export async function lumaEvidenceRpc(db:ReturnType<typeof createServiceClient>,name:string,args:Record<string,unknown>){
 return(db as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>}).rpc(name,args)
}
