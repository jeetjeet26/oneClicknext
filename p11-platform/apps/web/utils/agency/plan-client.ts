import {planReceipt,type PlanInput} from './plans'
import {agencyFetch} from './client'
import type {AgencyProduct} from './contracts'
export type PendingPlan={id:string;propertyId:string;product:AgencyProduct;hash:string}
const key=(propertyId:string,product:string)=>`p11.agency.plan.v1:${propertyId}:${product}`
export function pendingPlan(propertyId:string,product:AgencyProduct):PendingPlan|null{try{const p=JSON.parse(sessionStorage.getItem(key(propertyId,product))||'null');return p?.propertyId===propertyId&&p?.product===product&&typeof p.id==='string'&&typeof p.hash==='string'?p:null}catch{return null}}
function clear(p:PendingPlan){if(pendingPlan(p.propertyId,p.product)?.id===p.id)sessionStorage.removeItem(key(p.propertyId,p.product))}
export function planUrl(propertyId:string,product:string,input:Record<string,string>={}){return `/api/agency/plans?${new URLSearchParams({propertyId,product,...input})}`}
function verified(data:unknown,p:PendingPlan){const r=planReceipt.parse(data);if(r.propertyId!==p.propertyId||r.product!==p.product||r.decisionId!==p.id||r.record.id!==p.id||r.record.property_id!==p.propertyId||r.record.product!==p.product)throw new Error('The receipt does not match this plan. Check the saved request.');clear(p);return r}
export async function postPlan(command:PlanInput){
 if(pendingPlan(command.propertyId,command.product))throw new Error('Check the earlier plan request before starting another.')
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command))),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
 const p={id:crypto.randomUUID(),propertyId:command.propertyId,product:command.product,hash};sessionStorage.setItem(key(p.propertyId,p.product),JSON.stringify(p))
 try{return verified(await agencyFetch('/api/agency/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,requestId:p.id})}),p)}
 catch(e){if(e instanceof Error&&'status'in e&&[400,403,409,413].includes(Number(e.status)))clear(p);throw e}
}
export async function recoverPlan(p:PendingPlan,closeUnused=false){const result=closeUnused?await agencyFetch('/api/agency/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId:p.propertyId,product:p.product,requestId:p.id,operation:'cancel_unused',inputHash:p.hash})}):await agencyFetch(planUrl(p.propertyId,p.product,{kind:'decision',decisionId:p.id}));return verified(result,p)}
