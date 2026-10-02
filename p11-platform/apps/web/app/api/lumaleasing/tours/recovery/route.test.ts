import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const updateCalendarEventMock = vi.fn()
const createCalendarEventMock = vi.fn()
const cancelCalendarEventMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: getCalendarConfigMock,
  updateCalendarEvent: updateCalendarEventMock,
  createCalendarEvent: createCalendarEventMock,
  cancelCalendarEvent: cancelCalendarEventMock,
}))

describe('LumaLeasing tour recovery route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/recovery?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('GET returns recoverable bookings with calendar and lead metadata', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true, orgId: 'org-1' })

    const calls:Array<[string,string,unknown,unknown?]>=[]
    createServiceClientMock.mockReturnValue({from:(table:string)=>{
      const data=table==='tour_bookings'?[{id:'booking-1',property_id:'property-1',lead_id:'lead-1',scheduled_date:'2026-03-25',scheduled_time:'10:00:00',duration_minutes:30,status:'confirmed',schedule_version:1}]:table==='calendar_events'?[{id:'cal-1',tour_booking_id:'booking-1',google_event_id:'google-1',sync_status:'synced'}]:[{id:'lead-1',first_name:'Jane',last_name:'Doe',email:'jane@example.com',phone:'555-111-2222'}]
      const q={select:()=>q,eq:(column:string,value:unknown)=>{calls.push([table,'eq',column,value]);return q},in:(column:string,value:unknown)=>{calls.push([table,'in',column,value]);return q},order:()=>q,limit:()=>q,or:()=>q,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve)};return q
    }})

    const { GET } = await import('./route')
    const request = new Request(
      'http://localhost/api/lumaleasing/tours/recovery?propertyId=property-1'
    ) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(calls).toContainEqual(['calendar_events','in','tour_booking_id',['booking-1']]);expect(calls).toContainEqual(['leads','eq','property_id','property-1'])
    expect(json.bookings).toHaveLength(1)
    expect(json.bookings[0]).toMatchObject({
      id: 'booking-1',
      can_cancel: true,
      can_reschedule: true,
      lead: { name: 'Jane Doe', email: 'jane@example.com' },
      calendar_event: { id: 'cal-1', google_event_id: 'google-1', sync_status: 'synced' },
    })
  })

  it('rejects an invalid pagination cursor before database access',async()=>{
    const {GET}=await import('./route')
    const cursor=Buffer.from(JSON.stringify({date:'2026-09-30),id.neq.x',time:'10:00:00',id:'any'})).toString('base64url')
    expect((await GET(new Request(`http://localhost/api/lumaleasing/tours/recovery?propertyId=property-1&cursor=${cursor}`) as NextRequest)).status).toBe(400)
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })

  it('requires the versioned cancellation contract before any provider work',async()=>{
    const {POST}=await import('./route')
    const response=await POST(new Request('http://localhost/api/lumaleasing/tours/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId:'property-1',bookingId:'booking-1',action:'cancel'})}) as NextRequest)
    expect(response.status).toBe(400)
    expect(cancelCalendarEventMock).not.toHaveBeenCalled()
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})
