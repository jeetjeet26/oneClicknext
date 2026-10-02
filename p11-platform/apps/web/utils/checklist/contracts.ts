import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const digest=z.string().regex(/^[a-f0-9]{64}$/)
export const taskFields=z.object({name:z.string().trim().min(1).max(200),description:z.string().max(4000),category:z.enum(['setup','documents','integrations','billing','training','general']),priority:z.number().int().min(0).max(100),status:z.enum(['pending','in_progress','completed','blocked','skipped']),notes:z.string().max(4000),blockedReason:z.string().max(4000)}).strict().refine(v=>v.status!=='blocked'||v.blockedReason.trim().length>=3,'Explain what blocks this task.')
const base={requestId:id,propertyId:id,reason:z.string().trim().min(3).max(2000)}
export const checklistCommand=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('create'),fields:taskFields,confirmed:z.boolean()}).strict(),
 z.object({...base,operation:z.literal('save'),taskId:id,expectedHash:digest,fields:taskFields,confirmed:z.boolean()}).strict(),
 z.object({...base,operation:z.literal('archive'),taskId:id,expectedHash:digest}).strict(),
 z.object({...base,operation:z.literal('restore'),taskId:id,expectedHash:digest}).strict(),
 z.object({...base,operation:z.literal('cancel_unused'),inputHash:digest}).strict()
]).refine(v=>v.operation!=='create'||v.fields.status==='pending','New tasks begin pending.').refine(v=>!('fields'in v)||v.fields.status!=='completed'||v.confirmed,'Confirm that this is reported progress only.')
export const checklistQuery=z.object({propertyId:id,kind:z.enum(['list','task','history','decision']).default('list'),taskId:id.optional(),decisionId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),expectedHash:digest.optional()}).strict().refine(v=>v.kind==='decision'?!!v.decisionId&&!v.taskId:v.kind==='task'||v.kind==='history'?!!v.taskId&&!v.decisionId:!v.taskId&&!v.decisionId)
export type ChecklistCommand=z.infer<typeof checklistCommand>
export type TaskFields=z.infer<typeof taskFields>
export type Task={id:string;task_name:string;task_type:string;description:string|null;category:TaskFields['category']|null;priority:number|null;status:TaskFields['status']|null;notes:string|null;blocked_reason:string|null;assigned_to:string|null;due_date:string|null;completed_at:string|null;completed_by:string|null;metadata:unknown;created_at:string;updated_at:string;revision:number;archived:boolean;recorded:boolean}
export type TaskSnapshot={task:Task;workspace:{revision:number;archived:boolean;org_id:string;updated_at:string}|null}
export type TaskDetail={propertyId:string;canManage:boolean;snapshot:TaskSnapshot;sourceHash:string}
export type ChecklistStats={total:number;archived:number;completed:number;inProgress:number;pending:number;blocked:number;skipped:number;progress:number}
export type ChecklistPage={propertyId:string;canManage:boolean;items:Task[];stats:ChecklistStats;total:number;pageHash:string;nextOffset:number|null}
export type ChecklistDecision={id:string;origin:'operator'|'property_setup'|'default_setup';actor_id:string|null;kind:string;created_at:string;input:{reason:string};before_state:TaskSnapshot|null;after_state:TaskSnapshot}
export type ChecklistHistory={items:ChecklistDecision[];total:number;pageHash:string;nextOffset:number|null}
