import {beforeEach,afterEach,it,expect,vi} from 'vitest'
const d=vi.hoisted(()=>({fetch:vi.fn(),renew:vi.fn(),saved:vi.fn(),eq:vi.fn(),is:vi.fn()}))
vi.mock('@/utils/services/calendar-credentials',()=>({renewCalendarCredentials:d.renew}))
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:()=>({from:()=>{const q={update:()=>q,eq:d.eq,is:d.is,select:()=>q,maybeSingle:d.saved};d.eq.mockReturnValue(q);d.is.mockReturnValue(q);return q}})}))
import {setupCalendarWatch,type CalendarConfig} from './google-calendar'
const config={id:'calendar',property_id:'property',provider:'google',calendar_id:'original',credential_version:4} as CalendarConfig
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',d.fetch);vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://fixture.invalid');vi.stubEnv('GOOGLE_CALENDAR_WEBHOOK_URL','https://fixture.invalid/api/lumaleasing/calendar/webhook');d.renew.mockResolvedValue({accessToken:'fixture-token',expiresAt:'2099-01-01'});d.fetch.mockResolvedValue(new Response(JSON.stringify({resourceId:'remote',expiration:String(Date.now()+3600000)}),{status:200}));d.saved.mockResolvedValue({data:{id:'calendar'},error:null})})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('saves the provider watch only on the original current connection version',async()=>{expect(await setupCalendarWatch({...config})).toMatchObject({resourceId:'remote'});expect(d.eq).toHaveBeenCalledWith('id','calendar');expect(d.eq).toHaveBeenCalledWith('credential_version',4);expect(d.eq).toHaveBeenCalledWith('sync_enabled',true);expect(d.is).toHaveBeenCalledWith('retired_at',null)})
it('does not report a saved watch after replacement retires its account',async()=>{d.saved.mockResolvedValue({data:null,error:null});await expect(setupCalendarWatch({...config})).rejects.toThrow('connection changed')})
it('rejects unavailable saves',async()=>{d.saved.mockResolvedValue({error:{message:'private detail'}});await expect(setupCalendarWatch({...config})).rejects.toThrow('connection changed')})
it('bounds unauthorized retries to one',async()=>{d.fetch.mockImplementation(async()=>new Response('{}',{status:401}));await expect(setupCalendarWatch({...config})).rejects.toThrow('401');expect(d.fetch).toHaveBeenCalledTimes(2)})
it('rejects unconfirmed watch expiry',async()=>{d.fetch.mockResolvedValue(new Response(JSON.stringify({resourceId:'remote'}),{status:200}));await expect(setupCalendarWatch({...config})).rejects.toThrow('expiry');expect(d.saved).not.toHaveBeenCalled()})
