import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const d=vi.hoisted(()=>({fetch:vi.fn(),watch:vi.fn(),getConfig:vi.fn(),state:{} as Record<string,unknown>,zone:null as unknown,settings:{} as Record<string,unknown>,writes:[] as Record<string,unknown>[],readError:false,saveError:false,noAcknowledgement:false,existing:true,tokenOverride:{} as Record<string,unknown>}))
vi.mock('@/utils/services/integration-authorization',()=>({authorizationOperation:async(operation:string,_state:unknown,grant:Record<string,unknown>)=>{
 if(operation==='claim'){if(d.readError)throw new Error('authorization_unconfirmed');return {state:'claimed',claimToken:'owner'}}
 if(d.saveError||d.noAcknowledgement)throw new Error('authorization_unconfirmed')
 d.writes.push({timezone:grant.timezone,scopes:grant.scopes,provider_metadata:{scopeEvidence:grant.scopeEvidence}})
 return {state:'saved',calendarId:'calendar',timezoneSetupRequired:!d.settings.timezone&&!grant.timezone}
},closeAuthorizationOutcome:async(_state:unknown,reason:string)=>({state:reason})}))
vi.mock('@/utils/services/google-oauth-state',()=>({verifySignedGoogleOAuthState:()=>({propertyId:'property',profileId:'actor'})}))
vi.mock('@/utils/services/integration-oauth-state',()=>({INTEGRATION_STATE_TTL_MS:15*60000,verifySignedIntegrationOAuthState:()=>d.state}))
vi.mock('@/utils/services/google-calendar',()=>({getCalendarConfig:d.getConfig,ensureCalendarWatch:d.watch}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:(table:string)=>{
 let writing=false
 const result=()=>{
  if(table==='properties')return {data:{org_id:'org',settings:d.settings},error:null}
  if(table==='profiles')return {data:{org_id:'org'},error:null}
  if(table==='agent_calendars')return writing?{data:d.noAcknowledgement?null:{id:'calendar'},error:d.saveError?{message:'fixture failure'}:null}:{data:d.existing?{id:'calendar'}:null,error:d.readError?{message:'fixture read error'}:null}
  throw new Error('Unexpected table '+table)
 }
 const q={select:()=>q,eq:()=>q,insert:(value:Record<string,unknown>)=>{writing=true;d.writes.push(value);return q},update:(value:Record<string,unknown>)=>{writing=true;d.writes.push(value);return q},single:async()=>result(),maybeSingle:async()=>result()};return q
}})}))
const ok=(body:unknown)=>({ok:true,json:async()=>body})
beforeEach(()=>{
 vi.resetAllMocks();vi.resetModules();vi.stubGlobal('fetch',d.fetch)
 vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://app.example.com');vi.stubEnv('GOOGLE_CLIENT_ID','fixture');vi.stubEnv('GOOGLE_CLIENT_SECRET','fixture');vi.stubEnv('MICROSOFT_CLIENT_ID','fixture');vi.stubEnv('MICROSOFT_CLIENT_SECRET','fixture')
 d.zone=null;d.settings={};d.writes=[];d.readError=false;d.saveError=false;d.noAcknowledgement=false;d.existing=true;d.tokenOverride={}
 d.state={timestamp:Date.now(),requestId:'fixture',redirectUri:'https://app.example.com/callback',provider:'google',propertyId:'property',profileId:'actor',authSource:'dashboard',capabilities:['calendar']}
 d.getConfig.mockResolvedValue({id:'calendar'});d.watch.mockResolvedValue({id:'watch'})
 d.fetch.mockImplementation(async(url:string)=>{
  if(url.includes('token'))return ok({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,token_type:'Bearer',scope:d.state.provider==='microsoft'?'Calendars.ReadWrite User.Read':'https://www.googleapis.com/auth/calendar',...d.tokenOverride})
  if(url.includes('settings/timezone'))return d.zone==='unavailable'?{ok:false,status:503}:d.zone==='network'?Promise.reject(new Error('fixture network')):ok({value:d.zone})
  if(url.includes('userinfo'))return ok({email:'calendar@example.invalid',id:'fixture'})
  if(url.includes('mailboxSettings'))return d.zone==='unavailable'?{ok:false,status:403}:d.zone==='network'?Promise.reject(new Error('fixture network')):ok({timeZone:d.zone})
  if(url.includes('/me?'))return ok({mail:'calendar@example.invalid',id:'fixture'})
  throw new Error('Unexpected URL')
 })
})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
async function callback(kind:'google'|'microsoft'){
 d.state.provider=kind==='microsoft'?'microsoft':'google'
 const request=new NextRequest(`https://app.example.com/api/lumaleasing/integrations/oauth/${kind}/callback?code=fixture&state=fixture`)
 const response=await (await import('../../app/api/lumaleasing/integrations/oauth/[provider]/callback/route')).GET(request,{params:Promise.resolve({provider:kind})})
 return new URL(response.headers.get('location')!)
}
it.each(['google','microsoft'] as const)('keeps unknown timezone explicit and confirmed authorization for %s',async kind=>{
 const url=await callback(kind);expect(url.searchParams.get('success')).toBe('calendar_setup_required');expect(url.searchParams.get('propertyId')).toBe('property');expect(d.writes).toHaveLength(1);expect(d.writes[0].timezone).toBeNull();expect(d.watch).not.toHaveBeenCalled()
})
it.each(['google','microsoft'] as const)('uses an explicitly configured property zone for %s',async kind=>{
 d.settings={timezone:'America/New_York'};const url=await callback(kind);expect(url.searchParams.get('success')).toBe('calendar_connected');expect(d.writes[0].timezone).toBeNull()
})
it.each(['google','microsoft'] as const)('holds setup when a provider zone is malformed for %s',async kind=>{d.zone={wrong:'shape'};expect((await callback(kind)).searchParams.get('success')).toBe('calendar_setup_required')})
it.each(['google','microsoft'] as const)('retains authorization after a timezone network failure for %s',async kind=>{d.zone='network';expect((await callback(kind)).searchParams.get('success')).toBe('calendar_setup_required')})
it.each(['google','microsoft'] as const)('does not insert after an uncertain existing connection read for %s',async kind=>{d.readError=true;expect((await callback(kind)).searchParams.has('success')).toBe(false);expect(d.writes).toHaveLength(0)})
it.each(['google','microsoft'] as const)('does not claim success without an update acknowledgement for %s',async kind=>{d.noAcknowledgement=true;expect((await callback(kind)).searchParams.has('success')).toBe(false);expect(d.watch).not.toHaveBeenCalled()})
it.each(['google','microsoft'] as const)('does not claim a failed initial insert for %s',async kind=>{d.existing=false;d.saveError=true;expect((await callback(kind)).searchParams.has('success')).toBe(false);expect(d.watch).not.toHaveBeenCalled()})
it('normalizes Microsoft mailbox timezone before persistence',async()=>{d.zone='Pacific Standard Time';expect((await callback('microsoft')).searchParams.get('success')).toBe('calendar_connected');expect(d.writes[0].timezone).toBe('America/Los_Angeles')})
it('shows missing timezone setup to an external invite authorizer',async()=>{d.state.authSource='external_invite';d.state.profileId=null;const url=await callback('google');expect(url.pathname).toBe('/lumaleasing/integrations/success');expect(url.searchParams.get('success')).toBe('calendar_setup_required')})

it.each(['google','microsoft'] as const)('holds a partial calendar grant before any account read/save for %s',async kind=>{d.tokenOverride={scope:'openid email profile'};const url=await callback(kind);expect(url.searchParams.get('error')).toBe('permissions_incomplete');expect(d.writes).toHaveLength(0);expect(d.fetch).toHaveBeenCalledTimes(1);expect(d.watch).not.toHaveBeenCalled()})
it.each(['google','microsoft'] as const)('holds malformed tokens without echoing or saving them for %s',async kind=>{d.tokenOverride={access_token:{secret:'malformed-secret'}};const url=await callback(kind);expect(url.searchParams.get('error')).toBe('invalid_token_response');expect(url.href).not.toContain('malformed-secret');expect(d.writes).toHaveLength(0);expect(d.fetch).toHaveBeenCalledTimes(1)})
it.each(['google','microsoft'] as const)('stores granted rather than invented scopes for %s',async kind=>{await callback(kind);expect(d.writes[0].scopes).toEqual(kind==='microsoft'?['Calendars.ReadWrite','User.Read']:['https://www.googleapis.com/auth/calendar']);expect(d.writes[0].provider_metadata).toMatchObject({scopeEvidence:'provider_response'})})
it('keeps an external invitation authorizer on the external error page',async()=>{d.state.authSource='external_invite';d.state.profileId=null;d.tokenOverride={scope:'openid'};const url=await callback('google');expect(url.pathname).toBe('/lumaleasing/integrations/success');expect(url.searchParams.get('error')).toBe('permissions_incomplete');expect(d.writes).toHaveLength(0)})
it('does not partially save a combined calendar/email grant',async()=>{d.state.capabilities=['calendar','email'];const url=await callback('google');expect(url.searchParams.get('error')).toBe('permissions_incomplete');expect(d.writes).toHaveLength(0);expect(d.watch).not.toHaveBeenCalled()})
it('supports omitted Microsoft scopes only with the signed original request',async()=>{d.state.requestedScopes=['Calendars.ReadWrite','User.Read'];d.tokenOverride={scope:undefined};const url=await callback('microsoft');expect(url.searchParams.get('success')).toBe('calendar_setup_required');expect(d.writes[0].provider_metadata).toMatchObject({scopeEvidence:'microsoft_request_contract'})})
it.each(['google','microsoft'] as const)('holds an unconfirmed grant without a signed request for %s',async kind=>{d.tokenOverride={scope:undefined};const url=await callback(kind);expect(url.searchParams.get('error')).toBe('permissions_unconfirmed');expect(d.writes).toHaveLength(0)})
