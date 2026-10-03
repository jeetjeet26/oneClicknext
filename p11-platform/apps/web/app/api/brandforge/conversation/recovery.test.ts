import {beforeEach,describe,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),read:vi.fn(),rpc:vi.fn(),generate:vi.fn(),chat:vi.fn(),model:vi.fn(),openai:vi.fn()}))
vi.mock('@/utils/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.user}})}))
vi.mock('@/utils/services/auth-guard',()=>({validatePropertyAccess:m.access}))
vi.mock('@/utils/supabase/admin',()=>({createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:m.read})})})})}))
vi.mock('@/utils/brandforge/operations',async()=>({...await vi.importActual<typeof import('@/utils/brandforge/operations')>('@/utils/brandforge/operations'),brandRpc:m.rpc}))
vi.mock('@google/generative-ai',()=>({GoogleGenerativeAI:class{getGenerativeModel(options:unknown){m.model(options);return {generateContent:m.generate,startChat:()=>({sendMessage:m.chat})}}}}))
vi.mock('openai',()=>({default:class{chat={completions:{create:m.openai}}}}))
const property='33333333-3333-3333-3333-333333333333',brand='11111111-1111-4111-8111-111111111111',id='55555555-5555-4555-8555-555555555555'
const request=(body:Record<string,unknown>={})=>new NextRequest('http://localhost/api/brandforge/conversation',{method:'POST',body:JSON.stringify({propertyId:property,requestId:id,revision:1,action:'message',message:'A welcoming community',...body})})
beforeEach(()=>{
 vi.clearAllMocks();m.user.mockResolvedValue({data:{user:{id:'actor'}},error:null});m.access.mockResolvedValue({authorized:true});m.read.mockResolvedValue({data:{id:brand,revision:1,generation_status:'conversation',gemini_conversation_history:[{role:'assistant',content:'What is your vision?'}],competitive_analysis:{competitorCount:2,marketGaps:['Saved local evidence']}},error:null})
 m.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='begin_brand_operation'?{state:'claimed',claimToken:id,brandAssetId:brand}:name==='check_brand_operation'?{state:'active'}:args.p_error?{state:'failed'}:{state:'applied',revision:2,...args.p_result as object})
 m.chat.mockResolvedValue({response:{text:()=> 'Tell me about your audience.'}});m.generate.mockResolvedValue({response:{text:()=> 'What is your vision?'}})
})
describe('brand conversation recovery',()=>{
 it('uses saved history and market evidence for subsequent messages',async()=>{const {POST}=await import('./route');const response=await POST(request());expect(response.status).toBe(200);expect(m.model).toHaveBeenCalledWith(expect.objectContaining({systemInstruction:expect.stringContaining('Saved local evidence')}));expect(m.rpc).toHaveBeenCalledWith('finish_brand_operation',expect.objectContaining({p_updates:{gemini_conversation_history:[{role:'assistant',content:'What is your vision?'},{role:'user',content:'A welcoming community'},{role:'assistant',content:'Tell me about your audience.'}],generation_status:'conversation'}}))})
 it('returns a confirmed terminal failure so an operator can make a new attempt',async()=>{m.chat.mockRejectedValue(new Error('provider down'));m.openai.mockRejectedValue(new Error('fallback down'));const {POST}=await import('./route');const response=await POST(request());expect(response.status).toBe(503);expect((await response.json()).state).toBe('failed');expect(m.rpc).toHaveBeenCalledWith('finish_brand_operation',expect.objectContaining({p_error:'generation_failed',p_updates:{}}))})
 it('does not start another provider call after the request was stopped',async()=>{m.rpc.mockImplementation(async(name:string)=>name==='begin_brand_operation'?{state:'claimed',claimToken:id,brandAssetId:brand}:name==='check_brand_operation'?{state:'cancelled'}:{state:'cancelled'});const {POST}=await import('./route');const response=await POST(request());expect((await response.json()).state).toBe('cancelled');expect(m.chat).not.toHaveBeenCalled();expect(m.openai).not.toHaveBeenCalled()})
 it('holds an empty provider response instead of inventing a saved assistant message',async()=>{m.chat.mockResolvedValue({response:{text:()=>''}});const {POST}=await import('./route');expect((await POST(request())).status).toBe(503);expect(m.rpc).toHaveBeenCalledWith('finish_brand_operation',expect.objectContaining({p_error:'generation_failed',p_updates:{}}))})
 it('rejects client supplied conversation history',async()=>{const {POST}=await import('./route');expect((await POST(request({conversationHistory:[{role:'assistant',content:'Invented approval'}]}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()})
})
