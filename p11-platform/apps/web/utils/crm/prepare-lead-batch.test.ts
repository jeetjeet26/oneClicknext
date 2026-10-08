import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {syncLeadBatch} from './prepare-lead-batch'
const d=vi.hoisted(()=>({ack:vi.fn(),saved:vi.fn()}))
vi.mock('./client',async()=>{const actual=await vi.importActual<typeof import('./client')>('./client');return {...actual,savedCRMRequest:d.saved}})
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks()})
beforeEach(()=>d.saved.mockImplementation(async(_action,input)=>({body:{...input,requestId:batch},acknowledge:d.ack})))
const property='2f0de51e-2b63-4b4a-80c8-29855647fed0',batch='11111111-1111-4111-8111-111111111111'
const snapshot=(extra={})=>({batchId:batch,manifestHash:'a'.repeat(64),canApproveOwnBatch:true,approved:false,items:[{leadId:'a',leadName:'Test',state:'queued',stale:false}],...extra})
function responses(...values:unknown[]){const send=vi.fn();for(const value of values)send.mockResolvedValueOnce(value instanceof Response?value:Response.json(value));vi.stubGlobal('fetch',send);return send}
it('one click prepares and authorizes only the selected leads using the saved manifest',async()=>{
 const send=responses({batchId:batch},snapshot(),{batchId:batch,state:'applied'})
 expect(await syncLeadBatch(property,['a'])).toEqual({message:'1 queued for CRM sync.',issues:[]})
 expect(send).toHaveBeenCalledTimes(3)
 expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({action:'prepare',leadIds:['a'],propertyId:property})
 expect(JSON.parse(send.mock.calls[2][1].body)).toMatchObject({action:'approve',batchId:batch,manifestHash:'a'.repeat(64),propertyId:property})
 expect(d.ack).toHaveBeenCalledTimes(2)
})
it('does not send existing contacts again and reports missing contact details by lead',async()=>{
 const send=responses({batchId:batch},snapshot({items:[{leadId:'a',leadName:'Test',state:'already_linked'},{leadId:'b',leadName:'Missing',state:'contact_required'}]}))
 const result=await syncLeadBatch(property,['b','a']);expect(result.message).toContain('already in CRM');expect(result.issues).toEqual(['Missing: Add an email address or phone number.']);expect(send).toHaveBeenCalledTimes(2)
})
it.each([{deliveryPaused:true},{stopped:true},{canApproveOwnBatch:false},{items:[{leadId:'a',state:'queued',stale:true}]}])('does not authorize a paused or changed selection %j',async(extra)=>{
 const send=responses({batchId:batch},snapshot(extra));await expect(syncLeadBatch(property,['a'])).rejects.toThrow();expect(send).toHaveBeenCalledTimes(2);expect(d.ack).not.toHaveBeenCalled()
})
it('retains both identities when approval response is lost',async()=>{
 responses({batchId:batch},snapshot(),Response.json({error:'Unknown result'},{status:503}))
 await expect(syncLeadBatch(property,['a'])).rejects.toThrow('Unknown result');expect(d.ack).not.toHaveBeenCalled()
})
it('recognizes previously approved selection on retry without authorizing another transfer',async()=>{
 const send=responses({batchId:batch},snapshot({approved:true}));expect((await syncLeadBatch(property,['a'])).message).toContain('queued');expect(send).toHaveBeenCalledTimes(2);expect(d.ack).toHaveBeenCalledOnce()
})
it('rejects an unexpected selection',async()=>{
 const send=responses({batchId:batch},snapshot());await expect(syncLeadBatch(property,['b'])).rejects.toThrow('selected leads');expect(send).toHaveBeenCalledTimes(2);expect(d.ack).not.toHaveBeenCalled()
})
it('does not acknowledge an ambiguous prepare success',async()=>{
 responses({message:'OK'});await expect(syncLeadBatch(property,['a'])).rejects.toThrow('could not be confirmed');expect(d.ack).not.toHaveBeenCalled()
})
