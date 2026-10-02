import {z} from 'zod'
import type {Tables} from '@/types/supabase'
export type LibraryAsset=Tables<'content_assets'>
export const rightsStatus=z.enum(['unknown','owned','licensed','generated','restricted'])
const identity={requestId:z.string().uuid(),propertyId:z.string().uuid(),assetId:z.string().uuid(),revision:z.number().int().positive()}
export const assetDecisionSchema=z.discriminatedUnion('action',[
 z.object({...identity,action:z.literal('save'),patch:z.object({name:z.string().trim().min(1).max(255).optional(),description:z.string().max(2000).nullable().optional(),alt_text:z.string().max(1000).nullable().optional(),tags:z.array(z.string().trim().min(1).max(80)).max(30).optional(),folder:z.string().trim().max(120).nullable().optional(),is_favorite:z.boolean().optional()}).strict().refine(p=>Object.keys(p).length>0)}).strict(),
 z.object({...identity,action:z.literal('review'),reason:z.string().trim().min(3).max(2000),review:z.object({approval_status:z.enum(['approved','rejected']),rights_status:rightsStatus,rights_metadata:z.record(z.string(),z.unknown()).refine(v=>JSON.stringify(v).length<10000).optional(),expires_at:z.iso.datetime().nullable().optional()}).strict()}).strict(),
 z.object({...identity,action:z.literal('archive'),reason:z.string().trim().min(3).max(2000)}).strict(),
 z.object({...identity,action:z.literal('restore'),reason:z.string().trim().min(3).max(2000)}).strict(),
])
export const uploadRecoverySchema=z.object({requestId:z.string().uuid(),propertyId:z.string().uuid(),uploadId:z.string().uuid(),action:z.enum(['recover','keep_separate']),reason:z.string().trim().min(3).max(2000)}).strict()
