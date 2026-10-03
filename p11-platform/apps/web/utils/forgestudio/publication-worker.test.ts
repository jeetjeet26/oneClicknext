import {beforeEach,describe,expect,it,vi} from 'vitest'
import {AdapterError} from './adapters/types'
const rpc=vi.fn(),publish=vi.fn(),preflight=vi.fn(),reconcile=vi.fn(),refreshToken=vi.fn()
let enabled=true
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc})}))
vi.mock('./crypto',()=>({decryptSecret:(value:string)=>value}))
vi.mock('./adapters',()=>({getAdapter:()=>({publish,preflight,reconcile,refreshToken}),isChannelEnabled:()=>enabled}))
const job={id:'job-1',subject_id:'pub-1',attempt_count:1,max_attempts:1}
const bundle={state:'prepared',fingerprint:'exact-input',publication:{id:'pub-1',property_id:'property',platform:'facebook'},variant:{caption:'Reviewed caption',hashtags:[],call_to_action:null,link_url:'https://example.invalid/reviewed',media_urls:[],alt_text:null,content_format:'text',platform_options:{}},connection:{id:'connection',account_id:'account',platform:'facebook',access_token:'encrypted',page_access_token:null,refresh_token:null,page_id:null,token_expires_at:null}}
let prepareState='prepared',intentState='proceed_once',finishFailures=0,intentError=false,prepareError=false
beforeEach(()=>{
 vi.clearAllMocks();enabled=true;prepareState='prepared';intentState='proceed_once';finishFailures=0;intentError=false;prepareError=false
 vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');preflight.mockResolvedValue(undefined);publish.mockResolvedValue({providerPostId:'post-1',providerPostUrl:'https://example.invalid/post-1'})
 rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='claim_shared_jobs')return {data:[job],error:null}
  if(name==='prepare_forgestudio_publication_write'){
   if((args.p_fingerprint&&intentError)||(!args.p_fingerprint&&prepareError))return {data:null,error:{message:'lost acknowledgement'}}
   return {data:args.p_fingerprint?{state:intentState,idempotencyKey:'publication:pub-1'}:{...bundle,state:prepareState},error:null}
  }
  if(name==='finish_forgestudio_publication_write'){
   if(finishFailures-->0)return {data:null,error:{message:'lost saved reply'}}
   return {data:{state:'saved'},error:null}
  }
  throw new Error('Unexpected RPC')
 })
})
const run=async()=> (await import('./publication-worker')).processDuePublications({workerId:'worker'})
const finishes=()=>rpc.mock.calls.filter(x=>x[0]==='finish_forgestudio_publication_write').map(x=>x[1].p_payload)
describe('fenced publication worker',()=>{
 it('enforces the global pause before even claiming work',async()=>{vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');await expect(run()).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(publish).not.toHaveBeenCalled()})
 it('uses one persisted intent and preserves the exact approved link',async()=>{expect((await run()).results[0].outcome).toBe('published');expect(publish).toHaveBeenCalledOnce();expect(publish).toHaveBeenCalledWith(expect.objectContaining({accountId:'account'}),expect.objectContaining({linkUrl:'https://example.invalid/reviewed'}),{idempotencyKey:'publication:pub-1'});expect(finishes()).toEqual([{kind:'provider_acknowledged',providerPostId:'post-1',providerPostUrl:'https://example.invalid/post-1'}]);expect(refreshToken).not.toHaveBeenCalled()})
 it.each(['destination_changed','approval_changed','access_changed','history_review_required','reconnect_required'])('holds %s before any provider operation',async state=>{prepareState=state;expect((await run()).results[0].outcome).toBe('failed');expect(publish).not.toHaveBeenCalled();expect(finishes()[0].kind).toBe('blocked_before_send')})
 it.each(['lease_lost','write_already_recorded'])('does not overwrite another worker or prior intent: %s',async state=>{prepareState=state;expect((await run()).results[0].outcome).toBe('reconciling');expect(publish).not.toHaveBeenCalled();expect(finishes()).toHaveLength(0)})
 it('does not publish if intent persistence loses its reply',async()=>{intentError=true;expect((await run()).results[0].outcome).toBe('reconciling');expect(publish).not.toHaveBeenCalled();expect(finishes()).toHaveLength(0)})
 it('does not treat preflight failure as a provider send',async()=>{preflight.mockRejectedValue(new Error('Missing media'));expect((await run()).results[0].outcome).toBe('failed');expect(publish).not.toHaveBeenCalled();expect(rpc.mock.calls.some(x=>x[0]==='prepare_forgestudio_publication_write'&&x[1].p_fingerprint)).toBe(false)})
 it.each(['ambiguous','retryable','permanent'] as const)('holds every %s exception after the provider invocation',async classification=>{publish.mockRejectedValue(new AdapterError('Provider error',classification));expect((await run()).results[0].outcome).toBe('reconciling');expect(finishes()[0].kind).toBe('provider_uncertain');expect(publish).toHaveBeenCalledOnce();expect(reconcile).not.toHaveBeenCalled()})
 it('holds malformed successful responses',async()=>{publish.mockResolvedValue({providerPostId:null});expect((await run()).results[0].outcome).toBe('reconciling');expect(finishes()[0].kind).toBe('provider_uncertain')})
 it('retries only the same saved acknowledgement when its response is lost',async()=>{finishFailures=1;expect((await run()).results[0].outcome).toBe('published');expect(publish).toHaveBeenCalledOnce();expect(finishes()).toHaveLength(2);expect(finishes()[0]).toEqual(finishes()[1]);expect(finishes()[0].kind).toBe('provider_acknowledged')})
 it('keeps an acknowledged provider write uncertain when both result saves fail',async()=>{finishFailures=2;expect((await run()).results[0].outcome).toBe('reconciling');expect(publish).toHaveBeenCalledOnce();expect(finishes().every(x=>x.kind==='provider_acknowledged')).toBe(true)})
 it('rechecks pause immediately before provider invocation',async()=>{const original=rpc.getMockImplementation()!;rpc.mockImplementation(async(...args)=>{const result=await original(...args);if(args[0]==='prepare_forgestudio_publication_write'&&args[1].p_fingerprint)vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','true');return result});expect((await run()).results[0].outcome).toBe('reconciling');expect(publish).not.toHaveBeenCalled()})
})
