import {z} from 'zod'
import {propertyIdSchema as id} from '@/utils/property-setup/contracts'
const hash=z.string().regex(/^[a-f0-9]{64}$/),reason=z.string().trim().min(1).max(2000).refine(v=>!v.includes('\u0000'))
const identity={id,propertyId:id,expectedActorId:id}
export const widgetDecision=z.discriminatedUnion('operation',[
 z.object({...identity,operation:z.literal('rotate'),keyVersion:hash,replaceInstalledKey:z.literal(true),reason}).strict(),
 z.object({...identity,operation:z.literal('logo'),configurationRevision:hash,assetId:id,assetRevision:z.number().int().positive(),contentHash:hash,reason}).strict(),
 z.object({...identity,operation:z.literal('clear_logo'),configurationRevision:hash,reason}).strict(),
 z.object({...identity,operation:z.literal('prepare'),keyVersion:hash,kind:z.enum(['key','embed'])}).strict(),
 z.object({...identity,operation:z.literal('report'),preparationId:id,artifactHash:hash,outcome:z.enum(['copied','download_initiated','failed'])}).strict(),
 z.object({...identity,operation:z.literal('cancel')}).strict()
])
export const widgetRead=z.object({propertyId:id,commandId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),hash:hash.optional()}).strict()
