import {receiptSchema,type ReviewInput} from './contracts'
export type PendingReview={id:string;propertyId:string;hash:string}
const key=(propertyId:string)=>`p11.agency.review.v1:${propertyId}`
export function pendingReview(propertyId:string):PendingReview|null{try{const p=JSON.parse(sessionStorage.getItem(key(propertyId))||'null');return p?.propertyId===propertyId&&typeof p.id==='string'&&typeof p.hash==='string'?p:null}catch{return null}}
export function clearPendingReview(propertyId:string,id:string){if(pendingReview(propertyId)?.id===id)sessionStorage.removeItem(key(propertyId))}
export function agencyUrl(propertyId:string,input:Record<string,string>={}){return `/api/agency/observation?${new URLSearchParams({propertyId,...input})}`}
export async function agencyFetch(url:string,init?:RequestInit){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000)
 try{const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'The review could not be confirmed.'),{status:response.status});return data}finally{clearTimeout(timer)}
}
function verified(data:unknown,propertyId:string,id:string){const r=receiptSchema.parse(data);if(r.propertyId!==propertyId||r.decisionId!==id||r.record.id!==id||r.record.property_id!==propertyId)throw new Error('The receipt does not match this review. Check the saved request.');clearPendingReview(propertyId,id);return r}
export async function postReview(command:ReviewInput){
 if(pendingReview(command.propertyId))throw new Error('Check the earlier review before starting another.')
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command))),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
 const id=crypto.randomUUID();sessionStorage.setItem(key(command.propertyId),JSON.stringify({id,propertyId:command.propertyId,hash}))
 try{return verified(await agencyFetch('/api/agency/observation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,requestId:id})}),command.propertyId,id)}
 catch(e){if(e instanceof Error&&'status'in e&&[400,403,409,413].includes(Number(e.status)))clearPendingReview(command.propertyId,id);throw e}
}
export async function recoverReview(pending:PendingReview,closeUnused=false){
 const result=closeUnused?await agencyFetch('/api/agency/observation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId:pending.propertyId,requestId:pending.id,operation:'cancel_unused',inputHash:pending.hash})}):await agencyFetch(agencyUrl(pending.propertyId,{kind:'decision',decisionId:pending.id}))
 return verified(result,pending.propertyId,pending.id)
}
