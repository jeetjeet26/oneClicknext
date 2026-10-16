import {beforeEach,describe,expect,it,vi} from 'vitest'
import {brainRpc,resolveCommunityScope,resolvePortfolioScope} from './server'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc:mocks.rpc})}))
vi.mock('@/utils/supabase/server',()=>({createClient:vi.fn()}))
vi.mock('./retrieval',()=>({prepareCommunityQuery:vi.fn()}))
beforeEach(()=>vi.resetAllMocks())
describe('community operation errors',()=>{
 it('explains duplicate asset bytes without exposing database details',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'23505',message:'duplicate key value violates unique constraint "content_assets_property_content_hash_idx"',details:'private row data'}})
  await expect(brainRpc('brain_review_asset',{})).rejects.toMatchObject({status:409,message:'These exact file bytes already exist in this community’s asset library. Review the existing asset before adding another copy.'})
 })
 it('does not misidentify unrelated identity conflicts as duplicate assets',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'23505',message:'private database detail'}})
  await expect(brainRpc('brain_review_asset',{})).rejects.toMatchObject({status:409,message:'A saved record already uses this identity. Refresh the community records before trying again.'})
 })
 it('keeps permission failures opaque',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'private database detail'}})
  await expect(brainRpc('brain_review_asset',{})).rejects.toMatchObject({status:403,message:'The selected community access is unavailable.'})
 })
 it('keeps unexpected database failures opaque',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'XX000',message:'private database detail'}})
  await expect(brainRpc('brain_review_asset',{})).rejects.toMatchObject({status:503,message:'The community operation could not be confirmed.'})
 })
})

const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const property='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const other='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const databaseScope={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',actor_id:actor,org_id:'11111111-1111-1111-1111-111111111111',kind:'community',property_ids:[property],purpose:'research',permission_hash:'a'.repeat(64),policy_revision:1,created_at:'2026-10-16T00:00:00Z',expires_at:'2026-10-16T00:10:00Z'}
describe('database-backed community scopes',()=>{
 it('accepts a seeded organization ID returned by PostgreSQL',async()=>{
  mocks.rpc.mockResolvedValue({data:{...databaseScope,property_ids:[property]},error:null})
  const scope=await resolveCommunityScope(actor,property,'research')
  expect(scope.org_id).toBe(databaseScope.org_id)
  expect(Object.isFrozen(scope)).toBe(true)
  expect(Object.isFrozen(scope.property_ids)).toBe(true)
 })
 it('accepts a deterministic community ID without RFC version bits',async()=>{
  const id='11111111-1111-c111-1111-111111111111'
  mocks.rpc.mockResolvedValue({data:{...databaseScope,property_ids:[id]},error:null})
  await expect(resolveCommunityScope(actor,id,'research')).resolves.toMatchObject({property_ids:[id]})
 })
 it.each([
  {actor_id:other}, {property_ids:[other]}, {purpose:'manage'},
 ])('still rejects a scope belonging to a different request: %j',async mismatch=>{
  mocks.rpc.mockResolvedValue({data:{...databaseScope,...mismatch},error:null})
  await expect(resolveCommunityScope(actor,property,'research')).rejects.toMatchObject({status:403})
 })
 it('does not describe malformed server scope data as a bad client request',async()=>{
  mocks.rpc.mockResolvedValue({data:{...databaseScope,org_id:'invalid'},error:null})
  await expect(resolveCommunityScope(actor,property,'research')).rejects.toMatchObject({status:503,message:'Community access could not be confirmed. Refresh and try again.'})
 })
 it('checks the exact selected portfolio membership with seeded organization IDs',async()=>{
  mocks.rpc.mockResolvedValue({data:{...databaseScope,kind:'portfolio',purpose:'portfolio',property_ids:[other,property]},error:null})
  await expect(resolvePortfolioScope(actor,[property,other])).resolves.toMatchObject({kind:'portfolio'})
  await expect(resolvePortfolioScope(actor,[property])).rejects.toMatchObject({status:403})
 })
})
