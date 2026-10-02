/**
 * ForgeStudio editorial domain store.
 *
 * Canonical lifecycle:
 *   brief → package → immutable revisions → per-channel variants
 *   approved revision + connection + time → publication → attempts
 *
 * Invariants enforced here:
 * - Revisions are immutable; editing creates a new revision and supersedes
 *   prior pending/approved revisions (cancelling their scheduled publications).
 * - Only the approved, current revision of a package can be scheduled.
 * - One live publication per (revision, connection) — backed by a partial
 *   unique index in the database.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import type { Tables } from '@/types/supabase'
import { randomUUID } from 'node:crypto'
import {
  findUnsupportedClaims,
  revisionContentSchema,
  validateVariant,
  type RevisionContent,
} from '@/utils/forgestudio/content-contract'

export class ContentStoreError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ContentStoreError'
    this.statusCode = statusCode
  }
}

export async function editorialRpc(name:string,id:string,propertyId:string,actorId:string|null,payload:Record<string,unknown>):Promise<Record<string,unknown>> {
  if(!actorId)throw new ContentStoreError('An operator identity is required for this editorial decision.',403)
  const supabase=createServiceClient()
  const rpcClient = supabase as unknown as {rpc: (name:string,args:Record<string,unknown>)=>Promise<{data:Record<string,unknown>|null;error:unknown}>}
  const {data,error}=await rpcClient.rpc(name,{p_id:id,p_property_id:propertyId,p_actor_id:actorId,p_payload:payload})
  if(error||!data)throw new ContentStoreError('The saved editorial result could not be confirmed. Reload the saved work before trying again.',503)
  const messages:Record<string,string>={stale_configuration:'These settings changed since you opened them. Reload the current settings before saving.',source_review_required:'The evidence changed or is incomplete. Open Sources, correct the content and refresh it into a new revision before approving or scheduling.',approval_access_changed:'The reviewer no longer has approval access. Review the content again before scheduling.',variant_unavailable:'Choose a valid reviewed format for every destination.',duplicate_destination:'The same format and account was selected twice.',already_scheduled:'This format is already scheduled for the selected account.',schedule_time_required:'Choose a future publication time within the next year.',timezone_required:'Choose a valid time zone.',experiment_invalid:'Supply both an experiment name and its group.',stale_publication:'The saved publication changed. Reload its current state before changing it.',write_review_required:'A saved write may have reached the provider. Review the destination; this publication cannot be resent.',publication_closed:'This publication is already closed. Reload its saved result.',write_evidence_required:'No saved provider write exists for this publication.',legacy_review_required:'This older publication needs its saved execution history reviewed before further work.',stale_revision:'The revision changed after you opened it. Reload and review the current version.',publication_in_progress:'A publication is being processed or needs reconciliation. Resolve its saved result before revising this package.',request_conflict:'This request differs from its saved version. Reload the saved work.',connection_unavailable:'A selected account is unavailable or belongs to another property.',asset_unavailable:'A selected asset is unavailable for this property.',context_unavailable:'The saved source context is unavailable for this property.',validation_required:'Review the content validation issues before approving.',forbidden:'Your current access does not allow this decision.'}
  if(!['saved','replayed'].includes(String(data.state)))throw new ContentStoreError(messages[String(data.state)]||'This saved editorial action is unavailable.',data.state==='forbidden'?403:409)
  return data
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export type CreateBriefInput = {
  requestId?: string
  orgId: string
  propertyId: string
  createdBy: string | null
  title: string
  objective: string
  topic?: string | null
  audience?: string | null
  sourceFacts?: unknown[]
  constraints?: Record<string, unknown>
  channels?: string[]
  connectionIds?: string[]
  assetIds?: string[]
  formatPlan?: unknown[]
  schedulingWindow?: Record<string, unknown>
}

export async function createBrief(input: CreateBriefInput): Promise<Tables<'social_content_briefs'>> {
  const {requestId,propertyId,createdBy}=input
  const payload={title:input.title,objective:input.objective,topic:input.topic??null,audience:input.audience??null,sourceFacts:input.sourceFacts??[],constraints:input.constraints??{},channels:input.channels??[],connectionIds:input.connectionIds??[],assetIds:input.assetIds??[],formatPlan:input.formatPlan??[],schedulingWindow:input.schedulingWindow??{}}
  const result=await editorialRpc('save_forgestudio_brief',requestId||randomUUID(),propertyId,createdBy,payload)
  return result.brief as Tables<'social_content_briefs'>
}

export async function setBriefStatus(
  briefId: string,
  status: 'draft' | 'generating' | 'generated' | 'archived'
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('social_content_briefs')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', briefId)
  if (error) {
    throw new ContentStoreError(`Failed to update brief status: ${error.message}`, 500)
  }
}

// ---------------------------------------------------------------------------
// Packages + revisions + variants
// ---------------------------------------------------------------------------

type RevisionAuthor =
  | { kind: 'llm' }
  | { kind: 'user'; userId: string }

export type CreateRevisionInput = {
  requestId?: string
  expectedRevisionId?: string
  modificationReason?: string
  content: RevisionContent
  author: RevisionAuthor
  contextSnapshotId?: string | null
  generationMetadata?: Record<string, unknown>
}

export type CreatePackageInput = CreateRevisionInput & {
  orgId: string
  propertyId: string
  briefId?: string | null
  createdBy?: string | null
}

function revisionPayload(input:CreateRevisionInput) {
 const content=revisionContentSchema.parse(input.content)
 return {content,authorKind:input.author.kind,contextSnapshotId:input.contextSnapshotId??null,generationMetadata:input.generationMetadata??{},validation:content.variants.map(validateVariant)}
}
export async function createPackageWithRevision(input:CreatePackageInput):Promise<{pkg:Tables<'social_content_packages'>;revision:Tables<'social_content_revisions'>}>{
 const result=await editorialRpc('save_forgestudio_revision',input.requestId||randomUUID(),input.propertyId,input.createdBy??null,{...revisionPayload(input),briefId:input.briefId??null})
 return {pkg:result.package as Tables<'social_content_packages'>,revision:result.revision as Tables<'social_content_revisions'>}
}
export async function addRevision(packageId:string,input:CreateRevisionInput):Promise<Tables<'social_content_revisions'>>{
 if(input.author.kind!=='user'||!input.expectedRevisionId||!input.modificationReason?.trim())throw new ContentStoreError('Review the saved revision and provide a reason before saving changes.',400)
 const {data:pkg,error}=await createServiceClient().from('social_content_packages').select('property_id').eq('id',packageId).single()
 if(error||!pkg)throw new ContentStoreError('Package not found',404)
 const result=await editorialRpc('save_forgestudio_revision',input.requestId||randomUUID(),pkg.property_id,input.author.userId,{...revisionPayload(input),packageId,expectedRevisionId:input.expectedRevisionId,reason:input.modificationReason.trim()})
 return result.revision as Tables<'social_content_revisions'>
}
export async function setRevisionApproval(input:{requestId?:string;revisionId:string;contentHash:string;decision:'approved'|'denied';reviewerId:string;note?:string|null}):Promise<Tables<'social_content_revisions'>>{
 const {data:revision,error}=await createServiceClient().from('social_content_revisions').select('property_id,content,content_hash').eq('id',input.revisionId).single()
 if(error||!revision)throw new ContentStoreError('Revision not found',404)
 // Validate the immutable content before the transaction. The hash binds its exact result.
 if(input.decision==='approved'){
  const content=revisionContentSchema.parse(revision.content)
  const issues=content.variants.flatMap(validateVariant),unsupported=findUnsupportedClaims(content.claims)
  if(issues.length||unsupported.length)throw new ContentStoreError('Review unsupported claims and variant validation issues before approving.',409)
 }
 const result=await editorialRpc('review_forgestudio_revision',input.requestId||randomUUID(),revision.property_id,input.reviewerId,{revisionId:input.revisionId,contentHash:input.contentHash,decision:input.decision,note:input.note?.trim()??''})
 return result.revision as Tables<'social_content_revisions'>
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export const PUBLICATION_JOB_DOMAIN = 'forgestudio.publication'

export type ScheduleDestination={connectionId:string;variantId:string;scheduledFor:string;timezone:string;experimentKey?:string;experimentGroup?:'control'|'treatment'}
export async function schedulePublications(input:{requestId:string;revisionId:string;contentHash:string;destinations:ScheduleDestination[];createdBy:string|null}):Promise<Tables<'social_publications'>[]>{
 const {data:revision,error}=await createServiceClient().from('social_content_revisions').select('property_id').eq('id',input.revisionId).single()
 if(error||!revision)throw new ContentStoreError('Revision not found',404)
 const result=await editorialRpc('schedule_forgestudio_publications',input.requestId,revision.property_id,input.createdBy,{revisionId:input.revisionId,contentHash:input.contentHash,destinations:input.destinations})
 return result.publications as Tables<'social_publications'>[]
}
export type PublicationControl={requestId:string;actorId:string;expectedUpdatedAt:string}
async function controlPublication(publicationId:string,action:'cancel'|'reschedule',control:PublicationControl,scheduledFor?:string):Promise<Tables<'social_publications'>>{
 const {data:publication,error}=await createServiceClient().from('social_publications').select('property_id').eq('id',publicationId).single()
 if(error||!publication)throw new ContentStoreError('Publication not found',404)
 const result=await editorialRpc('control_forgestudio_publication',control.requestId,publication.property_id,control.actorId,{publicationId,action,expectedUpdatedAt:control.expectedUpdatedAt,...(scheduledFor?{scheduledFor}:{})})
 return result.publication as Tables<'social_publications'>
}
export const cancelPublication=(publicationId:string,control:PublicationControl)=>controlPublication(publicationId,'cancel',control)
export const reschedulePublication=(publicationId:string,scheduledFor:string,control:PublicationControl)=>controlPublication(publicationId,'reschedule',control,scheduledFor)
/** Older blanket retries cannot establish whether a provider received the post. */
export async function retryPublication(publicationId:string):Promise<never>{
 if(!publicationId)throw new ContentStoreError('Publication not found',404)
 throw new ContentStoreError('Review the saved publication evidence before another attempt. An uncertain post cannot be resent.',409)
}

export async function reviewPublicationRecovery(publicationId:string,actorId:string,input:{requestId:string;expectedUpdatedAt:string;action:'resume_before_send'|'record_existing_post';reason:string;providerPostId?:string;providerPostUrl?:string}){
 const {data:publication,error}=await createServiceClient().from('social_publications').select('property_id').eq('id',publicationId).single()
 if(error||!publication)throw new ContentStoreError('Publication not found',404)
 const {requestId,...payload}=input
 return editorialRpc('review_forgestudio_publication_recovery',requestId,publication.property_id,actorId,{...payload,publicationId})
}
