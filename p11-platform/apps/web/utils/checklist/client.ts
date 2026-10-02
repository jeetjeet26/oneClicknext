import type {ChecklistCommand} from './contracts'
export type PendingChecklist={id:string;propertyId:string;hash:string}
export type ChecklistWrite=ChecklistCommand extends infer C?C extends {requestId:string}?Omit<C,'requestId'>:never:never
const key=(propertyId:string)=>`p11.checklist.pending.v1:${propertyId}`
export function pendingChecklist(propertyId:string):PendingChecklist|null{try{const p=JSON.parse(sessionStorage.getItem(key(propertyId))||'null');return p?.propertyId===propertyId&&typeof p.id==='string'&&typeof p.hash==='string'?p:null}catch{return null}}
export function clearPendingChecklist(propertyId:string,id:string){if(pendingChecklist(propertyId)?.id===id)sessionStorage.removeItem(key(propertyId))}
export function checklistUrl(propertyId:string,input:Record<string,string|number|undefined>={}){const q=new URLSearchParams({propertyId});for(const[k,v]of Object.entries(input))if(v!==undefined)q.set(k,String(v));return`/api/community/tasks?${q}`}
export async function checklistFetch(url:string,init?:RequestInit){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'The checklist could not be confirmed.'),{status:response.status});return data}finally{clearTimeout(timer)}}
export async function postChecklist(command:ChecklistWrite){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command))),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),prior=pendingChecklist(command.propertyId)
 if(prior&&prior.hash!==hash)throw new Error('Check the earlier checklist decision before changing this request.')
 const id=prior?.id||crypto.randomUUID();sessionStorage.setItem(key(command.propertyId),JSON.stringify({id,propertyId:command.propertyId,hash}))
 try{const result=await checklistFetch('/api/community/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,requestId:id})});if(!['saved','replayed'].includes(result.state)||result.propertyId!==command.propertyId||result.decisionId!==id)throw new Error('The checklist receipt could not be verified. Check its saved decision.');clearPendingChecklist(command.propertyId,id);return result}catch(e){if(e instanceof Error&&'status'in e&&[400,403,409,413].includes(Number(e.status)))clearPendingChecklist(command.propertyId,id);throw e}
}
