import{beforeEach,it,expect,vi}from'vitest'
const d=vi.hoisted(()=>({actor:vi.fn(),read:vi.fn(),decide:vi.fn(),cookie:vi.fn()}))
vi.mock('next/headers',()=>({cookies:async()=>({get:d.cookie})}))
vi.mock('@/utils/team/store',async()=>{const{InventoryError}=await import('@/utils/knowledge/inventory');return{TeamError:InventoryError,teamActor:d.actor,readTeamJoin:d.read,decideTeamJoin:d.decide}})
import{GET,POST}from'./route'
const id='11111111-1111-1111-1111-111111111111',body={requestId:id,operation:'accept',invitationHash:'b'.repeat(64),confirmed:true,reason:'Reviewed exact grant'},req=(b:unknown=body)=>new Request('https://local/api/team/join',{method:'POST',headers:{origin:'https://local'},body:JSON.stringify(b)})
beforeEach(()=>{vi.clearAllMocks();d.actor.mockResolvedValue('recipient');d.cookie.mockReturnValue({value:'a'.repeat(64)});d.read.mockResolvedValue({state:'ready'});d.decide.mockResolvedValue({state:'saved',decisionId:id})})
it('reads token privately and clears it only on a completed grant decision',async()=>{const r=await POST(req());expect(d.decide).toHaveBeenCalledWith('recipient','a'.repeat(64),body);expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('Secure')})
it('unused cancellation preserves the valid invitation cookie',async()=>{d.decide.mockResolvedValue({state:'saved',cancelled:true,decisionId:id});const r=await POST(req({requestId:id,operation:'cancel_unused',inputHash:'c'.repeat(64)}));expect(r.headers.get('set-cookie')).toBeNull()})
it('recovers exact own decision after the invitation cookie has cleared',async()=>{d.cookie.mockReturnValue(undefined);expect((await GET(new Request('http://local/api/team/join?decisionId='+id))).status).toBe(200);expect(d.read).toHaveBeenCalledWith('recipient',null,id)})
