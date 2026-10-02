import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({actor:vi.fn(),read:vi.fn(),decide:vi.fn()}))
vi.mock('@/utils/agency/execution-store',()=>({agencyActor:d.actor,readExecution:d.read,operateExecution:d.decide,AgencyError:class extends Error{constructor(message:string,readonly status=503){super(message)}}}))
import {GET,POST} from './route'
import {AgencyError} from '@/utils/agency/execution-store'
const id='11111111-1111-4111-8111-111111111111',body={requestId:id,propertyId:id,operation:'cancel_unused',inputHash:'a'.repeat(64)}

beforeEach(()=>{vi.clearAllMocks();d.actor.mockResolvedValue('actual-actor');d.read.mockResolvedValue({state:'ready',items:[]});d.decide.mockResolvedValue({state:'saved',propertyId:id})})
it('authenticates before native access',async()=>{d.actor.mockRejectedValue(new AgencyError('Unauthorized',401));expect((await GET(new Request('http://local'))).status).toBe(401);expect((await POST(new Request('http://local',{method:'POST',body:'bad'}))).status).toBe(401);expect(d.decide).not.toHaveBeenCalled()})
it('uses server actor and prevents caching',async()=>{const result=await POST(new Request('http://local',{method:'POST',body:JSON.stringify(body)}));expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('private, no-store');expect(d.decide).toHaveBeenCalledWith('actual-actor',body);expect((await POST(new Request('http://local',{method:'POST',body:JSON.stringify({...body,actorId:id})}))).status).toBe(400)})
it('bounds declared and streamed bodies',async()=>{for(const request of[new Request('http://local',{method:'POST',headers:{'content-length':'32769'},body:'{}'}),new Request('http://local',{method:'POST',body:'x'.repeat(32769)})])expect((await POST(request)).status).toBe(413);expect(d.decide).not.toHaveBeenCalled()})
it('does not disclose internal failures',async()=>{d.read.mockRejectedValue(new Error('secret connection detail'));const response=await GET(new Request(`http://local?propertyId=${id}`));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'The agency is unavailable.'})})
it('rejects invalid cursors and preserves scoped denials',async()=>{expect((await GET(new Request(`http://local?propertyId=${id}&kind=history&before=NaN`))).status).toBe(400);d.read.mockRejectedValue(new AgencyError('Forbidden',403));expect((await GET(new Request(`http://local?propertyId=${id}`))).status).toBe(403)})
