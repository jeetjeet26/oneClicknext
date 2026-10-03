import {z} from 'zod'
import {agencyProducts,evidenceSchema,currentWork,type Evidence} from './contracts'
export const planActions=['inspect_work','verify_receipt','review_inputs','prepare_followup'] as const
export const planActionLabels:Record<typeof planActions[number],string>={inspect_work:'Inspect saved work',verify_receipt:'Check an existing receipt',review_inputs:'Review saved inputs',prepare_followup:'Prepare a follow-up draft'}
export const planStates={draft:'Draft',reviewed:'Reviewed for human follow-up',withdrawn:'Withdrawn'} as const
const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/)
export const planDocument=z.object({goal:z.string().trim().min(3).max(1000),successMeasure:z.string().trim().min(3).max(1000),steps:z.array(z.object({action:z.enum(planActions),detail:z.string().trim().min(3).max(1200)}).strict()).min(1).max(8)}).strict()
const save=z.object({operation:z.literal('save'),product:z.enum(agencyProducts),previousId:id.nullable(),sourceHash:hash,plan:planDocument,status:z.enum(['draft','reviewed','withdrawn']),reason:z.string().trim().min(3).max(2000)}).strict()
export const planCommand=z.discriminatedUnion('operation',[save.extend({propertyId:id,requestId:id}),z.object({propertyId:id,requestId:id,product:z.enum(agencyProducts),operation:z.literal('cancel_unused'),inputHash:hash}).strict()])
export type PlanCommand=z.infer<typeof planCommand>
export type PlanInput=z.infer<typeof save>&{propertyId:string}
export type PlanDocument=z.infer<typeof planDocument>
export const planQuery=z.object({propertyId:id,product:z.enum(agencyProducts),kind:z.enum(['board','history','decision']).default('board'),decisionId:id.optional(),before:z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807')).optional()}).strict().refine(v=>v.kind==='decision'?!!v.decisionId&&!v.before:v.kind==='history'?!v.decisionId:!v.decisionId&&!v.before)
const policy=z.object({mode:z.literal('proposal_only'),vocabularyVersion:z.literal('human-review-v1'),allowedActions:z.array(z.enum(planActions)),executionAuthorized:z.literal(false)})
export const planRecord=z.object({id,property_id:id,org_id:id,actor_id:id,product:z.enum(agencyProducts),kind:z.enum(['save','cancel_unused']),input:z.record(z.string(),z.unknown()),input_hash:hash,previous_id:id.nullable(),revision:z.number().int().positive().nullable(),plan:planDocument.nullable(),evidence:evidenceSchema.nullable(),reason:z.string().nullable(),status:z.enum(['draft','reviewed','withdrawn']).nullable(),policy,created_at:z.string(),sequence:z.number().int()}).refine(r=>r.kind==='save'?!!r.plan&&!!r.evidence&&!!r.status&&!!r.revision&&!!r.reason:r.plan===null&&r.evidence===null&&r.status===null&&r.revision===null)
export type PlanRecord=z.infer<typeof planRecord>
export const planBoard=z.object({state:z.literal('ready'),propertyId:id,product:z.enum(agencyProducts),mode:z.literal('proposal_only'),canManage:z.boolean(),current:planRecord.nullable(),evidence:evidenceSchema.nullable(),items:z.array(planRecord),nextBefore:z.string().nullable()})
export type PlanBoard=z.infer<typeof planBoard>
export const planReceipt=z.object({state:z.enum(['ready','saved','replayed']),propertyId:id,product:z.enum(agencyProducts),decisionId:id,record:planRecord})
export function suggestedSteps(e:Evidence):PlanDocument['steps']{
 const work=currentWork(e),steps:PlanDocument['steps']=[{action:'inspect_work',detail:'Open the product and inspect the saved records relevant to this goal. Confirm what still needs follow-up.'}]
 if(work?.unconfirmedCount)steps.push({action:'verify_receipt',detail:'Check the destination and existing receipt for the unconfirmed result before considering another attempt.'})
 if(work?.heldCount)steps.push({action:'review_inputs',detail:'Review the held work’s saved inputs and reason with the responsible person.'})
 steps.push({action:'prepare_followup',detail:'Draft the next human follow-up, recording uncertainties and any separate permission needed.'});return steps
}
