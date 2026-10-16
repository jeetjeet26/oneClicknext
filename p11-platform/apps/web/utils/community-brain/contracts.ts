import {z} from 'zod'

export const purposeSchema=z.enum(['site','chat','social','brand','research','portfolio','ingestion','manage','download'])
export type BrainPurpose=z.infer<typeof purposeSchema>
// PostgreSQL accepts seeded and deterministic UUIDs without RFC version bits.
// Shape validation does not replace the current actor/community permission checks.
export const scopeSchema=z.object({
  id:z.guid(),actor_id:z.guid(),org_id:z.guid(),kind:z.enum(['community','portfolio']),
  property_ids:z.array(z.guid()).min(1).max(500),purpose:purposeSchema,
  permission_hash:z.string().regex(/^[a-f0-9]{64}$/),policy_revision:z.number().int().positive(),
  expires_at:z.string(),created_at:z.string(),
}).refine(scope=>scope.kind==='portfolio'?scope.purpose==='portfolio':scope.property_ids.length===1&&scope.purpose!=='portfolio')
export type CommunityScope=Readonly<z.infer<typeof scopeSchema>>
export class BrainError extends Error {constructor(message:string,readonly status=503){super(message)}}
export const contextRequestSchema=z.object({propertyId:z.guid(),purpose:purposeSchema.exclude(['portfolio']),query:z.string().trim().max(4000).default(''),assetIds:z.array(z.guid()).max(100).default([])}).strict()
export const portfolioRequestSchema=z.object({
  propertyIds:z.array(z.guid()).min(1).max(500),operation:z.enum(['floorplans','assets','facts','search','campaigns']),
  query:z.string().max(4000).default(''),start:z.iso.date().optional(),end:z.iso.date().optional(),
  offset:z.number().int().min(0).max(499).default(0),assetOffset:z.number().int().min(0).max(100000).default(0),sessionId:z.guid().optional(),
}).strict().refine(value=>value.operation!=='campaigns'||!!value.start&&!!value.end&&value.start<=value.end&&Date.parse(value.end)-Date.parse(value.start)<=366*86400000,'Choose a valid reporting period')
export type Evidence={id:string;propertyId:string;evidenceId:string;sourceHash:string;content:string;allowedUses:string[];authority:string;audience:string;score:number;metadata:unknown}
export type GenerationContext={
  snapshotId?:string;version:'community-context-v1';scopeId:string;scopeKind:'community'|'portfolio';actorId:string;orgId:string;propertyId:string;
  purpose:BrainPurpose;policyRevision:number;permissionHash:string;expiresAt:string;contextHash:string;readSetHash:string;
  canonical:{property:Record<string,unknown>;facts:Array<Record<string,unknown>>;floorplans:Array<Record<string,unknown>>;brand:Record<string,unknown>|null;assets:Array<Record<string,unknown>>;omittedAssetIds:string[];asOf:string;purpose:string};
  evidence:Evidence[];
}

export function assertCommunityContext(context:GenerationContext,propertyId:string) {
  if(context.scopeKind!=='community'||context.propertyId!==propertyId||context.purpose==='portfolio')throw new BrainError('Combined portfolio context cannot be used for community generation.',403)
  if(Date.parse(context.expiresAt)<=Date.now())throw new BrainError('Refresh this community context before generation.',409)
  if(context.evidence.some(row=>row.propertyId!==propertyId))throw new BrainError('Evidence ownership does not match this community.',403)
}
