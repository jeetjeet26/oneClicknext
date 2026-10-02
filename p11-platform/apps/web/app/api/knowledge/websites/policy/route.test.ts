import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({actor:vi.fn(),read:vi.fn(),decide:vi.fn()}))
vi.mock('@/utils/knowledge/web-store',()=>({webActor:d.actor,WebError:class extends Error{constructor(message:string,readonly status=503){super(message)}}}))
vi.mock('@/utils/knowledge/web-policy-store',()=>({readWebPolicy:d.read,decideWebPolicy:d.decide}))
import {GET,POST} from './route'
import {WebError} from '@/utils/knowledge/web-store'
const id='11111111-1111-1111-1111-111111111111',body={requestId:id,propertyId:id,operation:'save',expectedRevision:0,enabled:true,intervalHours:72,dailyLimit:1,confirmed:true,reason:'Review published-source scope'}
beforeEach(()=>{vi.clearAllMocks();d.actor.mockResolvedValue('actor');d.read.mockResolvedValue({state:'ready',policy:null});d.decide.mockResolvedValue({state:'saved',propertyId:id})})
it('authenticates before parsing or reading',async()=>{d.actor.mockRejectedValue(new WebError('Unauthorized',401));expect((await GET(new Request('http://local'))).status).toBe(401);expect((await POST(new Request('http://local',{method:'POST',body:'bad'}))).status).toBe(401);expect(d.decide).not.toHaveBeenCalled()})
it('saves only strict current actor policy decisions',async()=>{const result=await POST(new Request('http://local',{method:'POST',body:JSON.stringify(body)}));expect(result.status).toBe(200);expect(result.headers.get('Cache-Control')).toBe('private, no-store');expect(d.decide).toHaveBeenCalledWith('actor',body);expect((await POST(new Request('http://local',{method:'POST',body:JSON.stringify({...body,urls:['https://example.test']})}))).status).toBe(400)})
it('enforces actual streamed and declared limits',async()=>{expect((await POST(new Request('http://local',{method:'POST',headers:{'content-length':'16385'},body:'{}'}))).status).toBe(413);expect((await POST(new Request('http://local',{method:'POST',body:'x'.repeat(16385)}))).status).toBe(413);expect(d.decide).not.toHaveBeenCalled()})
it('reads private failures without exposing internals',async()=>{expect((await GET(new Request(`http://local?propertyId=${id}&kind=decision`))).status).toBe(400);d.read.mockRejectedValue(new Error('secret database detail'));const result=await GET(new Request(`http://local?propertyId=${id}`));expect(result.status).toBe(503);expect(await result.json()).toEqual({error:'Website monitoring is unavailable.'})})
