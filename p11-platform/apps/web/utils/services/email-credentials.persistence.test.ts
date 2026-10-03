import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createClient,type SupabaseClient} from '@supabase/supabase-js'
import type {Database} from '@/types/supabase'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {renewEmailCredentials,type EmailCredentials} from './email-credentials'
const enabled=process.env.P11_LOCAL_EMAIL_TEST==='1',url=process.env.NEXT_PUBLIC_SUPABASE_URL||''
const local=enabled&&['localhost','127.0.0.1'].includes(new URL(url).hostname)
if(enabled&&!local)throw new Error('Email persistence tests require the local database')
describe.skipIf(!local)('email renewal persistence',()=>{
 const originalFetch=globalThis.fetch,db=createClient(url||'http://127.0.0.1:54321',process.env.SUPABASE_SERVICE_ROLE_KEY||'unused',{global:{fetch:originalFetch}})
 let property:string,email:string,actor:string,config:EmailCredentials
 const provider=vi.fn()
 const save=async(q:PromiseLike<{error:unknown}>)=>{const r=await q;if(r.error)throw r.error}
 const saved=async()=>{const r=await db.from('email_configurations').select('*').eq('id',email).single();if(r.error)throw r.error;return r.data}
 beforeEach(async()=>{
  vi.stubEnv('MICROSOFT_CLIENT_ID','fixture');vi.stubEnv('MICROSOFT_CLIENT_SECRET','fixture');property=randomUUID();email=randomUUID();provider.mockReset()
  const p=await db.from('profiles').select('id').eq('org_id','22222222-2222-2222-2222-222222222222').limit(1).single();if(p.error)throw p.error;actor=p.data.id
  await save(db.from('properties').insert({id:property,name:'Email renewal persistence fixture',org_id:'22222222-2222-2222-2222-222222222222'}))
  await save(db.from('email_configurations').insert({id:email,property_id:property,profile_id:actor,provider:'microsoft',google_email:'renewal@example.invalid',account_email:'renewal@example.invalid',access_token:'old-fixture',refresh_token:'old-refresh',token_expires_at:new Date(Date.now()-60000).toISOString(),sync_enabled:true,token_status:'healthy',scopes:['User.Read','Mail.Send','Mail.Read'],provider_metadata:{scopeEvidence:'provider_response'}}))
  config=await saved() as EmailCredentials
  provider.mockImplementation(async()=>Response.json({access_token:'new-fixture',refresh_token:'rotated-fixture',expires_in:3600,token_type:'Bearer'}))
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
   if(['127.0.0.1','localhost'].includes(new URL(String(input)).hostname))return originalFetch(input,init)
   if(String(input).startsWith('https://login.microsoftonline.com/'))return provider(input,init)
   throw new Error('Unexpected nonlocal request')
  }))
 })
 afterEach(async()=>{
  vi.unstubAllEnvs();vi.unstubAllGlobals()
  if(property){execFileSync('docker',['exec','-i','supabase_db_p11-platform','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.properties SET current_vertical_profile_version_id=NULL WHERE id='${property}'; DELETE FROM public.property_vertical_profile_versions WHERE property_id='${property}'; SET LOCAL session_replication_role=origin; DELETE FROM public.properties WHERE id='${property}'; COMMIT;`,stdio:['pipe','pipe','pipe']});expect((await db.from('properties').select('id').eq('id',property)).data).toHaveLength(0)}
 })
 const typed=db as unknown as SupabaseClient<Database>
 it('recovers a lost committed save without a second provider exchange',async()=>{
  let lost=true
  const adapter={rpc:async(name:string,args:Record<string,unknown>)=>{const r=await db.rpc(name,args);if(name==='finish_email_token_refresh'&&lost){lost=false;expect(r.error).toBeNull();throw new Error('Lost committed response')}return r}} as unknown as SupabaseClient<Database>
  expect(await renewEmailCredentials(config,false,adapter)).toMatchObject({accessToken:'new-fixture'})
  expect(await saved()).toMatchObject({credential_version:2,refresh_token:'rotated-fixture',token_status:'healthy'});expect(provider).toHaveBeenCalledTimes(1)
  expect((await db.from('email_token_refreshes').select('refresh_status,completed_version').eq('email_configuration_id',email)).data).toEqual([{refresh_status:'success',completed_version:2}])
 })
 it('serializes overlapping renewals and reuses the committed revision',async()=>{
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve}),held=new Promise<void>(resolve=>{release=resolve})
  provider.mockImplementation(async()=>{enter();await held;return Response.json({access_token:'new-fixture',expires_in:3600})})
  const first=renewEmailCredentials({...config},false,typed);await entered
  try{await expect(renewEmailCredentials({...config},false,typed)).rejects.toThrow('being renewed')}finally{release()}
  await first;expect(await renewEmailCredentials({...config},true,typed)).toMatchObject({accessToken:'new-fixture'});expect(provider).toHaveBeenCalledTimes(1)
 })
 it('cannot restore an account removed while renewal is at the provider',async()=>{
  provider.mockImplementation(async()=>{const r=await db.rpc('disconnect_recorded_email',{p_property_id:property,p_actor_id:actor,p_request_id:randomUUID()});expect(r.error).toBeNull();return Response.json({access_token:'late-fixture',refresh_token:'late-refresh',expires_in:3600})})
  await expect(renewEmailCredentials(config,false,typed)).rejects.toThrow('connection changed')
  expect(await saved()).toMatchObject({access_token:null,refresh_token:null,sync_enabled:false,token_status:'disconnected'})
 })
 it('holds uncertain exchange and never retries a possibly rotated credential',async()=>{
  provider.mockRejectedValue(new Error('Timeout'))
  await expect(renewEmailCredentials(config,false,typed)).rejects.toThrow('could not be confirmed')
  await expect(renewEmailCredentials(config,false,typed)).rejects.toThrow('Reconnect');expect(provider).toHaveBeenCalledTimes(1);expect(await saved()).toMatchObject({token_status:'refresh_unconfirmed',access_token:'old-fixture'})
 })
 it('cannot revoke newer authorization after a delayed invalid_grant',async()=>{
  provider.mockImplementation(async()=>{await save(db.from('email_configurations').update({access_token:'new-consent',refresh_token:'new-consent-refresh',token_expires_at:new Date(Date.now()+3600000).toISOString()}).eq('id',email));return Response.json({error:'invalid_grant'},{status:400})})
  await expect(renewEmailCredentials(config,false,typed)).rejects.toThrow('connection changed');expect(await saved()).toMatchObject({access_token:'new-consent',token_status:'healthy'})
 })
})
