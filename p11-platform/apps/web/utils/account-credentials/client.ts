import {teamFetch} from '@/utils/team/client'
import type {CredentialReceipt} from './contracts'
export {teamFetch as credentialFetch}
const key=(actor:string)=>'p11.account-credentials.pending.v1:'+actor
export function pendingCredential(actor:string):string|null{try{const r=JSON.parse(sessionStorage.getItem(key(actor))||'null');return typeof r?.id==='string'?r.id:null}catch{return null}}
export function clearCredential(actor:string,id:string){if(pendingCredential(actor)===id)sessionStorage.removeItem(key(actor))}
export function credentialUrl(input:Record<string,string|number|undefined>={}){const q=new URLSearchParams();for(const[k,v]of Object.entries(input))if(v!==undefined)q.set(k,String(v));return'/api/account/credentials?'+q}
function accept(actor:string,id:string,r:CredentialReceipt){if(r.actorId!==actor||r.requestId!==id)throw new Error('The password receipt does not match your account.');if(['confirmed','cancelled','rejected','verification_failed'].includes(r.status))clearCredential(actor,id);return r}
export async function postCredential(actor:string,sourceHash:string,currentPassword:string,newPassword:string,recovery=false){
 if(pendingCredential(actor))throw new Error('Check or cancel the earlier password request first.')
 const id=crypto.randomUUID();sessionStorage.setItem(key(actor),JSON.stringify({id}))
 try{return accept(actor,id,await teamFetch('/api/account/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:recovery?'reset':'change',requestId:id,sourceHash,...(recovery?{}:{currentPassword}),newPassword,confirmed:true})}))}catch(e){if(e instanceof Error&&'status'in e&&[400,409,413,429].includes(Number(e.status)))clearCredential(actor,id);throw e}
}
export async function recoverCredential(actor:string,id:string,operation:'check'|'cancel'){return accept(actor,id,await teamFetch('/api/account/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,requestId:id})}))}
