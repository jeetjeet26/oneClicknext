import {afterEach,expect,it,vi} from 'vitest'
import {prepareLeadBatch} from './prepare-lead-batch'
const d=vi.hoisted(()=>({ack:vi.fn(),saved:vi.fn()}))
vi.mock('./client',async()=>{const actual=await vi.importActual<typeof import('./client')>('./client');return {...actual,savedCRMRequest:d.saved}})
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
const property='2f0de51e-2b63-4b4a-80c8-29855647fed0',batch='11111111-1111-4111-8111-111111111111'
it('prepares selected leads and returns the exact saved review, without approving delivery',async()=>{
 d.saved.mockImplementation(async(_action,input)=>({body:{...input,requestId:batch},acknowledge:d.ack}))
 const send=vi.fn().mockResolvedValue(Response.json({state:'saved',batchId:batch}));vi.stubGlobal('fetch',send)
 expect(await prepareLeadBatch(property,['b','a'])).toBe(`/dashboard/settings/crm?propertyId=${property}&batchId=${batch}`)
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toBe('/api/crm/batches');expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({action:'prepare',leadIds:['a','b'],propertyId:property});expect(d.ack).toHaveBeenCalledOnce()
})
it('keeps the request identity and exposes an unsuccessful response instead of reporting success',async()=>{
 d.saved.mockResolvedValue({body:{requestId:batch},acknowledge:d.ack});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'Selection changed'},{status:409})))
 await expect(prepareLeadBatch(property,['a'])).rejects.toThrow('Selection changed');expect(d.ack).not.toHaveBeenCalled()
})
it('does not acknowledge an ambiguous success without a saved batch',async()=>{
 d.saved.mockResolvedValue({body:{requestId:batch},acknowledge:d.ack});vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({message:'OK'})))
 await expect(prepareLeadBatch(property,['a'])).rejects.toThrow('could not be confirmed');expect(d.ack).not.toHaveBeenCalled()
})
