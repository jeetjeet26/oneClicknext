import { createHash } from 'node:crypto'
import { zipSync, strToU8 } from 'fflate'
import { createServiceClient } from '@/utils/supabase/admin'
import { safePublicFetch } from '@/utils/services/safe-public-fetch'
import { normalizeBrandAssetRow } from '@/utils/brandforge/normalize'
import { PackageError } from './contracts'
import { componentGuides } from '@/utils/intelligence/components'

export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export async function loadPackageSource(propertyId: string) {
  const db = createServiceClient()
  const [property, brand, units, assets, directionSet, legal, neighborhood] = await Promise.all([
    db.from('properties').select('id,name,address,property_type,unit_count,year_built,amenities,pet_policy,parking_info,special_features,brand_voice,target_audience,office_hours,social_media,website_url,updated_at').eq('id',propertyId).single(),
    db.from('property_brand_assets').select('id,revision,approval_status,contract_hash,contract_version,brand_origin,approved_at,section_1_introduction,section_2_positioning,section_3_target_audience,section_4_personas,section_5_name_story,section_6_logo,section_7_typography,section_8_colors,section_9_design_elements,section_10_photo_yep,section_11_photo_nope,section_12_implementation').eq('property_id',propertyId).eq('approval_status','approved').order('revision',{ascending:false}).limit(1).maybeSingle(),
    db.from('property_units').select('id,unit_type,bedrooms,bathrooms,sqft_min,sqft_max,rent_min,rent_max,deposit,available_count,move_in_specials,floor_plan_image_url,floor_plan_image_alt,floor_plan_image_asset_id,availability_url,apply_url,source,source_url,source_updated_at,effective_at,expires_at,last_updated_at,review_status').eq('property_id',propertyId).eq('active',true).eq('review_status','approved').order('id').limit(501),
    db.from('content_assets').select('id,name,description,file_url,asset_role,content_hash,storage_bucket,storage_path,alt_text,rights_status,expires_at,updated_at,format').eq('property_id',propertyId).eq('approval_status','approved').is('duplicate_of',null).is('archived_at',null).order('id').limit(201),
    db.from('siteforge_creative_direction_sets').select('id,selected_direction_id,approved_at').eq('property_id',propertyId).eq('status','approved').order('approved_at',{ascending:false}).limit(1).maybeSingle(),
    db.from('property_legal_configs').select('id,version,jurisdiction,legal_entity_name,privacy_policy,terms,accessibility,fair_housing,pricing_disclaimer,analytics_consent,communications_consent,effective_at,approved_at').eq('property_id',propertyId).eq('status','approved').lte('effective_at',new Date().toISOString()).order('version',{ascending:false}).limit(1).maybeSingle(),
    db.from('property_points_of_interest').select('id,name,category,address,latitude,longitude,distance_miles,travel_time_minutes,source_url,captured_at,approved_at').eq('property_id',propertyId).eq('approval_status','approved').order('id').limit(201),
  ])
  if ([property,brand,units,assets,directionSet,legal,neighborhood].some(r=>r.error) || !property.data) throw new PackageError('Saved property information could not be loaded. Try again.')
  if((neighborhood.data?.length??0)>200) throw new PackageError('This property exceeds the current limit of 200 approved neighborhood locations.',422)
  if ((units.data?.length??0)>500 || (assets.data?.length??0)>200) throw new PackageError('This property exceeds the current package limit of 500 floorplans or 200 approved assets.',422)
  let direction: unknown = null
  if(directionSet.data?.selected_direction_id) {
    const result = await db.from('siteforge_creative_directions').select('id,name,direction,content_hash').eq('id',directionSet.data.selected_direction_id).eq('property_id',propertyId).single()
    if(result.error) throw new PackageError('The approved creative direction could not be loaded.')
    direction=result.data
  }
  const warnings: string[]=[]
  if(!brand.data) warnings.push('No approved brand is saved. A visual direction will be proposed for review.')
  if(!units.data?.length) warnings.push('No approved floorplans are available for this package.')
  if(!assets.data?.length) warnings.push('No approved images are available. The design will not invent property photography.')
  if(!legal.data) warnings.push('Approved legal copy is not available. Complete the legal pages before publishing.')
  if(assets.data?.some(a=>a.expires_at && Date.parse(a.expires_at)<Date.now())) warnings.push('Some approved media have expired usage dates. Review image rights before publication.')
  const floorplans=(units.data??[]).map(unit=>{
    // Snapshot prices are never represented as a live feed. Expired inventory must not advertise stale prices.
    if(unit.expires_at && Date.parse(unit.expires_at)<Date.now()) {
      warnings.push(`Pricing and availability for ${unit.unit_type} have expired and will be omitted.`)
      return {...unit,rent_min:null,rent_max:null,deposit:null,available_count:null,move_in_specials:null}
    }
    return unit
  })
  const { canonicalInformation }=await import('@/utils/intelligence/store')
  const canonical=await canonicalInformation(propertyId)
  if(canonical.excludedFacts) warnings.push(`${canonical.excludedFacts} property facts are draft, private, expired or due for review and were excluded.`)
  const source={version:2,canonical,componentGuides,property:property.data,brand:brand.data ? normalizeBrandAssetRow(brand.data) : null,brandEvidence:brand.data?{id:brand.data.id,revision:brand.data.revision,hash:brand.data.contract_hash,approvedAt:brand.data.approved_at}:null,direction,floorplans,assets:assets.data??[],legal:legal.data,neighborhood:neighborhood.data??[],warnings}
  return {source,hash:sha256(stableJson(source))}
}
export type PackageSource = Awaited<ReturnType<typeof loadPackageSource>>['source']

const mediaTypes: Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','application/pdf':'pdf','font/woff2':'woff2','font/woff':'woff','font/ttf':'ttf','font/otf':'otf','video/mp4':'mp4','video/webm':'webm'}
export async function assembleSourceArchive(source: PackageSource, identity: {id:string;sourceHash:string;target:string}) {
  const files: Record<string,Uint8Array>={}
  const manifest: Array<{id:string;path:string;sha256:string;sourceUrl:string|null;floorplanIds:string[]}>=[]
  const db=createServiceClient()
  const items=source.assets.map(a=>({...a,floorplanIds:source.floorplans.filter(u=>u.floor_plan_image_asset_id===a.id || u.floor_plan_image_url===a.file_url).map(u=>u.id)}))
  for(const unit of source.floorplans) {
    if(unit.floor_plan_image_asset_id) {
      if(!source.assets.some(a=>a.id===unit.floor_plan_image_asset_id)) throw new PackageError(`Approve the saved image for ${unit.unit_type} before generating.`,422)
      continue // The approved asset ID is authoritative; a legacy URL may point to an older file.
    }
    if(unit.floor_plan_image_url && !items.some(a=>a.file_url===unit.floor_plan_image_url)) items.push({id:`floorplan-${unit.id}`,name:unit.unit_type,description:null,file_url:unit.floor_plan_image_url,asset_role:'floorplan',content_hash:null,storage_bucket:null,storage_path:null,alt_text:unit.floor_plan_image_alt,rights_status:'unknown',expires_at:null,updated_at:unit.last_updated_at??'',format:null,floorplanIds:[unit.id]})
  }
  for(const [index,logo] of (source.brand?.logos.variants??[]).entries()) {
    if(logo.assetId) {
      if(!source.assets.some(a=>a.id===logo.assetId)) throw new PackageError('An approved brand logo is missing from the approved media library. Review the logo before generating.',422)
      continue
    }
    if(logo.url && !items.some(a=>a.file_url===logo.url)) items.push({id:`brand-logo-${index}`,name:`Approved ${logo.role} logo`,description:null,file_url:logo.url,asset_role:'primary_logo',content_hash:null,storage_bucket:null,storage_path:null,alt_text:logo.alt,rights_status:'unknown',expires_at:null,updated_at:'',format:null,floorplanIds:[]})
  }
  for(const font of source.brand?.typography.roles??[]) {
    if(font.assetId && !source.assets.some(a=>a.id===font.assetId)) throw new PackageError(`The saved ${font.family} font is missing from approved media. Review the font before generating.`,422)
  }
  let total=0
  for(const item of items) {
    let bytes:Uint8Array, type:string
    if(item.storage_bucket && item.storage_path) {
      const result=await db.storage.from(item.storage_bucket).download(item.storage_path)
      if(result.error || !result.data) throw new PackageError(`The approved file “${item.name}” could not be included. Check the saved asset.`,422)
      if(result.data.size>5_000_000) throw new PackageError(`“${item.name}” exceeds the 5 MB file limit.`,422)
      type=result.data.type.split(';')[0]; bytes=new Uint8Array(await result.data.arrayBuffer())
    } else {
      if(!item.file_url) throw new PackageError(`“${item.name}” has no saved file.`,422)
      const response=await safePublicFetch(item.file_url,{maxBytes:5_000_000})
      if(!response.ok) throw new PackageError(`The approved file “${item.name}” could not be downloaded.`,422)
      type=(response.headers.get('content-type')??'').split(';')[0];bytes=new Uint8Array(await response.arrayBuffer())
    }
    const extension=mediaTypes[type]
    if(!extension) throw new PackageError(`“${item.name}” is not a supported website media file.`,422)
    total+=bytes.length
    if(total>35_000_000) throw new PackageError('Approved media exceed the 35 MB package input limit.',422)
    const hash=sha256(bytes)
    if(item.content_hash && /^[a-f0-9]{64}$/i.test(item.content_hash) && item.content_hash!==hash) throw new PackageError(`“${item.name}” changed since it was approved. Review it before generating.`,409)
    const path=`assets/${item.id}.${extension}`
    files[path]=bytes
    manifest.push({id:item.id,path,sha256:hash,sourceUrl:item.file_url,floorplanIds:item.floorplanIds})
  }
  files['property.json']=strToU8(JSON.stringify(source,null,2))
  files['source-manifest.json']=strToU8(JSON.stringify({...identity,model:'gpt-6-astra',files:manifest},null,2))
  return zipSync(files,{level:1})
}
