import type {ReadinessCommand} from './contracts'
export type PendingReadiness={id:string;propertyId:string;hash:string}
export type ReadinessWrite=ReadinessCommand extends infer C?C extends {requestId:string}?Omit<C,'requestId'>:never:never
const key=(propertyId:string)=>`p11.readiness.pending.v1:${propertyId}`
export function pendingReadiness(propertyId:string):PendingReadiness|null{try{const p=JSON.parse(sessionStorage.getItem(key(propertyId))||'null');return p?.propertyId===propertyId&&typeof p.id==='string'&&typeof p.hash==='string'?p:null}catch{return null}}
export function clearPendingReadiness(propertyId:string,id:string){if(pendingReadiness(propertyId)?.id===id)sessionStorage.removeItem(key(propertyId))}
export function readinessReviewUrl(propertyId:string,input:Record<string,string|number|undefined>={}){const q=new URLSearchParams({propertyId});for(const[k,v]of Object.entries(input))if(v!==undefined)q.set(k,String(v));return`/api/onboarding/readiness?${q}`}
export async function readinessReviewFetch(url:string,init?:RequestInit){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'The readiness review could not be confirmed.'),{status:response.status});return data}finally{clearTimeout(timer)}}
export async function postReadiness(command:ReadinessWrite){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command))),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),prior=pendingReadiness(command.propertyId)
 if(prior&&prior.hash!==hash)throw new Error('Check the earlier readiness decision before changing this request.')
 const id=prior?.id||crypto.randomUUID();sessionStorage.setItem(key(command.propertyId),JSON.stringify({id,propertyId:command.propertyId,hash}))
 try{const result=await readinessReviewFetch('/api/onboarding/readiness',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,requestId:id})});if(!['saved','replayed'].includes(result.state)||result.propertyId!==command.propertyId||result.decisionId!==id||typeof result.snapshotId!=='string'||'snapshotId'in command&&result.snapshotId!==command.snapshotId)throw new Error('The readiness receipt could not be verified. Check its saved decision.');clearPendingReadiness(command.propertyId,id);return result}catch(e){if(e instanceof Error&&'status'in e&&[400,403,409,413].includes(Number(e.status)))clearPendingReadiness(command.propertyId,id);throw e}
}
