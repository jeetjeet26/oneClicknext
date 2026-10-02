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
describe.skipIf(!local)('local consent persistence',()=>{
 const originalFetch=globalThis.fetch
 const db=createClient(dbUrl||'http://localhost:54321',process.env.SUPABASE_SERVICE_ROLE_KEY||'unused',{global:{fetch:originalFetch}})
 let property:string,calendar:string,actor:string
 let token:Record<string,unknown>
 const save=async(q:PromiseLike<{error:unknown}>)=>{const result=await q;if(result.error)throw result.error}
 beforeEach(async()=>{
  vi.stubEnv('GOOGLE_CLIENT_ID','fixture');vi.stubEnv('GOOGLE_CLIENT_SECRET','fixture');vi.stubEnv('MICROSOFT_CLIENT_ID','fixture');vi.stubEnv('MICROSOFT_CLIENT_SECRET','fixture');vi.stubEnv('INTEGRATION_OAUTH_STATE_SECRET','local-consent-fixture');vi.stubEnv('GMAIL_OAUTH_STATE_SECRET','local-consent-fixture');vi.stubEnv('NEXT_PUBLIC_SITE_URL','http://127.0.0.1:9430')
  property=randomUUID();calendar=randomUUID()
  const profile=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(profile.error)throw profile.error;actor=profile.data.id
  await save(db.from('properties').insert({id:property,name:'Calendar consent fixture',org_id:'22222222-2222-2222-2222-222222222222',settings:{}}))
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
  if(property){execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']});expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)}
 })
 async function invoke(kind:'google'|'microsoft',capabilities:('calendar'|'email')[]=['calendar']){
  const payload={requestId:randomUUID(),redirectUri:`http://127.0.0.1:9430/api/lumaleasing/integrations/oauth/${kind}/callback`,requestedScopes:getProviderScopes(kind,capabilities),timestamp:Date.now(),propertyId:property,profileId:actor,provider:kind,capabilities,authSource:'dashboard' as const}
  expect((await authorizationOperation('begin',payload)).state).toBe('ready')
  const state=createSignedIntegrationOAuthState(payload)
  const request=new NextRequest(`http://127.0.0.1:9430/api/lumaleasing/integrations/oauth/${kind}/callback?code=fixture&state=${state}`)
  const response=await (await import('../../app/api/lumaleasing/integrations/oauth/[provider]/callback/route')).GET(request,{params:Promise.resolve({provider:kind})})
  return new URL(response.headers.get('location')!)
 }
 const saved=async()=>{const row=await db.from('agent_calendars').select('access_token,refresh_token,credential_version,scopes,provider_metadata').eq('id',calendar).single();if(row.error)throw row.error;return row.data}
 it.each(['google'] as const)('preserves the actual saved connection after partial consent through %s',async kind=>{
  const before=await saved();token.scope='openid email';expect((await invoke(kind)).searchParams.get('error')).toBe('permissions_incomplete');expect(await saved()).toEqual(before)
 })
 it.each(['google'] as const)('persists exactly the confirmed permission through %s',async kind=>{
  expect((await invoke(kind)).searchParams.get('success')).toBe('calendar_setup_required');expect(await saved()).toMatchObject({access_token:'new-fixture',refresh_token:'new-refresh',credential_version:2,scopes:['https://www.googleapis.com/auth/calendar'],provider_metadata:{scopeEvidence:'provider_response'}})
 })
 it('keeps both integrations unchanged after partial combined consent',async()=>{
  const before=await saved();expect((await invoke('google',['calendar','email'])).searchParams.get('error')).toBe('permissions_incomplete');expect(await saved()).toEqual(before);expect((await db.from('email_configurations').select('id').eq('property_id',property)).data).toHaveLength(0)
 })
 it('persists the documented Microsoft request evidence when scope is omitted',async()=>{
  await save(db.from('agent_calendars').update({provider:'microsoft'}).eq('id',calendar));delete token.scope
  expect((await invoke('microsoft')).searchParams.get('success')).toBe('calendar_setup_required');expect(await saved()).toMatchObject({access_token:'new-fixture',scopes:['openid','email','profile','offline_access','User.Read','Calendars.ReadWrite','MailboxSettings.Read'],provider_metadata:{scopeEvidence:'microsoft_request_contract'}})
 })
})
