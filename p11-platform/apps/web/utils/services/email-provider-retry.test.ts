import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {sendEmail,getThread,listRecentMessages,getMessage,syncInbox,setupWatch,type GmailConfig} from './gmail-service'
const d=vi.hoisted(()=>({renew:vi.fn(),fetch:vi.fn(),from:vi.fn()}))
vi.mock('./email-credentials',()=>({renewEmailCredentials:d.renew}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:d.from})}))
const config=(provider:'google'|'microsoft'='google')=>({id:'fixture',property_id:'property',provider,credential_version:1,google_email:'fixture@example.invalid',access_token:'old',refresh_token:'old-refresh',token_expires_at:'2099-01-01',signature_template:null} as GmailConfig)
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('OUTBOUND_DELIVERY_PAUSED','false');vi.stubGlobal('fetch',d.fetch);d.renew.mockResolvedValue({accessToken:'confirmed',expiresAt:'2099-01-01'});d.fetch.mockImplementation(async()=>new Response(null,{status:401}))})
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()})
it.each(['google-send','microsoft-send','thread','list','message','microsoft-sync','watch'])('bounds repeated 401 responses for %s',async operation=>{
 const c=config(operation.startsWith('microsoft')?'microsoft':'google')
 const call=operation.endsWith('send')?()=>sendEmail(c,{to:['fixture@example.invalid'],subject:'Fixture',bodyText:'Fixture'}):operation==='thread'?()=>getThread(c,'thread'):operation==='list'?()=>listRecentMessages(c):operation==='message'?()=>getMessage(c,'message'):operation==='microsoft-sync'?()=>syncInbox(c):()=>setupWatch(c)
 await expect(call()).rejects.toThrow('401');expect(d.fetch).toHaveBeenCalledTimes(2);expect(d.renew.mock.calls.filter(args=>args[1]===true)).toHaveLength(1);expect(d.from).not.toHaveBeenCalled()
})
it('refuses to acknowledge a watch saved against a removed or changed connection',async()=>{
 d.fetch.mockResolvedValue(Response.json({expiration:String(Date.now()+86400000)}));const q={update:()=>q,eq:vi.fn(()=>q),select:()=>q,maybeSingle:async()=>({data:null,error:null})};d.from.mockReturnValue(q)
 await expect(setupWatch(config())).rejects.toThrow('could not be saved');expect(q.eq).toHaveBeenCalledWith('credential_version',1);expect(q.eq).toHaveBeenCalledWith('sync_enabled',true)
})
