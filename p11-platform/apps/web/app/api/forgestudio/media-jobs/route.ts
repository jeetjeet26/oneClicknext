import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {enqueueMediaGeneration,mediaRpc,recoverMediaGeneration} from '@/utils/forgestudio/media-jobs'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
const baseSchema = z.object({
  propertyId: z.string().uuid(),
  requestId: z.string().uuid(),
  prompt: z.string().min(10).max(4000),
  sourceAssetId: z.string().uuid().nullish(),
  altText: z.string().min(3).max(1000),
  name: z.string().min(1).max(200),
  maxCostUsd: z.number().positive().max(25),
})

const requestSchema = z.discriminatedUnion('modality', [
  baseSchema.extend({
    modality: z.literal('image'),
    tier: z.enum(['iterative', 'draft', 'final', 'premium', 'challenger']),
    aspectRatio: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16']),
  }),
  baseSchema.extend({
    modality: z.literal('video'),
    tier: z.enum(['preview', 'social', 'premium']),
    aspectRatio: z.enum(['16:9', '9:16']),
    durationSeconds: z.union([z.literal(4), z.literal(8)]),
    generateAudio: z.boolean().default(false),
  }),
])


const decisionSchema=z.object({propertyId:z.string().uuid(),requestId:z.string().uuid(),jobId:z.string().uuid(),action:z.enum(['stop','recover']),expectedUpdatedAt:z.string().datetime({offset:true}),reason:z.string().trim().min(3).max(2000)}).strict()
function failure(error:unknown){return NextResponse.json({error:error instanceof Error?error.message:'Media request unavailable'},{status:error instanceof ContentStoreError?error.statusCode:503})}
async function actor(){const {data:{user}}=await(await createClient()).auth.getUser();return user}
export async function GET(request:NextRequest){
 const user=await actor();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
 const params=new URL(request.url).searchParams,parsed=z.string().uuid().safeParse(params.get('propertyId'))
 if(!parsed.success)return NextResponse.json({error:'Valid property required'},{status:400})
 const access=await validatePropertyAccess(user.id,parsed.data);if(!access.authorized||!access.orgId)return NextResponse.json({error:'Forbidden'},{status:403})
 let query=createServiceClient().from('forgestudio_media_requests').select('id,state,input,asset_id,result_manifest,error_code,created_at,updated_at,model_started_at,lease_expires_at').eq('property_id',parsed.data).eq('org_id',access.orgId)
 const jobId=params.get('jobId');if(jobId){if(!z.string().uuid().safeParse(jobId).success)return NextResponse.json({error:'Invalid request identity'},{status:400});query=query.eq('id',jobId)}
 const cursor=params.get('cursor');if(cursor){const parts=cursor.split('|');if(parts.length!==2||!z.string().datetime({offset:true}).safeParse(parts[0]).success||!z.string().uuid().safeParse(parts[1]).success)return NextResponse.json({error:'Invalid media page'},{status:400});query=query.or(`created_at.lt.${parts[0]},and(created_at.eq.${parts[0]},id.lt.${parts[1]})`)}
 const {data,error}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
 if(error)return NextResponse.json({error:'Saved media requests could not be loaded. Reload to try again.'},{status:503})
 const rows=(data??[]).slice(0,30),last=rows.at(-1)
 // Provider evidence and private file locations never leave the server.
 const jobs=rows.map(row=>{const input=row.input as {request?:{name?:string;prompt?:string;modality?:string};name?:string;modality?:string;estimatedCostUsd?:number};return {id:row.id,state:row.state,name:input.request?.name||input.name||'Earlier media request',modality:input.request?.modality||input.modality||'media',prompt:input.request?.prompt||null,estimatedCostUsd:input.estimatedCostUsd??null,assetId:row.asset_id,hasSavedResult:!!row.result_manifest,errorCode:row.error_code,createdAt:row.created_at,updatedAt:row.updated_at,leaseExpired:!!row.lease_expires_at&&new Date(row.lease_expires_at).getTime()<Date.now()}})
 return NextResponse.json({jobs,nextCursor:(data?.length??0)>30&&last?`${last.created_at}|${last.id}`:null,paused:process.env.OUTBOUND_DELIVERY_PAUSED==='true'})
}
export async function POST(request:NextRequest){
 const user=await actor();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
 const parsed=requestSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Check the media name, prompt, format and spending limit.'},{status:400})
 const access=await validatePropertyAccess(user.id,parsed.data.propertyId);if(!access.authorized||!access.orgId)return NextResponse.json({error:'Forbidden'},{status:403})
 try{const {propertyId,requestId,...mediaRequest}=parsed.data;const job=await enqueueMediaGeneration({requestId,propertyId,orgId:access.orgId,actorId:user.id,request:mediaRequest});return NextResponse.json({job,paused:process.env.OUTBOUND_DELIVERY_PAUSED==='true'},{status:202})}catch(error){return failure(error)}
}
export async function PATCH(request:NextRequest){
 const user=await actor();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401})
 const parsed=decisionSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Reload the request and explain this media decision.'},{status:400})
 const access=await validatePropertyAccess(user.id,parsed.data.propertyId);if(!access.authorized||!access.orgId)return NextResponse.json({error:'Forbidden'},{status:403})
 try{const {requestId,propertyId,...decision}=parsed.data;const result=decision.action==='recover'?await recoverMediaGeneration({...parsed.data,orgId:access.orgId,actorId:user.id}):await mediaRpc('decide_forgestudio_media',{p_id:requestId,p_property_id:propertyId,p_actor_id:user.id,p_payload:decision},['saved','replayed']);return NextResponse.json(result)}catch(error){return failure(error)}
}
