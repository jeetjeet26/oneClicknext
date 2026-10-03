'use client'

type Observation={id:string;episodeId:string;propertyId:string;expectedActorId:string;path:string}
const pending=new Map<string,{event:Observation;failed:boolean}>()
const listeners=new Set<()=>void>()
const dropped=new Map<string,number>()
let failures=0
function changed(){failures=Array.from(pending.values()).filter(p=>p.failed).length;for(const fn of listeners)fn()}
export const subscribeObservations=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
export const failedObservations=(actorId?:string)=>actorId?Array.from(pending.values()).filter(p=>p.failed&&p.event.expectedActorId===actorId).length:failures
export const droppedObservations=(actorId:string)=>dropped.get(actorId)||0
export const serverObservations=()=>0
async function send(event:Observation) {
 const item=pending.get(event.id);if(!item)return
 item.failed=false;changed()
 for(let attempt=0;attempt<3;attempt++) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
  try {
   const response=await fetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),signal:controller.signal})
   const result=await response.json()
   if(response.ok&&['recorded','replayed'].includes(result.state)&&result.eventId===event.id){pending.delete(event.id);changed();return}
   if(response.status>=400&&response.status<500)break
  }catch{/* Keep the identity for an unconfirmed response. */}finally{clearTimeout(timer)}
  if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)))
 }
 item.failed=true;changed()
}
export function recordPageObservation(event:Observation) {
 if(pending.has(event.id))return
 if(pending.size>=100){dropped.set(event.expectedActorId,(dropped.get(event.expectedActorId)||0)+1);changed();return}
 pending.set(event.id,{event,failed:false});void send(event)
}
export function retryObservations(actorId:string) {
 for(const {event,failed} of pending.values())if(failed&&event.expectedActorId===actorId)void send(event)
}
