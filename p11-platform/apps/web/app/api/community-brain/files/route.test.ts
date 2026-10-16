import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import {GET} from './route'
const m=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),download:vi.fn(),bucket:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:m.rpc,storage:{from:m.bucket}})}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.getUser}})}))
vi.mock('@/utils/community-brain/retrieval',()=>({prepareCommunityQuery:vi.fn()}))
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',property='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',file='11111111-1111-c111-1111-111111111111'
const bytes=new TextEncoder().encode('Retained original'),hash=createHash('sha256').update(bytes).digest('hex')
const scope={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',actor_id:actor,org_id:'11111111-1111-1111-1111-111111111111',kind:'community',property_ids:[property],purpose:'download',permission_hash:'a'.repeat(64),policy_revision:1,created_at:'2026-10-16T00:00:00Z',expires_at:'2026-10-16T00:10:00Z'}
const detail={sourceCurrent:true,file:{property_id:property,state:'stored',storage_path:`${property}/${file}/original.txt`,input:{byteHash:hash,fileName:'original.txt',mimeType:'text/plain',size:bytes.length}}}
const request=()=>new Request(`https://console.test/api/community-brain/files?propertyId=${property}&fileId=${file}`)
beforeEach(()=>{
 vi.resetAllMocks();m.getUser.mockResolvedValue({data:{user:{id:actor}},error:null})
 m.bucket.mockReturnValue({download:m.download});m.download.mockResolvedValue({data:new Blob([bytes]),error:null})
 m.rpc.mockImplementation(async(name:string)=>({data:name==='brain_resolve_scope'?scope:name==='brain_scope_current'?true:detail,error:null}))
})
it('downloads exact retained bytes with seeded organization and deterministic file IDs',async()=>{
 const response=await GET(request());expect(response.status).toBe(200)
 expect(await response.text()).toBe('Retained original')
 expect(response.headers.get('Cache-Control')).toBe('private, no-store')
 expect(response.headers.get('Content-Disposition')).toContain('attachment')
 expect(m.bucket).toHaveBeenCalledWith('knowledge-originals')
 expect(m.rpc).toHaveBeenCalledWith('brain_resolve_scope',{p_actor_id:actor,p_property_ids:[property],p_purpose:'download'})
 expect(m.rpc.mock.calls.filter(([name])=>name==='brain_file_detail')).toHaveLength(2)
})
it.each([
 {sourceCurrent:false},
 {file:{...detail.file,property_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}},
 {file:{...detail.file,storage_path:'another-community/original.txt'}},
])('never reads bytes for a stale or foreign original: %j',async patch=>{
 m.rpc.mockImplementation(async(name:string)=>({data:name==='brain_resolve_scope'?scope:{...detail,...patch},error:null}))
 expect((await GET(request())).status).toBeGreaterThanOrEqual(400);expect(m.download).not.toHaveBeenCalled()
})
it('withholds bytes whose checksum changed',async()=>{
 m.download.mockResolvedValue({data:new Blob(['Tampered original']),error:null})
 const response=await GET(request());expect(response.status).toBe(409);expect(await response.text()).not.toContain('Tampered')
})
it('withholds bytes if permission changes during download',async()=>{
 m.rpc.mockImplementation(async(name:string)=>({data:name==='brain_resolve_scope'?scope:name==='brain_scope_current'?false:detail,error:null}))
 const response=await GET(request());expect(response.status).toBe(403);expect(await response.text()).not.toContain('Retained original')
})
it('honors the disabled download capability before reading storage',async()=>{
 m.rpc.mockResolvedValue({data:null,error:{code:'42501'}})
 expect((await GET(request())).status).toBe(403);expect(m.download).not.toHaveBeenCalled()
})
