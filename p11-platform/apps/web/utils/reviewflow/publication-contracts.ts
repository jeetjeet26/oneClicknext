import {z} from 'zod'
import {responseIdSchema} from './response-contracts'
export function safePublicationUrl(value:string){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname)&&!/(^|\.)(localhost|local|internal|test)$/i.test(url.hostname)}catch{return false}}
const uuid=responseIdSchema,hash=z.string().regex(/^[a-f0-9]{64}$/),version=z.number().int().positive(),reason=z.string().trim().min(3).max(2000),url=z.string().trim().max(2048).refine(safePublicationUrl,'Use a public HTTPS page without credentials').transform(value=>new URL(value).href)
const common={propertyId:uuid,requestId:uuid},decision={...common,publicationId:uuid,expectedVersion:version,reason}
export const publicationWriteSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('prepare_manual'),responseId:uuid,expectedVersion:version,sourceVersion:version,contextHash:hash,contentHash:hash,targetHash:hash,destinationUrl:url,replacePublished:z.boolean(),reason}).strict(),
 z.object({...decision,action:z.literal('report_manual'),confirmedExactText:z.literal(true),publishedAt:z.string().datetime({offset:true}),evidenceUrl:url}).strict(),
 z.object({...decision,action:z.literal('cancel_manual'),confirmedNotPublished:z.literal(true)}).strict(),
 z.object({...decision,action:z.literal('hold_manual')}).strict(),
])
export const publicationReadSchema=z.object({propertyId:uuid,reviewId:uuid,cursor:uuid.optional()}).strict()
