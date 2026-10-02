import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('Gmail status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-12T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the user cannot access the property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: false,
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(403)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns disconnected when no Gmail configuration exists', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          })),
        })),
      })),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toMatchObject({
      connected: false,
      message: 'Email not connected',
      webhook_capability: {
        mode: 'unconfigured',
        ready: false,
        blockers: ['missing_email_connection'],
      },
    })
  })

  it('returns status metadata for a connected account', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    const emailThreadsSelect = vi
      .fn()
      .mockReturnValueOnce({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  status: 'awaiting_internal_reply',
                  last_message_at: '2026-03-09T00:06:00.000Z',
                },
                {
                  status: 'awaiting_lead_reply',
                  last_message_at: '2026-03-10T00:04:00.000Z',
                },
                {
                  status: 'active',
                  last_message_at: '2026-03-10T00:03:00.000Z',
                },
                {
                  status: 'something_custom',
                  last_message_at: '2026-03-10T00:01:00.000Z',
                },
              ],
              error: null,
            }),
          })),
        })),
      })
      .mockReturnValueOnce({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'thread-1',
                    status: 'awaiting_internal_reply',
                    subject: 'Tour follow-up',
                    last_message_at: '2026-03-09T00:06:00.000Z',
                    message_count: 4,
                    lead_id: 'lead-1',
                  },
                ],
                error: null,
              }),
            })),
          })),
        })),
      })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_configurations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'config-1',
                    google_email: 'leasing@example.com',
                    token_status: 'healthy', scopes: ['https://www.googleapis.com/auth/calendar','https://www.googleapis.com/auth/gmail.modify','User.Read','Calendars.ReadWrite','Mail.Send','Mail.Read'], provider_metadata: {scopeEvidence:'provider_response'},
                    token_expires_at: '2026-03-12T14:00:00.000Z',
                    last_health_check_at: '2026-03-10T00:00:00.000Z',
                    last_sync_at: '2026-03-10T00:05:00.000Z',
                    sync_enabled: true,
                    auto_reply_enabled: false,
                    history_id: '101',
                    watch_expiration: '2026-03-12T14:00:00.000Z',
                  },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'email_threads') {
          return {
            select: emailThreadsSelect,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/email/status?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      connected: true,
      email: 'leasing@example.com',
      token_status: 'healthy', permission_state: 'confirmed',
      sync_enabled: true,
      auto_reply_enabled: false,
      webhook_capability: {
        mode: 'push_watch',
        ready: true,
        blockers: [],
        history_id: '101',
        watch_expires_at: '2026-03-12T14:00:00.000Z',
        watch_ttl_minutes: 120,
      },
      thread_lifecycle: {
        total_threads: 4,
        awaiting_internal_reply: 1,
        awaiting_internal_reply_overdue: 1,
        awaiting_lead_reply: 1,
        active: 1,
        other: 1,
        latest_thread_activity_at: '2026-03-09T00:06:00.000Z',
      },
      pending_threads_preview: [
        {
          id: 'thread-1',
          status: 'awaiting_internal_reply',
          subject: 'Tour follow-up',
          last_message_at: '2026-03-09T00:06:00.000Z',
          message_count: 4,
          lead_id: 'lead-1',
          overdue: true,
          overdue_days: 3,
        },
      ],
    })
  })
  async function status(row: Record<string,unknown> | null, error: unknown = null) {
    authGetUserMock.mockResolvedValue({data:{user:{id:'user-1'}}})
    createClientMock.mockResolvedValue({auth:{getUser:authGetUserMock}})
    validatePropertyAccessMock.mockResolvedValue({authorized:true})
    createServiceClientMock.mockReturnValue({from:(table:string)=>{
      if(table==='email_configurations')return {select:()=>({eq:()=>({is: vi.fn().mockReturnThis(), maybeSingle:async()=>({data:row,error})})})}
      const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:async()=>({data:[],error:null})};return q
    }})
    return (await import('./route')).GET(new Request('http://localhost/api/lumaleasing/email/status?propertyId=property-1') as NextRequest)
  }
  it.each([null,'invalid','2026-03-12T11:00:00Z'])('never reports healthy access with unavailable expiry %s',async token_expires_at=>{
    const r=await status({id:'config-1',sync_enabled:true,token_status:'healthy',token_expires_at})
    expect(await r.json()).toMatchObject({connected:false,state:'reconnect_required'})
  })
  it('reports a read failure as unavailable instead of a disconnected account',async()=>{
    const r=await status(null,{message:'Database unavailable'});expect(r.status).toBe(500)
  })
  it('gives Outlook renewal guidance without Gmail watch warnings',async()=>{
    const r=await status({id:'config-1',provider:'microsoft',sync_enabled:true,token_status:'refresh_unconfirmed',token_expires_at:'2099-01-01'})
    const body=await r.json();expect(body).toMatchObject({connected:false,state:'reconnect_required',message:expect.stringContaining('could not be confirmed'),webhook_capability:{mode:'manual_check',ready:false}});expect(JSON.stringify(body)).not.toContain('missing_watch')
  })

})

it.each(['google','microsoft'])('holds fresh %s credentials without verified permission evidence',async provider=>{
 authGetUserMock.mockResolvedValue({data:{user:{id:'user-1'}}});createClientMock.mockResolvedValue({auth:{getUser:authGetUserMock}});validatePropertyAccessMock.mockResolvedValue({authorized:true})
 const row={id:'connection-1',provider,google_email:'fixture@example.invalid',token_status:'healthy',sync_enabled:true,token_expires_at:'2099-01-01',scopes:['User.Read','Calendars.ReadWrite','Mail.Send','Mail.Read'],provider_metadata:{},timezone:'UTC'}
 createServiceClientMock.mockReturnValue({from:(name:string)=>{const value=name==='email_configurations'?row:[];const q:Record<string,unknown>={then:(resolve:(x:unknown)=>void)=>resolve({data:value,error:null})};for(const method of ['select','eq','is','in','order','limit'])q[method]=()=>q;q.maybeSingle=async()=>({data:value,error:null});return q}})
 const {GET}=await import('./route');const response=await GET(new Request('http://localhost/api/lumaleasing/email/status?propertyId=property-1') as NextRequest);const body=await response.json()
 expect(response.status).toBe(200);expect(body).toMatchObject({state:'reconnect_required',connected:false,permission_state:'permissions_unconfirmed',webhook_capability:{ready:false}});expect(body.permission_message).toContain('Reconnect');expect(body).not.toHaveProperty('provider_metadata');expect(body).not.toHaveProperty('scopes')
})
