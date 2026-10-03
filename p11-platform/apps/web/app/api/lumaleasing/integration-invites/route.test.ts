import {beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({auth:vi.fn(),access:vi.fn(),create:vi.fn(),from:vi.fn(),or:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:d.auth}})}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:d.access}))
vi.mock('@/utils/services/integration-auth-invites',()=>({createIntegrationAuthInvite:d.create,buildExternalIntegrationLink:vi.fn()}))
import {GET,POST} from './route'
const property='33333333-3333-3333-3333-333333333333',requestId='55555555-5555-4555-8555-555555555555'
const input={propertyId:property,requestId,provider:'google',capabilities:['calendar']}
let rows:Record<string,unknown>[],error:unknown
beforeEach(()=>{vi.resetAllMocks();d.auth.mockResolvedValue({data:{user:{id:'actor'}}});d.access.mockResolvedValue({authorized:true});d.create.mockResolvedValue({invite:{id:requestId},url:'https://fixture.invalid/link',actionEventId:requestId});rows=[];error=null;const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,or:d.or,then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:rows,error}).then(resolve)};d.or.mockReturnValue(q);d.from.mockReturnValue(q)})
const post=(body:unknown)=>POST(new NextRequest('http://localhost/api/lumaleasing/integration-invites',{method:'POST',body:JSON.stringify(body)}))
it('requires authentication before creating authority',async()=>{d.auth.mockResolvedValue({data:{user:null}});expect((await post(input)).status).toBe(401);expect(d.create).not.toHaveBeenCalled()})
it('checks property access',async()=>{d.access.mockResolvedValue({authorized:false});expect((await post(input)).status).toBe(403);expect(d.create).not.toHaveBeenCalled()})
it.each([{...input,requestId:undefined},{...input,capabilities:['calendar','invalid']},{...input,expiresAt:'2099-01-01'},{...input,propertyId:'bad'}])('rejects malformed authority input',async body=>{expect((await post(body)).status).toBe(400);expect(d.create).not.toHaveBeenCalled()})
it('returns the recorded creation identity and passes it unchanged',async()=>{const r=await post(input);expect(r.status).toBe(201);expect(await r.json()).toMatchObject({actionEventId:requestId});expect(d.create).toHaveBeenCalledWith({...input,createdByProfileId:'actor'})})
it('reports an unconfirmed creation as failed',async()=>{d.create.mockRejectedValue(new Error('Save unavailable'));expect((await post(input)).status).toBe(500)})
it('paginates and exposes only safe invitation fields',async()=>{rows=Array.from({length:26},(_,i)=>({id:`55555555-5555-4555-8555-${String(i).padStart(12,'0')}`,property_id:property,provider:'google',requested_capabilities:['calendar'],expires_at:'2099-01-01',created_at:'2026-09-16T00:00:00.000Z',created_by_profile_id:i===0?'actor':'other',metadata:{issuedVia:'recorded_v1'}}));const r=await GET(new NextRequest(`http://localhost/api/lumaleasing/integration-invites?propertyId=${property}`)),body=await r.json();expect(body.invites).toHaveLength(25);expect(body.invites[0].recoverable).toBe(true);expect(body.invites[1].recoverable).toBe(false);expect(body.invites[0]).not.toHaveProperty('metadata');expect(body.nextCursor).toBeTruthy();await GET(new NextRequest(`http://localhost/api/lumaleasing/integration-invites?propertyId=${property}&cursor=${body.nextCursor}`));expect(d.or).toHaveBeenCalledWith(expect.stringContaining('created_at.lt.2026-09-16T00:00:00.000Z'))})
it('does not report an empty list on a database failure',async()=>{error={message:'Failed read'};expect((await GET(new NextRequest(`http://localhost/api/lumaleasing/integration-invites?propertyId=${property}`))).status).toBe(500)})
it('rejects malformed cursors',async()=>{expect((await GET(new NextRequest(`http://localhost/api/lumaleasing/integration-invites?propertyId=${property}&cursor=not-a-cursor`))).status).toBe(400);expect(d.from).not.toHaveBeenCalled()})
