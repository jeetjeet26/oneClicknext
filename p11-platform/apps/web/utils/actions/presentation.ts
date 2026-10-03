import type {Json} from '@/types/supabase'
export function activityActorLabel(event:{actor_id:string|null;service_principal?:string|null;action:string;request:Json},currentActor:string):string {
 if(event.service_principal==='knowledge.files')return 'Private file processing'
 if(event.service_principal==='knowledge.embedding')return 'Knowledge search preparation'
 if(event.service_principal==='reviewflow.analysis')return 'Review analysis service'
 if(event.service_principal==='reviewflow.batch')return 'Review analysis queue'
 if(event.service_principal==='reviewflow.intake')return 'Review import service'
 if(event.service_principal)return 'System service'
 const request=event.request&&typeof event.request==='object'&&!Array.isArray(event.request)?event.request:{}
 if((typeof event.action==='string'&&event.action.startsWith('integration.authorization.'))||event.action==='integration.account.replaced'){
  if(request.decisionSource==='expiry_sweep')return 'System cleanup · request initiated by '+(event.actor_id===currentActor?'you':'a team member')
  if(request.authorizer==='external_account')return request.decisionSource==='request_validation'?'System check · external authorization request':'External account · invitation sponsored by '+(event.actor_id===currentActor?'you':'a team member')
  if(request.decisionSource==='request_validation')return 'System check · request initiated by '+(event.actor_id===currentActor?'you':'a team member')
 }
 return event.actor_id===currentActor?'You':'Team member'
}
