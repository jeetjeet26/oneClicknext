import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),scope:vi.fn(),current:vi.fn()}))
vi.mock('./server',()=>({brainRpc:mocks.rpc,resolveCommunityScope:mocks.scope}))
vi.mock('./generation',()=>({requireGenerationCurrent:mocks.current}))
import {cleanupProviderObjects,packageProviderTask,providerProject,readProviderObject,recordProviderObject} from './providers'
import type OpenAI from 'openai'
import type {CommunityScope} from './contracts'

beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('OPENAI_PROJECT_ID','');vi.stubEnv('OPENAI_API_KEY','test-credential-one')})
afterEach(()=>vi.unstubAllEnvs())
describe('API-key-only provider ownership',()=>{
 it('starts package preparation with only an API key and still validates current sources and scope',async()=>{
  mocks.scope.mockResolvedValue({id:'scope'})
  await expect(packageProviderTask({id:'job',actor_id:'actor',property_id:'property',brain_context_id:'context'})).resolves.toEqual({scope:{id:'scope'},contextId:'context'})
  expect(mocks.current).toHaveBeenCalledWith('site_package','job')
  expect(mocks.scope).toHaveBeenCalledWith('actor','property','site')
 })
 it('uses a stable opaque namespace and separates different credentials',()=>{
  const first=providerProject()
  expect(first).toMatch(/^api-key-sha256:[a-f0-9]{64}$/)
  expect(first).not.toContain('test-credential')
  expect(providerProject()).toBe(first)
  vi.stubEnv('OPENAI_API_KEY','test-credential-two')
  expect(providerProject()).not.toBe(first)
 })
 it('preserves explicit project identities for previously retained objects',()=>{
  vi.stubEnv('OPENAI_PROJECT_ID','proj_existing')
  expect(providerProject()).toBe('proj_existing')
 })
 it('still rejects missing credentials',()=>{
  vi.stubEnv('OPENAI_API_KEY','')
  expect(()=>providerProject()).toThrow('Configure the OpenAI API key')
 })
 it('uses the same namespace and context for recording and looking up objects',async()=>{
  const task={scope:{id:'scope'} as CommunityScope,contextId:'context'}
  await recordProviderObject(task,'response','response-1',['parent'])
  await readProviderObject(task,'response','response-1')
  expect(mocks.rpc).toHaveBeenCalledWith('brain_provider_record',expect.objectContaining({p_scope_id:'scope',p_input:expect.objectContaining({project:providerProject(),contextId:'context',parents:['parent']})}))
  expect(mocks.rpc).toHaveBeenCalledWith('brain_provider_lookup',{p_scope_id:'scope',p_project:providerProject(),p_kind:'response',p_object_id:'response-1',p_context_id:'context',p_session_id:null})
 })
 it('cleans up matching objects without touching another credential namespace',async()=>{
  mocks.rpc.mockResolvedValueOnce([
   {id:'owned',project_ref:providerProject(),object_kind:'input_file',object_id:'file-owned'},
   {id:'other',project_ref:'different-credential',object_kind:'input_file',object_id:'file-other'},
  ])
  const remove=vi.fn().mockResolvedValue({deleted:true})
  await cleanupProviderObjects({files:{delete:remove}} as unknown as OpenAI)
  expect(remove).toHaveBeenCalledExactlyOnceWith('file-owned')
  expect(mocks.rpc).toHaveBeenCalledWith('brain_provider_cleanup',{p_id:'owned',p_confirmed:true})
 })
})
