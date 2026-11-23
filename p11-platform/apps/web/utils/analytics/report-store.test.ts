import {expect,it,vi} from 'vitest'
import {biRpc} from './report-store'
const args={p_property_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}
it('distinguishes forbidden, failed and successfully empty report reads',async()=>{
  const rpc=vi.fn()
  rpc.mockResolvedValueOnce({data:null,error:{code:'42501'}})
  await expect(biRpc('bi_report_source',args,{rpc})).rejects.toMatchObject({status:403})
  rpc.mockResolvedValueOnce({data:null,error:{code:'08006'}})
  await expect(biRpc('bi_report_source',args,{rpc})).rejects.toThrow('Campaign data could not be loaded')
  const empty={state:'ready',propertyId:args.p_property_id,source:{currentRows:[]}}
  rpc.mockResolvedValueOnce({data:empty,error:null})
  await expect(biRpc('bi_report_source',args,{rpc})).resolves.toEqual(empty)
})
