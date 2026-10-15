import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {downloadCheckedAsset} from './download'
import type {CommunityScope} from './contracts'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),current:vi.fn(),download:vi.fn()}))
vi.mock('./server',()=>({brainRpc:mocks.rpc,requireCurrentScope:mocks.current}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({storage:{from:()=>({download:mocks.download})}})}))
const scope={id:'scope',actor_id:'actor',property_ids:['A']} as CommunityScope
const bytes=Buffer.from('original floorplan bytes'),hash=createHash('sha256').update(bytes).digest('hex')
const asset={id:'drawing',propertyId:'A',name:'Floorplan A',bucket:'knowledge-originals',path:'A/drawing/page.png',hash,format:'png',revision:1}
beforeEach(()=>{vi.resetAllMocks();mocks.rpc.mockResolvedValue(asset);mocks.current.mockResolvedValue(undefined);mocks.download.mockResolvedValue({data:new Blob([bytes],{type:'image/png'}),error:null})})
describe('private exact asset delivery',()=>{
 it('returns checksum-verified original bytes after a second access/version check',async()=>{const result=await downloadCheckedAsset(scope,'A','drawing');expect(result.bytes.equals(bytes)).toBe(true);expect(mocks.rpc).toHaveBeenCalledTimes(2);expect(mocks.current).toHaveBeenCalledTimes(2)})
 it('rejects a foreign asset before fetching its bytes',async()=>{mocks.rpc.mockResolvedValue({...asset,propertyId:'B'});await expect(downloadCheckedAsset(scope,'A','drawing')).rejects.toMatchObject({status:403});expect(mocks.download).not.toHaveBeenCalled()})
 it('rejects changed retained bytes',async()=>{mocks.download.mockResolvedValue({data:new Blob(['changed']),error:null});await expect(downloadCheckedAsset(scope,'A','drawing')).rejects.toMatchObject({status:409})})
 it('withholds bytes when rights change during the storage read',async()=>{mocks.rpc.mockResolvedValueOnce(asset).mockResolvedValueOnce({...asset,revision:2});await expect(downloadCheckedAsset(scope,'A','drawing')).rejects.toMatchObject({status:409})})
 it('withholds bytes after permission revocation',async()=>{mocks.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(Error('revoked'),{status:403}));await expect(downloadCheckedAsset(scope,'A','drawing')).rejects.toMatchObject({status:403})})
 it('enforces the remaining archive capacity',async()=>{await expect(downloadCheckedAsset(scope,'A','drawing',3)).rejects.toMatchObject({status:413})})
})
