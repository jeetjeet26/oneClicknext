import {NextRequest,NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess,validatePropertyManagerAccess} from '@/utils/services/auth-guard'
import {studioConfigurationSchema,studioConfigurationValue} from '@/utils/forgestudio/configuration'
import {editorialRpc,ContentStoreError} from '@/utils/forgestudio/content-store'
const requestSchema=z.object({propertyId:z.string().uuid(),requestId:z.string().uuid(),expectedVersion:z.number().int().min(0).max(2147483647),config:studioConfigurationSchema}).strict()
export async function GET(request:NextRequest){
 try{
  const {data:{user},error:authError}=await(await createClient()).auth.getUser();if(authError||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const parsed=z.string().uuid().safeParse(request.nextUrl.searchParams.get('propertyId'));if(!parsed.success)return NextResponse.json({error:'A valid property is required.'},{status:400})
  const propertyId=parsed.data;if(!(await validatePropertyAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Forbidden'},{status:403})
  const {data,error}=await createServiceClient().from('forgestudio_config').select('id,configuration_version,brand_voice,target_audience,key_amenities,include_hashtags,include_cta,max_caption_length').eq('property_id',propertyId).maybeSingle()
  if(error)return NextResponse.json({error:'Saved studio settings could not be loaded. Reload before editing.'},{status:503})
  return NextResponse.json({config:studioConfigurationValue(data),version:data?.configuration_version??0,isDefault:!data})
 }catch{return NextResponse.json({error:'Studio settings are unavailable. Reload before editing.'},{status:503})}
}
export async function POST(request:NextRequest){
 try{
  const {data:{user},error:authError}=await(await createClient()).auth.getUser();if(authError||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
  const parsed=requestSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Check the supported settings and reload if the form is outdated.'},{status:400})
  const {propertyId,requestId,expectedVersion,config}=parsed.data
  if(!(await validatePropertyManagerAccess(user.id,propertyId)).authorized)return NextResponse.json({error:'Saving studio settings requires current manager access.'},{status:403})
  return NextResponse.json(await editorialRpc('save_forgestudio_configuration',requestId,propertyId,user.id,{expectedVersion,config}))
 }catch(error){return NextResponse.json({error:error instanceof ContentStoreError?error.message:'The save response was interrupted. Retry the same save to confirm its result.'},{status:error instanceof ContentStoreError?error.statusCode:503})}
}
