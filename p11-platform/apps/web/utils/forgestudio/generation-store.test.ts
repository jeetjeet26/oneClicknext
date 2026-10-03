import {beforeEach,describe,expect,it,vi} from 'vitest'
const rpc=vi.fn(),generate=vi.fn(),assemble=vi.fn(),materialize=vi.fn(),single=vi.fn()
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({rpc,from:()=>{const q={select:()=>q,eq:()=>q,single};return q}})}))
vi.mock('./context-assembler',()=>({assembleForgeStudioContext:assemble}))
vi.mock('./generation',()=>({GENERATION_PROMPT_VERSION:'forgestudio.generation.v2',generateRevisionContent:generate,generationOutputSchema:{parse:(v:unknown)=>v},materializeGeneration:materialize}))
const input={requestId:'request',briefId:'brief',propertyId:'property',actorId:'actor'}
const brief={channels:['facebook'],format_plan:[{platform:'facebook',contentFormat:'text',quantity:1}],objective:'Explain community',topic:null,audience:null,constraints:{},source_facts:[],asset_ids:[]}
const content={contractVersion:'forgestudio.social.v1',conceptSummary:'Saved model result',variants:[{variantKey:'facebook:text:1',sequenceIndex:0,platform:'facebook',caption:'Welcome to this community',hashtags:[],assetIds:[],mediaUrls:[],contentFormat:'text',storyboard:[],overlayText:[],safeArea:{topPercent:10,rightPercent:8,bottomPercent:18,leftPercent:8}}],claims:[]}
const raw={output:{example:'raw-model-output'},metadata:{promptVersion:'forgestudio.generation.v2',contractVersion:'forgestudio.social.v1'}}
let startState='claimed',intentState='proceed_once',lostResult=0,failContext=false
beforeEach(()=>{
 vi.clearAllMocks();startState='claimed';intentState='proceed_once';lostResult=0;failContext=false
 assemble.mockResolvedValue({propertyId:'property',sources:[],assets:[],contextHash:'context'})
 materialize.mockReturnValue({content,metadata:raw.metadata})
 single.mockResolvedValue({data:{state:'result_ready',raw_result:raw,raw_result_hash:'database-hash',model_input:{bundle:{},promptVersion:'forgestudio.generation.v2'}},error:null})
 generate.mockImplementation(async args=>{await args.onResult(raw);return{content,metadata:raw.metadata}})
 rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='begin_forgestudio_generation')return{data:{state:startState,claimToken:'token',brief},error:null}
  if(name==='advance_forgestudio_generation'){
   if(args.p_action==='context'&&failContext)return{data:null,error:{message:'failed context receipt'}}
   if(args.p_action==='model_intent')return{data:{state:intentState},error:null}
   if(args.p_action==='raw_result'&&lostResult-->0)return{data:null,error:{message:'lost raw result reply'}}
   return{data:{state:'saved'},error:null}
  }
  return{data:{state:'saved',packageId:'package',revisionId:'revision'},error:null}
 })
})
describe('durable generation orchestration',()=>{
 it.each(['preparing','ready','generating','result_ready','completed','stopped','busy'])('existing %s state never repeats context retrieval or generation',async state=>{startState=state;expect((await (await import('./generation-store')).runBriefGeneration(input)).state).toBe(state);expect(generate).not.toHaveBeenCalled();expect(assemble).not.toHaveBeenCalled()})
 it('requires saved context before the one model invocation',async()=>{const result=await (await import('./generation-store')).runBriefGeneration(input);expect(result.packageId).toBe('package');expect(generate).toHaveBeenCalledOnce();const actions=rpc.mock.calls.filter(c=>c[0]==='advance_forgestudio_generation').map(c=>c[1].p_action);expect(actions).toEqual(['context','model_intent','raw_result']);expect(rpc).toHaveBeenCalledWith('finish_forgestudio_generation',expect.objectContaining({p_payload:expect.objectContaining({resultHash:'database-hash'})}))})
 it('does not call the model if context persistence cannot be confirmed',async()=>{failContext=true;await expect((await import('./generation-store')).runBriefGeneration(input)).rejects.toThrow(/could not be confirmed/);expect(generate).not.toHaveBeenCalled()})
 it('does not call the model on a replayed intent',async()=>{intentState='model_already_started';await expect((await import('./generation-store')).runBriefGeneration(input)).rejects.toThrow(/needs review/);expect(generate).not.toHaveBeenCalled()})
 it('repeats only the identical result receipt after its acknowledgement is lost',async()=>{lostResult=1;await (await import('./generation-store')).runBriefGeneration(input);expect(generate).toHaveBeenCalledOnce();const saves=rpc.mock.calls.filter(c=>c[1].p_action==='raw_result');expect(saves).toHaveLength(2);expect(saves[0]).toEqual(saves[1])})
 it('recovery uses the saved input and raw output without model or source calls',async()=>{await (await import('./generation-store')).recoverGeneration('request','property','reviewer','recovery-request');expect(generate).not.toHaveBeenCalled();expect(assemble).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledWith('recover_forgestudio_generation',expect.objectContaining({p_id:'recovery-request',p_actor_id:'reviewer',p_payload:expect.objectContaining({generationId:'request',resultHash:'database-hash'})}))})
 it('an uncertain model exception saves a hold without replacing the result',async()=>{generate.mockRejectedValue(new Error('provider timeout'));await expect((await import('./generation-store')).runBriefGeneration(input)).rejects.toThrow('provider timeout');expect(generate).toHaveBeenCalledOnce();expect(rpc).toHaveBeenCalledWith('advance_forgestudio_generation',expect.objectContaining({p_action:'failure',p_payload:{code:'model_uncertain'}}))})
})

it('recovers original v1 output after the settings prompt upgrade without reusing current settings',async()=>{
 const oldRaw={...raw,metadata:{...raw.metadata,promptVersion:'forgestudio.generation.v1'}};single.mockResolvedValue({data:{state:'result_ready',raw_result:oldRaw,raw_result_hash:'old-hash',model_input:{bundle:{},promptVersion:'forgestudio.generation.v1'}},error:null});await(await import('./generation-store')).recoverGeneration('request','property','actor','decision');expect(generate).not.toHaveBeenCalled();expect(materialize).toHaveBeenCalledWith({bundle:{},promptVersion:'forgestudio.generation.v1'},oldRaw.output,oldRaw.metadata)
})
it('holds saved results whose prompt does not match the recorded request',async()=>{
 single.mockResolvedValue({data:{state:'result_ready',raw_result:raw,model_input:{bundle:{},promptVersion:'forgestudio.generation.v1'}},error:null});await expect((await import('./generation-store')).recoverGeneration('request','property','actor','decision')).rejects.toThrow(/inconsistent/);expect(materialize).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled()
})
