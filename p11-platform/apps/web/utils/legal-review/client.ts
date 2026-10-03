import type {LegalCommand} from './contracts'
export type PendingLegal={id:string;propertyId:string;hash:string}
export type LegalWrite=LegalCommand extends infer C?C extends {requestId:string}?Omit<C,'requestId'>:never:never
const key=(propertyId:string)=>`p11.legal.pending.v1:${propertyId}`
export function pendingLegal(propertyId:string):PendingLegal|null{try{const p=JSON.parse(sessionStorage.getItem(key(propertyId))||'null');return p?.propertyId===propertyId&&typeof p.id==='string'&&typeof p.hash==='string'?p:null}catch{return null}}
export function clearPendingLegal(propertyId:string,id:string){if(pendingLegal(propertyId)?.id===id)sessionStorage.removeItem(key(propertyId))}
export function legalReviewUrl(propertyId:string,input:Record<string,string|number|undefined>={}){const q=new URLSearchParams({propertyId});for(const[k,v]of Object.entries(input))if(v!==undefined)q.set(k,String(v));return`/api/onboarding/legal?${q}`}
export async function legalReviewFetch(url:string,init?:RequestInit){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'The legal review could not be confirmed.'),{status:response.status});return data}finally{clearTimeout(timer)}}
export async function postLegal(command:LegalWrite){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command))),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),prior=pendingLegal(command.propertyId)
 if(prior&&prior.hash!==hash)throw new Error('Check the earlier legal decision before changing this request.')
 const id=prior?.id||crypto.randomUUID();sessionStorage.setItem(key(command.propertyId),JSON.stringify({id,propertyId:command.propertyId,hash}))
 try{const result=await legalReviewFetch('/api/onboarding/legal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,requestId:id})});if(!['saved','replayed'].includes(result.state)||result.propertyId!==command.propertyId||result.decisionId!==id||typeof result.versionId!=='string'||result.versionId!==(command.operation==='save'?id:'versionId'in command?command.versionId:''))throw new Error('The legal receipt could not be verified. Check its saved decision.');clearPendingLegal(command.propertyId,id);return result}catch(e){if(e instanceof Error&&'status'in e&&[400,403,409,413].includes(Number(e.status)))clearPendingLegal(command.propertyId,id);throw e}
}
