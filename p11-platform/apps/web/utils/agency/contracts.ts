import {z} from 'zod'

export const agencyProducts = ['siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','platform'] as const
export type AgencyProduct = typeof agencyProducts[number]
const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/)
export const choices = {investigate:'Investigate in product',watch:'Keep watching',not_actionable:'No follow-up needed'} as const
export const productLinks: Record<AgencyProduct,string> = {
 siteforge:'/dashboard/siteforge',lumaleasing:'/dashboard/lumaleasing',propertyaudit:'/dashboard/propertyaudit',brandforge:'/dashboard/brandforge',
 tourspark:'/dashboard/leads',leadpulse:'/dashboard/leadpulse',crm:'/dashboard/crm',forgestudio:'/dashboard/forgestudio',reviewflow:'/dashboard/reviewflow',
 marketvision:'/dashboard/marketvision',bi:'/dashboard/bi',knowledge:'/dashboard/knowledge',property:'/dashboard/community',integrations:'/dashboard/integrations',
 reports:'/dashboard/reports',pipelines:'/dashboard/pipelines',settings:'/dashboard/settings',team:'/dashboard/team',platform:'/dashboard/activity'
}
const review = z.object({operation:z.literal('review'),product:z.enum(agencyProducts),sourceHash:hash,decision:z.enum(['investigate','watch','not_actionable']),reason:z.string().trim().min(3,'Explain your decision in at least three characters.').max(2000)}).strict()
const cancel = z.object({operation:z.literal('cancel_unused'),inputHash:hash}).strict()
export const agencyCommand = z.discriminatedUnion('operation',[review.extend({propertyId:id,requestId:id}),cancel.extend({propertyId:id,requestId:id})])
export type AgencyCommand = z.infer<typeof agencyCommand>
export type ReviewInput = z.infer<typeof review> & {propertyId:string}
export const agencyQuery = z.object({propertyId:id,kind:z.enum(['board','history','decision']).default('board'),decisionId:id.optional(),before:z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v=>/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807')).optional()}).strict()
 .refine(v=>v.kind==='decision'?!!v.decisionId&&!v.before:v.kind==='history'?!v.decisionId:!v.decisionId&&!v.before)
export const workSources = ['website_incident','social_publication','review_publication','market_source','market_extraction','market_brand','knowledge_search','report_delivery','crm_transfer','luma_request','luma_delivery','tour_work','tour_reminder','brand_import','unit_import','integration_authorization','report_schedule','pipeline_recovery','audit_invocation'] as const
export const workSourceLabels:Record<typeof workSources[number],string> = {
 website_incident:'Website incidents',social_publication:'Social publications',review_publication:'Manual review publications',
 market_source:'Market source captures',market_extraction:'Pricing extractions',market_brand:'Market brand evidence',
 knowledge_search:'Knowledge search preparation',report_delivery:'Report deliveries',crm_transfer:'CRM transfers',luma_request:'Assistant requests',luma_delivery:'Assistant booking delivery',tour_work:'Tour schedule follow-up',tour_reminder:'Tour reminder confirmation',brand_import:'Brand import review',unit_import:'Confirmed unit imports',integration_authorization:'Blocked connection requests',report_schedule:'Held report schedules',pipeline_recovery:'Import recovery',audit_invocation:'Unconfirmed audit requests'
}
export const workItemSchema=z.object({source:z.enum(workSources),id,category:z.enum(['held','unconfirmed','incident']),state:z.string(),version_token:z.string(),opened_at:z.string().nullable(),changed_at:z.string().nullable()})
export const currentWorkSchema=z.object({checkedSources:z.array(z.enum(workSources)),coverage:z.object({checkedSources:z.array(z.enum(workSources)),scope:z.enum(['new_work_only','account_or_org','recorded_actions','native_work']),detail:z.string()}).optional(),total:z.number().int().nonnegative(),heldCount:z.number().int().nonnegative(),unconfirmedCount:z.number().int().nonnegative(),incidentCount:z.number().int().nonnegative(),oldestOpenedAt:z.string().nullable(),fingerprint:z.string(),items:z.array(workItemSchema).max(5)})
const legacyEvidenceSchema = z.object({ruleVersion:z.literal('recorded-failures-v1'),propertyId:id,orgId:id,product:z.enum(agencyProducts),windowStart:z.string(),capturedAt:z.string(),confirmedCount:z.number().int().nonnegative(),failedCount:z.number().int().nonnegative(),observedCount:z.number().int().nonnegative(),latestConfirmedAt:z.string().nullable(),eventFingerprint:z.string(),sourceHash:hash,failures:z.array(z.object({eventId:id,episodeId:id,action:z.string(),recordedAt:z.string()})).max(5)})
export const evidenceSchema=z.discriminatedUnion('ruleVersion',[
 legacyEvidenceSchema,
 legacyEvidenceSchema.extend({ruleVersion:z.literal('recorded-work-v2'),currentWork:currentWorkSchema}),
 legacyEvidenceSchema.extend({ruleVersion:z.literal('recorded-work-v3'),currentWork:currentWorkSchema})
])
export type Evidence=z.infer<typeof evidenceSchema>
export type WorkItem=z.infer<typeof workItemSchema>
export function currentWork(evidence:Evidence){return evidence.ruleVersion!=='recorded-failures-v1'?evidence.currentWork:null}
export function needsAgencyReview(evidence:Evidence){return evidence.failedCount>0||(currentWork(evidence)?.total||0)>0}
export function workExplanation(item:WorkItem){
 if(item.source==='luma_request'||item.source==='luma_delivery'||item.source==='tour_work')return 'The saved request needs a status check. Review its reason and receipts in the product; a hold does not establish that delivery occurred.'
 if(item.source==='pipeline_recovery')return 'This import failed and has no linked replacement request. Inspect the saved recovery evidence before retrying.'
 if(item.source==='unit_import')return 'This unit import was confirmed but has not been applied. Review it in Property setup.'
 if(item.source==='audit_invocation')return 'The audit request outlasted its saved execution lease without a confirmed result. Review the retained request before another attempt.'
 if(item.source==='review_publication')return item.state==='held'?'A staff member reported an uncertain publication outcome. Check the destination before another attempt.':'Manual publication is awaiting confirmation. This record does not establish that anything was published.'
 if(item.category==='unconfirmed')return 'The saved result is unconfirmed. Check the destination and existing receipt before considering another attempt.'
 if(item.category==='incident')return 'This website incident is still open in the saved records. Review its evidence and current condition in SiteForge.'
 return 'This work is on hold. Review the saved reason and inputs in the product before deciding what to do next.'
}

export const reviewSchema = z.object({id,property_id:id,org_id:id,actor_id:id,kind:z.enum(['review','cancel_unused']),input:z.record(z.string(),z.unknown()),input_hash:hash,evidence:evidenceSchema.nullable(),decision:z.enum(['investigate','watch','not_actionable']).nullable(),reason:z.string().nullable(),created_at:z.string(),sequence:z.number().int()})
export const boardSchema = z.object({state:z.literal('ready'),propertyId:id,canManage:z.boolean(),mode:z.literal('observe'),items:z.array(z.object({evidence:evidenceSchema,review:z.object({id,decision:z.enum(['investigate','watch','not_actionable']),reason:z.string(),createdAt:z.string()}).nullable()}))})
export const historySchema = z.object({state:z.literal('ready'),propertyId:id,items:z.array(reviewSchema),nextBefore:z.string().nullable()})
export const receiptSchema = z.object({state:z.enum(['ready','saved','replayed']),propertyId:id,decisionId:id,record:reviewSchema})
export type Board = z.infer<typeof boardSchema>
export type ReviewRecord = z.infer<typeof reviewSchema>
