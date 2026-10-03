import type {MaterialCommand} from './material-contracts'
export type PendingKnowledge={id:string;propertyId:string;materialId:string;operation:string;hash:string}
const key=(propertyId:string)=>`p11.knowledge.pending.v1:${propertyId}`
export function pendingKnowledge(propertyId:string):PendingKnowledge|null{try{const value=JSON.parse(sessionStorage.getItem(key(propertyId))||'null');return value?.propertyId===propertyId&&typeof value.id==='string'&&typeof value.materialId==='string'&&typeof value.hash==='string'?value:null}catch{return null}}
export function clearPendingKnowledge(propertyId:string,id:string){if(pendingKnowledge(propertyId)?.id===id)sessionStorage.removeItem(key(propertyId))}
export async function knowledgeFetch(url:string,init?:RequestInit){const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),90000);try{const response=await fetch(url,{...init,cache:'no-store',signal:abort.signal}),data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'Knowledge could not be confirmed.'),{status:response.status});return data}finally{clearTimeout(timer)}}
export async function postKnowledge(command:Omit<MaterialCommand,'requestId'>,materialId?:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command))),hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''),prior=pendingKnowledge(command.propertyId)
 if(prior&&prior.hash!==hash)throw new Error('A previous decision is unconfirmed. Check its saved result before changing this request.')
 const id=prior?.id||crypto.randomUUID(),pending:PendingKnowledge={id,hash,propertyId:command.propertyId,materialId:materialId||id,operation:command.operation}
 // Store identifiers and an input digest only; source text never enters browser storage.
 sessionStorage.setItem(key(command.propertyId),JSON.stringify(pending))
 try{const data=await knowledgeFetch('/api/knowledge/materials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,requestId:id})});if(!['saved','replayed'].includes(data.state)||data.materialId!==pending.materialId)throw new Error('The save receipt could not be verified. Check the saved decision.');clearPendingKnowledge(command.propertyId,id);return data}catch(e){if(e instanceof Error&&'status'in e&&[400,403,409,413].includes(Number(e.status)))clearPendingKnowledge(command.propertyId,id);throw e}
}
export function knowledgeUrl(propertyId:string,input:Record<string,string|number|undefined>={}){const query=new URLSearchParams({propertyId});for(const[k,v]of Object.entries(input))if(v!==undefined)query.set(k,String(v));return `/api/knowledge/materials?${query}`}
