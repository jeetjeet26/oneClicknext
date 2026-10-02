import {beforeEach,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
import {admitLumaRead} from './luma-public-read'
const rpc=vi.fn()
const db={rpc} as unknown as Parameters<typeof admitLumaRead>[0]
const req=new NextRequest('http://localhost/test')
beforeEach(()=>vi.resetAllMocks())
it('requires both shared property and actor allowances',async()=>{
 rpc.mockResolvedValue({data:true,error:null})
 expect(await admitLumaRead(db,req,'property',{})).toBe(null)
 expect(rpc).toHaveBeenCalledTimes(2)
 expect(rpc.mock.calls.map(c=>c[1].p_limit)).toEqual([600,120])
})
it('denies exhausted shared capacity before provider work',async()=>{
 rpc.mockResolvedValue({data:false,error:null})
 expect((await admitLumaRead(db,req,'property',{}))?.status).toBe(429)
 expect(rpc).toHaveBeenCalledOnce()
})
it('keeps storage outages distinct from exhausted allowance',async()=>{
 rpc.mockResolvedValue({data:null,error:{message:'offline'}})
 expect((await admitLumaRead(db,req,'property',{}))?.status).toBe(503)
})
