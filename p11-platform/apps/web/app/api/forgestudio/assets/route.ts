import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {ContentStoreError} from '@/utils/forgestudio/content-store'
import {assetDecisionSchema,uploadRecoverySchema} from '@/utils/forgestudio/asset-library'
import {assetLibraryRpc,boundedAssetForm,uploadLibraryAsset,recoverLibraryUpload} from '@/utils/forgestudio/asset-library-store'
export const maxDuration=120
async function assetActor(){const client=await createClient(),{data:{user},error}=await client.auth.getUser();if(error||!user)throw new ContentStoreError('Unauthorized',401);return user.id}
async function assetAccess(actorId:string,propertyId:string){if(!z.string().uuid().safeParse(propertyId).success)throw new ContentStoreError('A valid property is required.',400);if(!(await validatePropertyAccess(actorId,propertyId)).authorized)throw new ContentStoreError('Forbidden',403)}
const assetFailure=(error:unknown)=>NextResponse.json({error:error instanceof ContentStoreError?error.message:error instanceof z.ZodError?'Review the asset fields and saved version before continuing.':'The asset library could not be loaded. Reload before continuing.'},{status:error instanceof ContentStoreError?error.statusCode:error instanceof z.ZodError?400:503})
const cursorSchema=z.object({createdAt:z.iso.datetime({offset:true}).nullable(),id:z.string().uuid()})
export async function GET(request:NextRequest){try{
 const actor=await assetActor(),params=new URL(request.url).searchParams,propertyId=params.get('propertyId')||'';await assetAccess(actor,propertyId)
 const db=createServiceClient(),mode=params.get('mode')
 if(mode==='uploads'){
  let uploads=db.from('forgestudio_asset_uploads').select('id,input,state,asset_id,created_at').eq('property_id',propertyId).eq('actor_id',actor).eq('state','prepared').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31)
  if(params.get('cursor')){const c=cursorSchema.parse(JSON.parse(Buffer.from(params.get('cursor')!,'base64url').toString()));if(!c.createdAt)throw new ContentStoreError('Reload saved uploads.',400);uploads=uploads.or(`created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`)}
  const {data,error}=await uploads
  if(error)throw new ContentStoreError('Saved uploads could not be loaded.',503)
  const rows=(data??[]).slice(0,30),last=rows.at(-1)
  return NextResponse.json({uploads:rows.map(r=>{const i=r.input as Record<string,unknown>;return {id:r.id,createdAt:r.created_at,name:(i.metadata as Record<string,unknown>)?.name,size:i.size,replacesAssetId:i.replacesAssetId??null}}),nextCursor:(data?.length??0)>30&&last?Buffer.from(JSON.stringify({createdAt:last.created_at,id:last.id})).toString('base64url'):null})
 }
 if(mode==='asset'){
  const {data,error}=await db.from('content_assets').select('*').eq('property_id',propertyId).eq('id',z.string().uuid().parse(params.get('assetId'))).single()
  if(error||!data)throw new ContentStoreError('This saved asset could not be loaded.',503)
  return NextResponse.json({asset:data})
 }
 if(mode==='history'){
  const assetId=z.string().uuid().parse(params.get('assetId'))
  let history=db.from('brand_asset_revisions').select('revision,snapshot,created_at').eq('asset_id',assetId).eq('property_id',propertyId).order('revision',{ascending:false}).limit(31)
  if(params.get('beforeRevision'))history=history.lt('revision',z.coerce.number().int().positive().parse(params.get('beforeRevision')))
  const {data,error}=await history
  if(error)throw new ContentStoreError('Saved asset versions could not be loaded.',503)
  const rows=(data??[]).slice(0,30);return NextResponse.json({history:rows,nextRevision:(data?.length??0)>30?rows.at(-1)?.revision:null})
 }
 const requestedLimit=Number(params.get('limit')||30),limit=Math.min(100,Math.max(1,Number.isFinite(requestedLimit)?Math.floor(requestedLimit):30))
 let query=db.from('content_assets').select('*').eq('property_id',propertyId).order('created_at',{ascending:false,nullsFirst:false}).order('id',{ascending:false}).limit(limit+1)
 if(params.get('archived')==='true')query=query.not('archived_at','is',null);else query=query.is('archived_at',null)
 const type=params.get('assetType');if(type&&type!=='all')query=query.eq('asset_type',z.enum(['image','video','gif','audio','font']).parse(type))
 if(params.get('aiGenerated')==='true')query=query.eq('is_ai_generated',true)
 if(params.get('favorites')==='true')query=query.eq('is_favorite',true)
 if(params.get('usable')==='true')query=query.eq('approval_status','approved').is('duplicate_of',null)
 if(params.get('folder'))query=query.eq('folder',params.get('folder')!.slice(0,120))
 if(params.get('search'))query=query.ilike('name','%'+params.get('search')!.slice(0,200).replace(/[\\%_]/g,'\\$&')+'%')
 if(params.get('cursor')){
  let cursor:z.infer<typeof cursorSchema>
  try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(params.get('cursor')!,'base64url').toString()))}catch{throw new ContentStoreError('Reload the asset list to restart pagination.',400)}
  query=cursor.createdAt?query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}),created_at.is.null`):query.is('created_at',null).lt('id',cursor.id)
 }
 const {data,error}=await query;if(error)throw new ContentStoreError('The asset library could not be loaded.',503)
 const assets=(data??[]).slice(0,limit),last=assets.at(-1)
 return NextResponse.json({assets,nextCursor:(data?.length??0)>limit&&last?Buffer.from(JSON.stringify({createdAt:last.created_at,id:last.id})).toString('base64url'):null})
}catch(error){return assetFailure(error)}}
export async function POST(request:NextRequest){try{const actor=await assetActor();if(!request.headers.get('Content-Type')?.startsWith('multipart/form-data'))throw new ContentStoreError('Upload a file to add an asset to the library.',400);const form=await boundedAssetForm(request),propertyId=String(form.get('propertyId')||'');await assetAccess(actor,propertyId);return NextResponse.json(await uploadLibraryAsset(form,actor,propertyId),{status:201})}catch(error){return assetFailure(error)}}
export async function PATCH(request:NextRequest){try{
 const actor=await assetActor(),body=await request.json().catch(()=>null)
 if(body?.action==='recover'||body?.action==='keep_separate'){const parsed=uploadRecoverySchema.parse(body);await assetAccess(actor,parsed.propertyId);return NextResponse.json(await recoverLibraryUpload({...parsed,actorId:actor}))}
 const {requestId,propertyId,...payload}=assetDecisionSchema.parse(body);await assetAccess(actor,propertyId)
 return NextResponse.json(await assetLibraryRpc('manage_forgestudio_asset',{p_id:requestId,p_property_id:propertyId,p_actor_id:actor,p_payload:payload}))
}catch(error){return assetFailure(error)}}
export async function DELETE(){try{await assetActor();return NextResponse.json({error:'Archive an asset from its library review to retain campaign history and allow restoration.'},{status:409})}catch(error){return assetFailure(error)}}
