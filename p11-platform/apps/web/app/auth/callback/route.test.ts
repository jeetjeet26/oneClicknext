import{beforeEach,it,expect,vi}from'vitest'
const d=vi.hoisted(()=>({exchange:vi.fn(),user:vi.fn(),identity:vi.fn(),profile:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({rpc:d.identity,auth:{exchangeCodeForSession:d.exchange,getUser:d.user},from:()=>({select:()=>({eq:()=>({single:d.profile})})})})}))
import{GET}from'./route'
beforeEach(()=>{vi.clearAllMocks();d.identity.mockResolvedValue({data:{kind:'internal'},error:null});d.exchange.mockResolvedValue({error:null});d.user.mockResolvedValue({data:{user:{id:'recipient'}}});d.profile.mockResolvedValue({data:{org_id:null},error:null})})
it('verified new accounts return to invitation review',async()=>{expect((await GET(new Request('http://local/auth/callback?code=fixture&next=%2Fjoin%2Fteam'))).headers.get('location')).toBe('http://local/join/team')})
it('missing user and failed profile reads never infer new-account setup',async()=>{d.profile.mockResolvedValue({data:null,error:{message:'private'}});expect((await GET(new Request('http://local/auth/callback?code=fixture'))).headers.get('location')).toContain('account_unavailable');d.user.mockResolvedValue({data:{user:null}});expect((await GET(new Request('http://local/auth/callback?code=fixture'))).headers.get('location')).toContain('account_unavailable')})

it('returns verified clients to the client reporting view',async()=>{d.identity.mockResolvedValue({data:{kind:'client'},error:null});expect((await GET(new Request('http://local/auth/callback?code=fixture&next=%2Fdashboard'))).headers.get('location')).toBe('http://local/client')})
