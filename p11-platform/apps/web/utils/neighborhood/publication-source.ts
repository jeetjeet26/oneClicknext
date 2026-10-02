import type {Tables} from '@/types/supabase'
type Source={items:Tables<'property_points_of_interest'>[];total:number;contentHash:string}
export async function loadNeighborhoodPublicationSource(client:unknown,propertyId:string,orgId:string,expected?:unknown):Promise<Source>{
 const db=client as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
 const {data,error}=await db.rpc('read_neighborhood_publication_source',{p_property_id:propertyId,p_org_id:orgId,...(expected!==undefined?{p_expected:expected}:{})})
 if(error||data?.state!=='ready'||data.propertyId!==propertyId||!Array.isArray(data.items)||typeof data.total!=='number'||typeof data.contentHash!=='string')throw new Error('Approved neighborhood sources changed or could not be verified. Rebuild and review readiness before using them.')
 return {items:data.items as Source['items'],total:data.total,contentHash:data.contentHash}
}
