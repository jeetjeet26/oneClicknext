import {z}from 'zod'
import {createServiceClient}from '@/utils/supabase/admin'
import {brandId}from '@/utils/brandforge/operations'
const cursorSchema=z.object({id:brandId,createdAt:z.iso.datetime({offset:true}),leadId:brandId,kind:z.enum(['schedule','reminder','workflow'])}).strict()
export class DeliveryHistoryError extends Error{constructor(message:string,readonly status:number){super(message)}}
export async function readLeadDeliveryHistory(input:{leadId:string;propertyId:string;actorId:string;kind:'schedule'|'reminder'|'workflow';cursor:string|null},client=createServiceClient()){
 let cursor:z.infer<typeof cursorSchema>|null=null
 if(input.cursor){try{if(input.cursor.length>1024)throw new Error('Large cursor');cursor=cursorSchema.parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString()));if(cursor.leadId!==input.leadId||cursor.kind!==input.kind)throw new Error('Changed scope')}catch{throw new DeliveryHistoryError('Reload this lead’s history to restart paging.',400)}}
 const db=client as unknown as{rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:{state:string;work:unknown[];total:number;nextCursor:unknown}|null;error:unknown}>}
 const{data,error}=await db.rpc('read_lead_delivery_history',{p_property_id:input.propertyId,p_lead_id:input.leadId,p_actor_id:input.actorId,p_kind:input.kind,p_cursor:cursor})
 if(error||!data)throw new DeliveryHistoryError('Delivery history could not be loaded. Try again.',503)
 if(data.state!=='ready')throw new DeliveryHistoryError(data.state==='forbidden'?'Forbidden':'Lead history not found.',data.state==='forbidden'?403:404)
 return{work:data.work,total:data.total,nextCursor:data.nextCursor?Buffer.from(JSON.stringify(data.nextCursor)).toString('base64url'):null}
}
