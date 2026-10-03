import type {WebPolicyCommand} from './web-policy-contracts'
import {webRpc,webExecutionStatus,runWebCapture} from './web-store'
export async function readWebPolicy(actor:string,propertyId:string,input:Record<string,unknown>){return{...await webRpc('read_knowledge_web_policy',{p_property_id:propertyId,p_actor_id:actor,p_input:input}),execution:webExecutionStatus()}}
export async function decideWebPolicy(actor:string,command:WebPolicyCommand){const{requestId,propertyId,operation,...input}=command;return webRpc(operation==='save'?'save_knowledge_web_policy':'cancel_unused_knowledge_decision',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_input:input})}
export async function checkScheduledWebsites(){
 if(webExecutionStatus().paused)return{state:'paused',scheduled:0,ready:0,unconfirmed:0,results:[]}
 const batch=await webRpc('dispatch_knowledge_web_checks',{p_limit:5})
 if(!Array.isArray(batch.requests)||batch.requests.length>5)throw new Error('The website batch could not be verified.')
 const results:Array<{captureId:string;propertyId:string;state:string}>=[]
 for(const item of batch.requests){
  let state='unconfirmed'
  try{const result=await runWebCapture(item.id);state=String(result.state)}catch{/* The retained request is recovered explicitly; never dispatch a replacement. */}
  results.push({captureId:item.id,propertyId:item.propertyId,state})
 }
 const ready=results.filter(r=>r.state==='ready').length,unconfirmed=results.filter(r=>r.state==='unconfirmed'||r.state==='running').length
 return{state:results.some(r=>r.state!=='ready')?'review_required':'ready',scheduled:results.length,ready,unconfirmed,results}
}
