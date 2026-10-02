import {expect,it,vi}from 'vitest'
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:vi.fn()}))
import {readLeadDeliveryHistory}from './delivery-history'
const lead='11111111-1111-4111-8111-111111111111',property='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333'
const input:Parameters<typeof readLeadDeliveryHistory>[0]={leadId:lead,propertyId:property,actorId:actor,kind:'schedule' as const,cursor:null}
const run=(result:unknown,request= input)=>{const rpc=vi.fn().mockResolvedValue(result),client={rpc}as unknown as Parameters<typeof readLeadDeliveryHistory>[1];return{rpc,result:readLeadDeliveryHistory(request,client)}}
it('returns complete count and a scoped continuation without raw dispatch data',async()=>{const cursor={id:actor,createdAt:'2026-09-24T00:00:00Z',kind:'schedule',leadId:lead},r=run({data:{state:'ready',work:[{id:actor}],total:1005,nextCursor:cursor}});expect(await r.result).toEqual({work:[{id:actor}],total:1005,nextCursor:Buffer.from(JSON.stringify(cursor)).toString('base64url')});expect(r.rpc).toHaveBeenCalledWith('read_lead_delivery_history',expect.objectContaining({p_actor_id:actor,p_lead_id:lead,p_property_id:property,p_cursor:null}))})
it.each(['bad',Buffer.from(JSON.stringify({id:actor,createdAt:'2026-09-24T00:00:00Z',kind:'workflow',leadId:lead})).toString('base64url')])('rejects malformed and cross-kind cursors',async cursor=>{const r=run({}, {...input,cursor});await expect(r.result).rejects.toMatchObject({status:400});expect(r.rpc).not.toHaveBeenCalled()})
it.each([['forbidden',403],['not_found',404]])('preserves native %s authority',async(state,status)=>{await expect(run({data:{state}}).result).rejects.toMatchObject({status})})
it('keeps read failures distinct from empty history',async()=>{await expect(run({error:{message:'offline'}}).result).rejects.toMatchObject({status:503})})
