import { beforeEach,describe,it,expect,vi } from 'vitest'
import {zipSync,strToU8} from 'fflate'
import type { PackageJob } from './store'
const mocks=vi.hoisted(()=>({job:{} as PackageJob,create:vi.fn(),retrieve:vi.fn(),uploadFile:vi.fn(),download:vi.fn(),upload:vi.fn(),assemble:vi.fn(),content:vi.fn()}))
vi.mock('openai',()=>({default:class {files={create:mocks.uploadFile,delete:vi.fn()};responses={create:mocks.create,retrieve:mocks.retrieve};containers={files:{content:{retrieve:mocks.content}}}},toFile:vi.fn(async b=>b)}))
vi.mock('./source',()=>({assembleSourceArchive:mocks.assemble,sha256:()=> 'hash'}))
vi.mock('./store',()=>({
  getPackageJob:vi.fn(async()=>({...mocks.job})),
  updatePackage:vi.fn(async(_id,from,patch)=>{if(mocks.job.state!==from)throw new Error('Concurrent change');mocks.job={...mocks.job,...patch};return {...mocks.job}}),
  packageDb:()=>({storage:{from:()=>({upload:mocks.upload,download:mocks.download})},from:()=>{
    let patch:Partial<PackageJob>={}
    const query={update:(v:Partial<PackageJob>)=>{patch=v;return query},eq:()=>query,in:()=>query,or:()=>query,select:()=>query,maybeSingle:async()=>{mocks.job={...mocks.job,...patch};return {data:{...mocks.job},error:null}}}
    return query
  }}),
}))
import { processPackage,generationInstructions } from './runner'
describe('Astra execution recovery',()=>{
  beforeEach(()=>{
    vi.clearAllMocks()
    mocks.job={id:'build',org_id:'org',property_id:'property',actor_id:'actor',parent_id:null,target:'standalone',state:'queued',instructions:'Use the saved property',source_hash:'source',source_snapshot:{},created_at:new Date().toISOString(),updated_at:new Date().toISOString()} as PackageJob
    mocks.assemble.mockResolvedValue(new Uint8Array([1,2]));mocks.upload.mockResolvedValue({error:null});mocks.uploadFile.mockResolvedValue({id:'file-input'})
  })
  it('uses Astra with an offline container and retains the provider response ID',async()=>{
    mocks.create.mockResolvedValue({id:'response-1'})
    await processPackage('build')
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({model:'gpt-6-astra',background:true,reasoning:{effort:'xhigh'},tools:[{type:'shell',environment:{type:'container_auto',file_ids:['file-input'],network_policy:{type:'disabled'}}}]}),expect.anything())
    expect(mocks.job).toMatchObject({state:'generating',response_id:'response-1'})
  })
  it('does not retry a paid request when its result was lost',async()=>{
    mocks.create.mockRejectedValue(new Error('Connection reset after submission'))
    await processPackage('build');await processPackage('build')
    expect(mocks.job.state).toBe('uncertain')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it('fails before invoking Astra if approved media cannot be packaged',async()=>{
    mocks.assemble.mockRejectedValue(new Error('Image unavailable'))
    await processPackage('build')
    expect(mocks.job.state).toBe('failed');expect(mocks.create).not.toHaveBeenCalled()
  })
  it('keeps temporary polling failures recoverable without a second generation',async()=>{
    mocks.job.state='generating';mocks.job.response_id='response-1'
    mocks.retrieve.mockRejectedValue(new Error('Temporary provider outage'))
    await expect(processPackage('build')).rejects.toThrow('Temporary')
    expect(mocks.job.state).toBe('generating');expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not accept a claimed completion without the finished artifact',async()=>{
    mocks.job.state='generating';mocks.job.response_id='response-1'
    mocks.retrieve.mockResolvedValue({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Done!',annotations:[]}]}]})
    await processPackage('build')
    expect(mocks.job).toMatchObject({state:'failed',error_message:expect.stringContaining('without a downloadable website')})
  })
  it('instructs revisions to preserve the prior website and does not claim runtime approval',()=>{
    mocks.job.parent_id='prior-build'
    const prompt=generationInstructions(mocks.job)
    expect(prompt).toContain('previous-website/');expect(prompt).toContain('preserve its design')
    expect(prompt).toContain('Do not claim the website is approved, live or independently verified')
  })
  it('saves and dispatches one critique-driven repair for an incomplete candidate',async()=>{
    mocks.job.state='generating';mocks.job.response_id='original';
    mocks.retrieve.mockResolvedValue({status:'completed',output:[{type:'message',content:[{type:'output_text',annotations:[{type:'container_file_citation',filename:'siteforge-package.zip',file_id:'output',container_id:'container'}]}]}]});
    mocks.job.target='wordpress';mocks.job.input_path='input';
    mocks.content.mockResolvedValue(new Response(zipSync({'incomplete.txt':strToU8('Not a website')})));
    mocks.download.mockResolvedValue({data:new Blob([zipSync({'property.json':strToU8('{"floorplans":[]}')})]),error:null});
    mocks.create.mockResolvedValue({id:'repair-response'});
    await processPackage('build');
    expect(mocks.job).toMatchObject({state:'packaging',usage:{siteforgeReview:{attempt:1,status:'repairing',responseId:'repair-response'}}});
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({previous_response_id:'original',reasoning:{effort:'xhigh'}}),expect.anything());
    mocks.content.mockResolvedValue(new Response(zipSync({'incomplete.txt':strToU8('Still incomplete')})));
    await processPackage('build');expect(mocks.job.state).toBe('failed');expect(mocks.create).toHaveBeenCalledTimes(1);
  })
  it('does not repeat a repair with an unconfirmed submission',async()=>{
    mocks.job.state='packaging';mocks.job.response_id='original';mocks.job.usage={siteforgeReview:{attempt:1,status:'starting'}};
    await processPackage('build');expect(mocks.job.state).toBe('failed');expect(mocks.create).not.toHaveBeenCalled();
  })

})
