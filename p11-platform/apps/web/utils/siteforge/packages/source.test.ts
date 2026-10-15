import { beforeEach,describe,it,expect,vi } from 'vitest'
import { unzipSync,strFromU8 } from 'fflate'
const mocks=vi.hoisted(()=>({download:vi.fn(),fetch:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({storage:{from:()=>({download:mocks.download})}})}))
vi.mock('@/utils/services/safe-public-fetch',()=>({safePublicFetch:mocks.fetch}))
import { assembleSourceArchive,sha256,type PackageSource } from './source'
const bytes=new Uint8Array([137,80,78,71])
function fixture(){return {version:1,property:{id:'property',name:'Demo'},brand:null,direction:null,floorplans:[{id:'plan-a',unit_type:'One bedroom',floor_plan_image_asset_id:'asset-a',floor_plan_image_url:'https://obsolete.invalid/old.png'}],assets:[{id:'asset-a',property_id:'property',asset_role:'floorplan',name:'Approved diagram',storage_bucket:'assets',storage_path:'property/diagram.png',file_url:'https://current.example/diagram.png',content_hash:sha256(bytes)}],warnings:[]} as unknown as PackageSource}
describe('saved property and floorplan handoff',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.download.mockResolvedValue({data:new Blob([bytes],{type:'image/png'}),error:null})})
  it('packages the actual approved bytes and keeps every floorplan association',async()=>{
    const source=fixture();source.floorplans.push({...source.floorplans[0],id:'plan-b'})
    const files=unzipSync(await assembleSourceArchive(source,{id:'build',sourceHash:'hash',target:'standalone'}))
    expect(files['assets/asset-a.png']).toEqual(bytes)
    expect(JSON.parse(strFromU8(files['source-manifest.json'])).files[0]).toMatchObject({id:'asset-a',floorplanIds:['plan-a','plan-b'],sha256:sha256(bytes)})
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not substitute an unapproved linked image with an old public URL',async()=>{
    const source=fixture();source.assets=[]
    await expect(assembleSourceArchive(source,{id:'build',sourceHash:'hash',target:'standalone'})).rejects.toThrow('Approve the saved image')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('never associates an obsolete URL when a canonical asset ID exists',async()=>{
    const source=fixture()
    source.assets.push({...source.assets[0],id:'obsolete',file_url:source.floorplans[0].floor_plan_image_url!})
    const files=unzipSync(await assembleSourceArchive(source,{id:'build',sourceHash:'hash',target:'standalone'}))
    const manifest=JSON.parse(strFromU8(files['source-manifest.json']))
    expect(manifest.files.find((file:{id:string})=>file.id==='obsolete').floorplanIds).toEqual([])
    expect(manifest.files.find((file:{id:string})=>file.id==='asset-a').floorplanIds).toEqual(['plan-a'])
  })
  it('rejects ambiguous legacy URL matches',async()=>{
    const source=fixture();source.floorplans[0].floor_plan_image_asset_id=null
    source.floorplans[0].floor_plan_image_url=source.assets[0].file_url
    source.assets.push({...source.assets[0],id:'another'})
    await expect(assembleSourceArchive(source,{id:'build',sourceHash:'hash',target:'standalone'})).rejects.toThrow('ambiguous')
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('rejects photos used as exact floorplans',async()=>{
    const source=fixture();source.assets[0].asset_role='property_photo'
    await expect(assembleSourceArchive(source,{id:'build',sourceHash:'hash',target:'standalone'})).rejects.toThrow('floorplan')
    expect(mocks.download).not.toHaveBeenCalled()
  })
  it('rejects a file that changed after approval before uploading it to Astra',async()=>{
    const source=fixture();source.assets[0].content_hash='a'.repeat(64)
    await expect(assembleSourceArchive(source,{id:'build',sourceHash:'hash',target:'standalone'})).rejects.toThrow('changed since it was approved')
  })
  it('does not claim a complete handoff if approved media cannot be downloaded',async()=>{
    mocks.download.mockResolvedValue({data:null,error:new Error('unavailable')})
    await expect(assembleSourceArchive(fixture(),{id:'build',sourceHash:'hash',target:'standalone'})).rejects.toThrow('could not be included')
  })
})
