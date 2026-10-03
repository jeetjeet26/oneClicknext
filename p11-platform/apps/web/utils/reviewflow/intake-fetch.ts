import {getDataEngineUrl,getDataEngineHeaders} from '@/utils/services/runtime-config'
import {INTAKE_CONTRACT_VERSION,INTAKE_MAX_BYTES} from './intake-parser'
export type SavedIntakeFetch={contractVersion:string;platform:'google'|'yelp';providerId:string;method:'api'|'scraper';url:string;body:Record<string,string|number>}
export type IntakeReceipt={status:'received'|'uncertain'|'blocked';httpStatus?:number;content?:string;receivedAt:string;errorCode?:string}
export function prepareIntakeFetch(source:{platform:string;providerId:string;method:string}):SavedIntakeFetch{
 if(!['google','yelp'].includes(source.platform)||!['api','scraper'].includes(source.method)||(source.platform==='yelp'&&source.method!=='api')||!/^[A-Za-z0-9_-]{1,300}$/.test(source.providerId))throw new Error('Review the saved business identity and retrieval method.')
 const base=new URL(getDataEngineUrl());if(base.username||base.password||base.search||base.hash||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw new Error('The review collection service address requires review.')
 const path=source.platform==='yelp'?'/scraper/yelp-reviews':source.method==='scraper'?'/scraper/google-reviews/full':'/scraper/google-reviews'
 return{contractVersion:INTAKE_CONTRACT_VERSION,platform:source.platform as 'google'|'yelp',providerId:source.providerId,method:source.method as 'api'|'scraper',url:base.toString().replace(/\/$/,'')+path,body:source.platform==='yelp'?{business_id:source.providerId}:{place_id:source.providerId,max_reviews:source.method==='scraper'?100:50}}
}
export async function executeSavedIntakeFetch(input:SavedIntakeFetch,requestId:string):Promise<IntakeReceipt>{
 const at=()=>new Date().toISOString(),blocked=(errorCode:string):IntakeReceipt=>({status:'blocked',errorCode,receivedAt:at()})
 if(process.env.OUTBOUND_DELIVERY_PAUSED==='true')return blocked('execution_paused')
 let current:SavedIntakeFetch;try{current=prepareIntakeFetch(input)}catch{return blocked('service_configuration_changed')}
 if(JSON.stringify(current)!==JSON.stringify(input))return blocked('service_configuration_changed')
 const headers=getDataEngineHeaders();if(!headers['X-API-Key'])return blocked('service_credentials_missing')
 try{
  const res=await fetch(input.url,{method:'POST',headers:{...headers,'x-request-id':requestId},body:JSON.stringify(input.body),signal:AbortSignal.timeout(45000),redirect:'error',cache:'no-store'})
  const reader=res.body?.getReader();let size=0;const chunks:Uint8Array[]=[]
  if(reader){try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>INTAKE_MAX_BYTES){await reader.cancel();return{status:'uncertain',errorCode:'receipt_too_large',receivedAt:at()}}chunks.push(value)}}finally{reader.releaseLock()}}
  const content=Buffer.concat(chunks).toString('utf8');return{status:'received',httpStatus:res.status,content,receivedAt:at()}
 }catch{return{status:'uncertain',errorCode:'source_fetch_uncertain',receivedAt:at()}}
}
