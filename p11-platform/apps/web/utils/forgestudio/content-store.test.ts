import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Table-driven Supabase mock.
 *
 * Each table has a FIFO queue of responses. A response is consumed whenever a
 * query chain terminates (.single(), .maybeSingle(), or awaiting the builder).
 * The last response for a table is sticky so repeated fire-and-forget updates
 * do not exhaust the queue. All method calls are recorded in `callLog`.
 */
type QueryResponse = { data: unknown; error: unknown }

const tableResponses: Record<string, QueryResponse[]> = {}
const callLog: Array<{ table: string; method: string; args: unknown[] }> = []

function nextResponse(table: string): QueryResponse {
  const queue = tableResponses[table] ?? []
  if (queue.length === 0) return { data: null, error: null }
  return queue.length > 1 ? queue.shift()! : queue[0]
}

function createBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit']) {
    builder[method] = vi.fn((...args: unknown[]) => {
      callLog.push({ table, method, args })
      return builder
    })
  }
  builder.single = vi.fn(async () => nextResponse(table))
  builder.maybeSingle = vi.fn(async () => nextResponse(table))
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(nextResponse(table)).then(resolve, reject)
  return builder
}

const rpcMock=vi.fn()
const fromMock = vi.fn((table: string) => createBuilder(table))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

function setResponses(table: string, responses: QueryResponse[]) {
  tableResponses[table] = responses
}

const REVISION_ID = '11111111-1111-4111-8111-111111111111'
const PACKAGE_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333'

const validContent = {
  conceptSummary: 'Pool season kickoff',
  variants: [
    {
      platform: 'facebook',
      caption: 'Pool season is here at The Landing.',
    },
  ],
  claims: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  rpcMock.mockReset()
  for (const key of Object.keys(tableResponses)) delete tableResponses[key]
  callLog.length = 0
})

describe('atomic editorial service',()=>{
 it('binds validation, actor and exact loaded revision to one private transaction',async()=>{
  setResponses('social_content_packages',[{data:{property_id:'property-1'},error:null}]);rpcMock.mockResolvedValue({data:{state:'saved',revision:{id:'new-revision'}},error:null})
  const {addRevision}=await import('./content-store')
  expect(await addRevision(PACKAGE_ID,{requestId:CONNECTION_ID,expectedRevisionId:REVISION_ID,modificationReason:'Improve copy',content:validContent as never,author:{kind:'user',userId:'operator'}})).toEqual({id:'new-revision'})
  expect(rpcMock).toHaveBeenCalledWith('save_forgestudio_revision',expect.objectContaining({p_id:CONNECTION_ID,p_actor_id:'operator',p_property_id:'property-1',p_payload:expect.objectContaining({expectedRevisionId:REVISION_ID,reason:'Improve copy',validation:[[]]})}))
  expect(callLog.filter(x=>['insert','update','delete'].includes(x.method))).toHaveLength(0)
 })
 it('never supersedes content before the transaction and surfaces an uncertain save',async()=>{
  setResponses('social_content_packages',[{data:{property_id:'property-1'},error:null}]);rpcMock.mockResolvedValue({data:null,error:{message:'connection lost'}})
  const {addRevision}=await import('./content-store');await expect(addRevision(PACKAGE_ID,{requestId:CONNECTION_ID,expectedRevisionId:REVISION_ID,modificationReason:'Improve copy',content:validContent as never,author:{kind:'user',userId:'operator'}})).rejects.toThrow(/could not be confirmed/)
  expect(callLog.filter(x=>['insert','update','delete'].includes(x.method))).toHaveLength(0)
 })
 it('recovers an approval reply using the same immutable review identity',async()=>{
  setResponses('social_content_revisions',[{data:{property_id:'property-1',content:validContent,content_hash:'a'.repeat(64)},error:null}]);rpcMock.mockResolvedValue({data:{state:'replayed',revision:{id:REVISION_ID,approval_status:'approved'}},error:null})
  const {setRevisionApproval}=await import('./content-store');expect((await setRevisionApproval({requestId:CONNECTION_ID,revisionId:REVISION_ID,contentHash:'a'.repeat(64),decision:'approved',reviewerId:'operator',note:'Exact review'})).approval_status).toBe('approved')
  expect(rpcMock).toHaveBeenCalledWith('review_forgestudio_revision',expect.objectContaining({p_payload:{revisionId:REVISION_ID,contentHash:'a'.repeat(64),decision:'approved',note:'Exact review'}}))
 })
 it.each(['stale_revision','publication_in_progress','forbidden','request_conflict'])('keeps %s holds without compensation writes',async state=>{
  setResponses('social_content_packages',[{data:{property_id:'property-1'},error:null}]);rpcMock.mockResolvedValue({data:{state},error:null});const {addRevision}=await import('./content-store');await expect(addRevision(PACKAGE_ID,{expectedRevisionId:REVISION_ID,modificationReason:'Improve copy',content:validContent as never,author:{kind:'user',userId:'operator'}})).rejects.toThrow();expect(callLog.filter(x=>x.method==='update')).toHaveLength(0)
 })
 it('rejects unsupported claims and invalid channel content before recording approval',async()=>{
  const bad={...validContent,claims:[{type:'pricing',text:'Special price',citations:[]}]};setResponses('social_content_revisions',[{data:{property_id:'property-1',content:bad},error:null}]);const {setRevisionApproval}=await import('./content-store');await expect(setRevisionApproval({revisionId:REVISION_ID,contentHash:'a'.repeat(64),decision:'approved',reviewerId:'operator',note:'Exact review'})).rejects.toThrow(/unsupported claims/);expect(rpcMock).not.toHaveBeenCalled()
 })
})

describe('atomic publication controls',()=>{
 const input={requestId:PACKAGE_ID,revisionId:REVISION_ID,contentHash:'a'.repeat(64),createdBy:'operator',destinations:[{connectionId:CONNECTION_ID,variantId:REVISION_ID,scheduledFor:'2027-01-01T12:00:00Z',timezone:'America/Los_Angeles'}]}
 it.each(['saved','replayed'])('returns the complete %s schedule without direct row writes',async state=>{
  setResponses('social_content_revisions',[{data:{property_id:'property'},error:null}]);rpcMock.mockResolvedValue({data:{state,publications:[{id:'one'},{id:'two'}]},error:null})
  const {schedulePublications}=await import('./content-store');expect(await schedulePublications(input)).toEqual([{id:'one'},{id:'two'}]);expect(rpcMock).toHaveBeenCalledWith('schedule_forgestudio_publications',{p_id:PACKAGE_ID,p_property_id:'property',p_actor_id:'operator',p_payload:{revisionId:REVISION_ID,contentHash:input.contentHash,destinations:input.destinations}});expect(callLog.filter(x=>['insert','update','delete'].includes(x.method))).toHaveLength(0)
 })
 it.each(['stale_revision','connection_unavailable','variant_unavailable','already_scheduled','schedule_time_required','timezone_required','approval_access_changed'])('surfaces %s without partial writes',async state=>{
  setResponses('social_content_revisions',[{data:{property_id:'property'},error:null}]);rpcMock.mockResolvedValue({data:{state},error:null});const {schedulePublications}=await import('./content-store');await expect(schedulePublications(input)).rejects.toThrow();expect(callLog.filter(x=>['insert','update','delete'].includes(x.method))).toHaveLength(0)
 })
 it('binds cancellation to the version opened and recovers a lost reply',async()=>{
  setResponses('social_publications',[{data:{property_id:'property'},error:null}]);rpcMock.mockResolvedValue({data:{state:'replayed',publication:{id:'pub',status:'cancelled'}},error:null});const {cancelPublication}=await import('./content-store');expect(await cancelPublication('pub',{requestId:PACKAGE_ID,actorId:'operator',expectedUpdatedAt:'2026-09-17T00:00:00Z'})).toMatchObject({status:'cancelled'});expect(rpcMock).toHaveBeenCalledWith('control_forgestudio_publication',expect.objectContaining({p_payload:{action:'cancel',publicationId:'pub',expectedUpdatedAt:'2026-09-17T00:00:00Z'}}))
 })
 it('never turns a blanket retry into another provider attempt',async()=>{
  const {retryPublication}=await import('./content-store');await expect(retryPublication('pub')).rejects.toThrow(/uncertain post cannot be resent/);expect(rpcMock).not.toHaveBeenCalled();expect(fromMock).not.toHaveBeenCalled()
 })
})
