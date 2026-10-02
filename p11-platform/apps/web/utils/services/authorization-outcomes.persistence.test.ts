import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {NextRequest} from 'next/server'
import {createSignedIntegrationOAuthState} from './integration-oauth-state'
import {authorizationOperation} from './integration-authorization'
import {getProviderScopes} from './integration-provider-config'
vi.mock('./google-calendar',()=>({getCalendarConfig:vi.fn(),ensureCalendarWatch:vi.fn()}))
const enabled=process.env.P11_LOCAL_CONSENT_TEST==='1'
const dbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=enabled && ['localhost','127.0.0.1'].includes(new URL(dbUrl).hostname)
if(enabled&&!local)throw new Error('Consent persistence tests require a local database')
describe.skipIf(!local)('local authorization outcomes persistence',()=>{
 const originalFetch=globalThis.fetch
 const db=createClient(dbUrl||'http://localhost:54321',process.env.SUPABASE_SERVICE_ROLE_KEY||'unused',{global:{fetch:originalFetch}})
 let property:string,calendar:string,actor:string
 let token:Record<string,unknown>
 let runIds:string[]=[]
 const save=async(q:PromiseLike<{error:unknown}>)=>{const result=await q;if(result.error)throw result.error}
 beforeEach(async()=>{
  vi.stubEnv('GOOGLE_CLIENT_ID','fixture');vi.stubEnv('GOOGLE_CLIENT_SECRET','fixture');vi.stubEnv('MICROSOFT_CLIENT_ID','fixture');vi.stubEnv('MICROSOFT_CLIENT_SECRET','fixture');vi.stubEnv('INTEGRATION_OAUTH_STATE_SECRET','local-consent-fixture');vi.stubEnv('GMAIL_OAUTH_STATE_SECRET','local-consent-fixture');vi.stubEnv('NEXT_PUBLIC_SITE_URL','http://127.0.0.1:9430')
  property=randomUUID();calendar=randomUUID();runIds=[]
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error;actor=profile.data.id
  await save(db.from('properties').insert({id:property,name:'Authorization outcomes fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{}}))
  await save(db.from('agent_calendars').insert({id:calendar,property_id:property,profile_id:actor,provider:'google',google_email:'consent@example.invalid',account_email:'consent@example.invalid',access_token:'original-fixture',refresh_token:'original-refresh',token_expires_at:'2099-01-01T00:00:00Z',timezone:null,token_status:'healthy',sync_enabled:true}))
  token={access_token:'new-fixture',refresh_token:'new-refresh',expires_in:3600,token_type:'Bearer',scope:'https://www.googleapis.com/auth/calendar'}
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input)
   if(new URL(url).hostname==='127.0.0.1'||new URL(url).hostname==='localhost')return originalFetch(input,init)
   if(url==='https://oauth2.googleapis.com/token'||url.startsWith('https://login.microsoftonline.com/'))return Response.json(token)
   if(url.includes('/userinfo'))return Response.json({email:'consent@example.invalid',id:'fixture-subject'})
   if(url.includes('/settings/timezone'))return Response.json({value:null})
   if(url.includes('/me?'))return Response.json({mail:'consent@example.invalid',id:'fixture-subject'})
   if(url.includes('/mailboxSettings'))return Response.json({timeZone:null})
   throw new Error('Unexpected external request in local test')
  }))
 })
 afterEach(async()=>{
  vi.unstubAllGlobals();vi.unstubAllEnvs()
  if(runIds.length)await save(db.from('cron_job_runs').delete().in('id',runIds))
  if(property){execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']});expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)}
 })

 async function prepare(){
  const payload={requestId:randomUUID(),redirectUri:'http://127.0.0.1:9430/api/lumaleasing/integrations/oauth/google/callback',requestedScopes:getProviderScopes('google',['calendar']),timestamp:Date.now(),propertyId:property,profileId:actor,provider:'google' as const,capabilities:['calendar' as const],authSource:'dashboard' as const}
  expect((await authorizationOperation('begin',payload)).state).toBe('ready')
  return payload
 }
 async function callback(payload:Awaited<ReturnType<typeof prepare>>,query:Record<string,string>={code:'private-code'},provider='google'){
  const state=createSignedIntegrationOAuthState(payload)
  const response=await (await import('../../app/api/lumaleasing/integrations/oauth/[provider]/callback/route')).GET(new NextRequest('http://127.0.0.1:9430/callback?'+new URLSearchParams({...query,state})),{params:Promise.resolve({provider})})
  return new URL(response.headers.get('location')!)
 }
 const events=async(id:string)=>{const r=await db.from('shared_action_events').select('id,action,phase,request,after_state,result,training_eligible').eq('episode_id',id);if(r.error)throw r.error;return r.data}
 const requestRow=async(id:string)=>{const r=await db.from('integration_authorizations').select('status,result,failure_source,finished_at').eq('id',id).single();if(r.error)throw r.error;return r.data}
 const connection=async()=>{const r=await db.from('agent_calendars').select('access_token,refresh_token,credential_version,scopes,sync_enabled').eq('id',calendar).single();if(r.error)throw r.error;return r.data}
 const providerCalls=()=>vi.mocked(fetch).mock.calls.filter(([url])=>!['127.0.0.1','localhost'].includes(new URL(String(url)).hostname))
 function interceptRpc(name:string,fn:(input:RequestInfo|URL,init:RequestInit|undefined,base:typeof fetch)=>Promise<Response>){
  const base=vi.mocked(fetch).getMockImplementation()!
  vi.mocked(fetch).mockImplementation((input,init)=>String(input).includes('/rpc/'+name)?fn(input,init,base):base(input,init))
 }
 it('persists one cancellation outcome through the actual callback, preserving the current account',async()=>{
  const before=await connection(),payload=await prepare()
  expect((await callback(payload,{error:'access_denied',error_description:'private-details'})).searchParams.get('error')).toBe('authorization_denied')
  expect((await callback(payload,{error:'access_denied'})).searchParams.get('error')).toBe('authorization_denied')
  expect(await connection()).toEqual(before);expect(await requestRow(payload.requestId)).toMatchObject({status:'blocked',result:{state:'authorization_denied'},failure_source:'signed_callback'})
  const rows=await events(payload.requestId);expect(rows).toHaveLength(2);expect(rows.find(row=>row.id===payload.requestId)).toMatchObject({action:'integration.authorization.cancelled',phase:'failed',training_eligible:false})
  expect(JSON.stringify(rows)).not.toMatch(/private-details|fixture-access|original-refresh|tokenHash|private-code/);expect(providerCalls()).toHaveLength(0)
 })
 it('records partial consent as a failure and prevents a second exchange',async()=>{
  const payload=await prepare(),before=await connection();token.scope='openid email'
  expect((await callback(payload)).searchParams.get('error')).toBe('permissions_incomplete')
  expect((await callback(payload)).searchParams.get('error')).toBe('permissions_incomplete')
  expect(await connection()).toEqual(before);expect(await requestRow(payload.requestId)).toMatchObject({status:'blocked',result:{state:'permissions_incomplete'},failure_source:'exchange_owner'})
  expect(await events(payload.requestId)).toHaveLength(2);expect(providerCalls()).toHaveLength(1)
 })
 it('a signed provider mismatch cannot close the saved request',async()=>{
  const payload=await prepare();expect((await callback(payload,{error:'access_denied'},'microsoft')).searchParams.get('error')).toBe('provider_mismatch')
  expect(await requestRow(payload.requestId)).toMatchObject({status:'pending'});expect(await events(payload.requestId)).toHaveLength(1);expect(providerCalls()).toHaveLength(0)
 })
 it('a duplicate cancellation cannot interrupt another worker exchange',async()=>{
  const payload=await prepare();expect((await authorizationOperation('claim',payload)).state).toBe('claimed')
  expect((await callback(payload,{error:'access_denied'})).searchParams.get('error')).toBe('authorization_outcome_unconfirmed')
  expect(await requestRow(payload.requestId)).toMatchObject({status:'exchanging'});expect(await events(payload.requestId)).toHaveLength(1);expect(providerCalls()).toHaveLength(0)
 })
 it('recovers the successful database commit when both final save responses are lost',async()=>{
  const payload=await prepare();let calls=0
  interceptRpc('finish_integration_authorization',async(input,init,base)=>{const r=await base(input,init);expect(r.ok).toBe(true);await r.json();calls++;return Response.json({message:'fixture lost response'},{status:503})})
  expect((await callback(payload)).searchParams.get('success')).toBe('calendar_setup_required');expect(calls).toBe(2)
  expect(await requestRow(payload.requestId)).toMatchObject({status:'completed',failure_source:null});expect(await connection()).toMatchObject({access_token:'new-fixture',credential_version:2})
  const rows=await events(payload.requestId);expect(rows).toHaveLength(2);expect(rows.find(row=>row.id===payload.requestId)?.action).toBe('integration.authorization.completed')
  expect(providerCalls().filter(([url])=>String(url).endsWith('/token'))).toHaveLength(1)
 })
 it('a delayed cancellation recovers success without changing credentials again',async()=>{
  const payload=await prepare();expect((await callback(payload)).searchParams.get('success')).toBe('calendar_setup_required');const before=await connection();const calls=providerCalls().length
  expect((await callback(payload,{error:'access_denied'})).searchParams.get('success')).toBe('calendar_setup_required')
  expect(await connection()).toEqual(before);expect(await events(payload.requestId)).toHaveLength(2);expect(providerCalls()).toHaveLength(calls)
 })
 it('reports unconfirmed evidence during an outage and recovers the same cancellation after it clears',async()=>{
  const payload=await prepare(),before=await connection(),base=vi.mocked(fetch).getMockImplementation()!
  interceptRpc('close_integration_authorization',async()=>Response.json({message:'fixture unavailable'},{status:503}))
  expect((await callback(payload,{error:'access_denied'})).searchParams.get('error')).toBe('authorization_outcome_unconfirmed');expect(await requestRow(payload.requestId)).toMatchObject({status:'pending'});expect(await events(payload.requestId)).toHaveLength(1)
  vi.mocked(fetch).mockImplementation(base)
  expect((await callback(payload,{error:'access_denied'})).searchParams.get('error')).toBe('authorization_denied');expect(await events(payload.requestId)).toHaveLength(2);expect(await connection()).toEqual(before)
 })
 it('uses expired state for a recorded stop without contacting the provider',async()=>{
  const payload=await prepare();await save(db.from('integration_authorizations').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',payload.requestId))
  expect((await callback({...payload,timestamp:Date.now()-16*60000})).searchParams.get('error')).toBe('expired_state');expect(await requestRow(payload.requestId)).toMatchObject({status:'blocked',result:{state:'expired_state'}});expect(await events(payload.requestId)).toHaveLength(2);expect(providerCalls()).toHaveLength(0)
 })
 it('the protected cleanup route saves its run and the abandoned request outcome',async()=>{
  const payload=await prepare();await save(db.from('integration_authorizations').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',payload.requestId));vi.stubEnv('CRON_SECRET','local-expiry-fixture')
  const requestId=randomUUID(),{GET}=await import('../../app/api/cron/integration-authorizations/route')
  const response=await GET(new NextRequest('http://127.0.0.1:9430/api/cron/integration-authorizations',{headers:{authorization:'Bearer local-expiry-fixture','x-request-id':requestId}}))
  const runs=await db.from('cron_job_runs').select('id,status,summary').eq('request_id',requestId);runIds=runs.data?.map(r=>r.id)||[]
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'completed',processed:1,remaining:false,legacyUnqualified:0});expect(runs.data).toHaveLength(1);expect(runs.data![0]).toMatchObject({status:'success',summary:{processed:1}})
  expect(await requestRow(payload.requestId)).toMatchObject({status:'blocked',failure_source:'expiry_sweep'});expect(await events(payload.requestId)).toHaveLength(2);expect(providerCalls()).toHaveLength(0)
 })
})
