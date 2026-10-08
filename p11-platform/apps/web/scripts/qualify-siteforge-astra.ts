/** Explicit local-only qualification. --start makes one paid Astra request; --poll never starts another. */
import { readFileSync,writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createServiceClient } from '../utils/supabase/admin'
import { savePackageRequest,getPackageJob } from '../utils/siteforge/packages/store'
import { processPackage } from '../utils/siteforge/packages/runner'
import { sha256 } from '../utils/siteforge/packages/source'

async function main() {
  if(!['localhost','127.0.0.1'].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname)) throw new Error('Qualification requires local Supabase')
  const receipt='/private/tmp/p11-astra-qualification.json'
  if(process.argv.includes('--poll')) {
    const {jobId}=JSON.parse(readFileSync(receipt,'utf8'))
    const job=await processPackage(jobId)
    console.log(JSON.stringify({id:job.id,state:job.state,error:job.error_message,bytes:job.package_bytes}))
    return
  }
  if(!process.argv.includes('--start')) throw new Error('Choose --start or --poll')
  const db=createServiceClient()
  const {data:base,error}=await db.from('properties').select('org_id').eq('id','33333333-3333-3333-3333-333333333333').single()
  if(error||!base?.org_id) throw new Error('Local demo organization missing')
  const {data:actor}=await db.from('profiles').select('id').eq('org_id',base.org_id).eq('role','admin').limit(1).single()
  if(!actor) throw new Error('Local manager missing')
  const id=randomUUID(),assetId=randomUUID(),unitId=randomUUID(),jobId=randomUUID()
  const checked=async(result:{error:unknown})=>{if(result.error)throw result.error}
  await checked(await db.from('properties').insert({id,org_id:base.org_id,name:'Astra local qualification — not a client',property_type:'multifamily',amenities:['Resident courtyard'],address:{city:'Local preview'},brand_voice:'Clear and understated'}))
  const png=new Uint8Array(readFileSync('public/siteforge/property-placeholder.png'))
  const existing=await db.storage.getBucket('siteforge-qualification')
  if(existing.error) await checked(await db.storage.createBucket('siteforge-qualification',{public:false,allowedMimeTypes:['image/png']}))
  const path=`${id}/placeholder.png`
  await checked(await db.storage.from('siteforge-qualification').upload(path,png,{contentType:'image/png'}))
  await checked(await db.from('content_assets').insert({id:assetId,org_id:base.org_id,property_id:id,name:'Qualification placeholder diagram — not actual property photography',asset_type:'image',asset_role:'floorplan',file_url:`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/siteforge-qualification/${path}`,storage_bucket:'siteforge-qualification',storage_path:path,approval_status:'approved',curation_status:'approved',rights_status:'owned',content_hash:sha256(png),alt_text:'Test diagram used to verify the floorplan handoff'}))
  await checked(await db.from('property_units').insert({id:unitId,property_id:id,org_id:base.org_id,canonical_key:'qualification-one-bedroom',unit_type:'Test one bedroom',bedrooms:1,bathrooms:1,sqft_min:700,sqft_max:700,review_status:'approved',floor_plan_image_asset_id:assetId,floor_plan_image_url:`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/siteforge-qualification/${path}`}))
  const job=await savePackageRequest({requestId:jobId,propertyId:id,parentId:null,target:'standalone',instructions:'Build a compact, polished two-page demonstration site: Home and Floorplans. Label it clearly as a local qualification preview, not an actual available property. Use the saved floorplan image as a test diagram. No contact forms or invented contact details. Warm ivory background, restrained rust accents, generous spacing. Verify local links, the mobile layout, and the floorplan association.'},{id:actor.id,orgId:base.org_id})
  writeFileSync(receipt,JSON.stringify({jobId:job.id,propertyId:id,assetId,unitId},null,2),{mode:0o600})
  await processPackage(job.id)
  const result=await getPackageJob(job.id)
  console.log(JSON.stringify({id:result.id,state:result.state,error:result.error_message}))
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1})
