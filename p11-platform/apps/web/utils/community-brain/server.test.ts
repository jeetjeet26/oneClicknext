import {beforeEach,describe,expect,it,vi} from 'vitest'
import {brainRpc} from './server'
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
