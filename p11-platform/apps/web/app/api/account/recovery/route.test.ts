import {beforeEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({actor:vi.fn(),read:vi.fn(),exchange:vi.fn()}))
vi.mock('@/utils/account-sessions/server',()=>({sessionActor:d.actor}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{exchangeCodeForSession:d.exchange}})}))
vi.mock('@/utils/account-credentials/store',async original=>({...await original<object>(),readCredentials:d.read}))
import {GET,POST} from './route'
const req=(body:unknown,origin='http://local')=>new Request('http://local/api/account/recovery',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();d.actor.mockResolvedValue({actor:{actorId:'owner'}});d.read.mockResolvedValue({state:'ready',actorId:'owner',canRecover:true});d.exchange.mockResolvedValue({error:null})})
it('recovery session reads are private and do not exchange a code again',async()=>{const r=await GET();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');expect(d.exchange).not.toHaveBeenCalled()})
it('code exchange reads native authority and returns no code or token',async()=>{const r=await POST(req({code:'synthetic-private-code'}));expect(r.status).toBe(200);expect(d.exchange).toHaveBeenCalledExactlyOnceWith('synthetic-private-code');expect(await r.json()).toEqual({state:'ready',actorId:'owner',canRecover:true})})
it('rejects external origins, actor overrides, empty and oversized codes',async()=>{for(const r of[req({code:'x'},'https://outside.invalid'),req({code:'x',actorId:'other'}),req({code:''}),req({code:'x'.repeat(5000)})])expect((await POST(r)).status).toBeGreaterThanOrEqual(400);expect(d.exchange).not.toHaveBeenCalled()})
it('failed exchange cannot borrow an existing session as evidence of success',async()=>{d.exchange.mockResolvedValue({error:{message:'PRIVATE PROVIDER'}});const r=await POST(req({code:'used-code'}));expect(r.status).toBe(409);expect(d.actor).not.toHaveBeenCalled();expect(JSON.stringify(await r.json())).not.toContain('PRIVATE PROVIDER')})
