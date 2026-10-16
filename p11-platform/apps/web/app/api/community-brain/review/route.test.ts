import {beforeEach,expect,it,vi} from 'vitest'
import {GET} from './route'
const m=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),from:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:m.rpc,from:m.from})}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.getUser}})}))
vi.mock('@/utils/community-brain/retrieval',()=>({prepareCommunityQuery:vi.fn()}))
vi.mock('@/utils/knowledge/material-store',()=>({readMaterials:vi.fn()}))
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',property='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const scope={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',actor_id:actor,org_id:'11111111-1111-1111-1111-111111111111',kind:'community',property_ids:[property],purpose:'research',permission_hash:'a'.repeat(64),policy_revision:1,created_at:'2026-10-16T00:00:00Z',expires_at:'2026-10-16T00:10:00Z'}
let queries:Array<{table:string;eq:ReturnType<typeof vi.fn>}>
beforeEach(()=>{
 vi.resetAllMocks();queries=[]
 m.getUser.mockResolvedValue({data:{user:{id:actor}},error:null})
 m.rpc.mockImplementation(async(name:string)=>({data:name==='brain_resolve_scope'?scope:name==='brain_scope_current'?true:{communities:[]},error:null}))
 m.from.mockImplementation((table:string)=>{
  const chain={select:vi.fn(),eq:vi.fn(),order:vi.fn(),limit:vi.fn()}
  chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.order.mockReturnValue(chain)
  chain.limit.mockResolvedValue({data:table==='knowledge_files'?[{id:'11111111-1111-c111-1111-111111111111',state:'stored',input:{fileName:'original.pdf'}}]:[],error:null})
  queries.push({table,eq:chain.eq});return chain
 })
})
it('lists stored originals with a real validated scope for a seeded organization',async()=>{
 const response=await GET(new Request(`https://console.test/api/community-brain/review?propertyId=${property}`))
 expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store')
 expect((await response.json()).files[0].input.fileName).toBe('original.pdf')
 expect(queries).toHaveLength(2);for(const query of queries)expect(query.eq).toHaveBeenCalledWith('property_id',property)
 expect(m.rpc).toHaveBeenCalledWith('brain_scope_current',{p_scope_id:scope.id,p_property_id:property,p_actor_id:actor})
})
it('does not read file tables when the database resolves a different community',async()=>{
 m.rpc.mockResolvedValue({data:{...scope,property_ids:[other]},error:null})
 expect((await GET(new Request(`https://console.test?propertyId=${property}`))).status).toBe(403)
 expect(m.from).not.toHaveBeenCalled()
})
it('withholds the listing if access changes during the read',async()=>{
 m.rpc.mockImplementation(async(name:string)=>({data:name==='brain_resolve_scope'?scope:name==='brain_scope_current'?false:{},error:null}))
 const response=await GET(new Request(`https://console.test?propertyId=${property}`))
 expect(response.status).toBe(403);expect(await response.text()).not.toContain('original.pdf')
})
it('requires a signed-in user before resolving scope or reading files',async()=>{
 m.getUser.mockResolvedValue({data:{user:null},error:null})
 expect((await GET(new Request(`https://console.test?propertyId=${property}`))).status).toBe(401)
 expect(m.rpc).not.toHaveBeenCalled();expect(m.from).not.toHaveBeenCalled()
})
