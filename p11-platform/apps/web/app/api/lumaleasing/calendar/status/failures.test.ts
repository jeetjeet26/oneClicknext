import {beforeEach,expect,it,vi}from 'vitest'
import type {NextRequest}from 'next/server'
const d=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from,rpc:d.rpc})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:async()=>({authorized:true})}))
import {GET}from './route'
beforeEach(()=>vi.resetAllMocks())
it.each(['connection','summary'])('never converts a failed %s read into healthy empty state',async failing=>{d.from.mockImplementation(()=>{const result=failing==='connection'?{data:null,error:new Error('Fixture read failure')}:{data:{id:'calendar',provider:'microsoft',token_status:'healthy',sync_enabled:true,token_expires_at:'2099-01-01'},error:null};const q={select:()=>q,eq:()=>q,is:()=>q,maybeSingle:async()=>result};return q});d.rpc.mockResolvedValue({data:null,error:new Error('Summary unavailable')});const r=await GET(new Request('http://localhost/api/lumaleasing/calendar/status?propertyId=property')as NextRequest);expect(r.status).toBe(500);expect(await r.json()).not.toHaveProperty('connected');if(failing==='summary')expect(d.rpc).toHaveBeenCalledWith('read_calendar_sync_summary',{p_property_id:'property',p_calendar_id:'calendar',p_actor_id:'actor'})})
