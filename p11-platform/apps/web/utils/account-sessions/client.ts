import {teamFetch} from '@/utils/team/client'
import type {SessionReceipt} from './contracts'
export {teamFetch as sessionFetch}
export type PendingSession={id:string;scope:'local'|'others';sourceHash:string}
const key=(actor:string)=>'p11.account-sessions.pending.v1:'+actor
export function pendingSession(actor:string):PendingSession|null{try{const r=JSON.parse(sessionStorage.getItem(key(actor))||'null');return typeof r?.id==='string'&&['local','others'].includes(r.scope)&&typeof r.sourceHash==='string'?r:null}catch{return null}}
export function clearPendingSession(actor:string,id:string){if(pendingSession(actor)?.id===id)sessionStorage.removeItem(key(actor))}
export function sessionUrl(input:Record<string,string|number|undefined>={}){const q=new URLSearchParams();for(const[k,v]of Object.entries(input))if(v!==undefined)q.set(k,String(v));return'/api/account/sessions?'+q}
export async function postSession(actor:string,scope:'local'|'others',sourceHash:string,id:string=crypto.randomUUID()){
 if(pendingSession(actor))throw new Error('Check your earlier session request before starting another.')
 sessionStorage.setItem(key(actor),JSON.stringify({id,scope,sourceHash}))
 try{const r:SessionReceipt=await teamFetch('/api/account/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:id,operation:'revoke',scope,sourceHash,confirmed:true})});if(r.actorId!==actor||r.requestId!==id)throw new Error('The session receipt does not match your account.');if(['acknowledged','rejected','cancelled','observed'].includes(r.status))clearPendingSession(actor,id);return r}catch(e){if(e instanceof Error&&'status'in e&&[400,409,413].includes(Number(e.status)))clearPendingSession(actor,id);throw e}
}
export async function recoverSession(actor:string,id:string,operation:'check'|'cancel_unused'){
 const r:SessionReceipt=await teamFetch('/api/account/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,requestId:id})})
 if(r.actorId!==actor||r.requestId!==id)throw new Error('The session receipt does not match your account.')
 if(['acknowledged','rejected','cancelled','observed'].includes(r.status))clearPendingSession(actor,id)
 return r
}
