vi.mock('@/utils/services/tour-scheduling',async original=>({...await original<object>(),getTourScheduleHistory:vi.fn().mockResolvedValue(new Map())}))
vi.mock('@/utils/services/tour-noshow',()=>({getNoShowReview:vi.fn().mockResolvedValue(new Map())}))
vi.mock('@/utils/services/console-tour-booking',async original=>({...await original<object>(),getTourCalendarSchedules:vi.fn().mockResolvedValue(new Map([['tours/tour-1',{startsAt:'2099-03-25T17:00:00Z',durationMinutes:30,issue:null}],['tour_bookings/booking-1',{startsAt:'2099-03-25T17:00:00Z',durationMinutes:30,issue:null}]])),getBookingContext:vi.fn().mockResolvedValue({timezone:'UTC',today:'2026-09-16',lastDate:'2026-12-15'})}))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const generateCalendarLinksMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const updateCalendarEventMock = vi.fn()
const cancelCalendarEventMock = vi.fn()

vi.mock('@/utils/services/tour-outcomes', async original => ({...await original<object>(), getTourOutcomeHistory: vi.fn().mockResolvedValue([])}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/calendar-invite', () => ({
  generateTourICS: vi.fn(),
  getICSAttachment: vi.fn(),
  generateCalendarLinks: generateCalendarLinksMock,
}))

vi.mock('@/utils/services/messaging', () => ({
  sendEmail: vi.fn(),
  sendMessage: vi.fn(),
}))

vi.mock('@/utils/services/tour-email-generator', () => ({
  generateTourEmail: vi.fn(),
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: getCalendarConfigMock,
  updateCalendarEvent: updateCalendarEventMock,
  cancelCalendarEvent: cancelCalendarEventMock,
}))

describe('Lead tours route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: {
        getUser: authGetUserMock,
      },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    generateCalendarLinksMock.mockReturnValue({
      google: 'google-link',
      outlook: 'outlook-link',
      office365: 'office-link',
      yahoo: 'yahoo-link',
      icsDownload: 'ics-link',
    })
    getCalendarConfigMock.mockResolvedValue(null)
    updateCalendarEventMock.mockResolvedValue({ eventId: 'event-1', htmlLink: 'link' })
    cancelCalendarEventMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized on GET', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error('unauthorized'),
    })

    const { GET } = await import('./route')

    const request = new Request('http://localhost/api/leads/lead-1/tours', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request, {
      params: Promise.resolve({ id: 'lead-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns merged tours and bookings with calendar links', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tours') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'tour-1',
                        lead_id: 'lead-1',
                        property_id: 'property-1',
                        tour_date: '2026-03-25',
                        tour_time: '10:00',
                        tour_type: 'in_person',
                        status: 'scheduled',
                        notes: 'legacy tour',
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'booking-1',
                        lead_id: 'lead-1',
                        property_id: 'property-1',
                        scheduled_date: '2026-03-26',
                        scheduled_time: '11:00',
                        status: 'confirmed',
                        special_requests: 'show gym',
                        created_at: '2026-03-10T00:00:00.000Z',
                        updated_at: '2026-03-10T00:00:00.000Z',
                        duration_minutes: 30,
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'lead-1',
                    first_name: 'Jane',
                    last_name: 'Doe',
                    email: 'jane@example.com',
                    phone: '5551112222',
                    property_id: 'property-1',
                    property: {
                      id: 'property-1',
                      name: 'The Beacon',
                      address: { street: '123 Main St' },
                    },
                  },
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/tours', {
      method: 'GET',
    }) as NextRequest

    const response = await GET(request, {
      params: Promise.resolve({ id: 'lead-1' }),
    })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.tours).toHaveLength(2)
    expect(json.tours[0].calendar.google).toBe('google-link')
    expect(json.tours[1].calendar.google).toBe('google-link')
  })

  it('creates a tour through the recorded booking transaction',async()=>{
    authGetUserMock.mockResolvedValue({data:{user:{id:'operator'}},error:null})
    const rpc=vi.fn().mockResolvedValue({data:{state:'applied',tour:{id:'tour-1'},actionEventId:'request',confirmation:'not_requested'}})
    const q={select:()=>q,eq:()=>q,single:async()=>({data:{property_id:'property-1'}})}
    createServiceClientMock.mockReturnValue({from:()=>q,rpc})
    const {POST}=await import('./route')
    const response=await POST(new Request('http://localhost/api/leads/lead-1/tours',{method:'POST',body:JSON.stringify({tourDate:'2099-03-25',tourTime:'10:00',sendConfirmation:false,requestId:'11111111-1111-4111-8111-111111111111'})}) as NextRequest,{params:Promise.resolve({id:'lead-1'})})
    expect(response.status).toBe(201);expect((await response.json()).tour.id).toBe('tour-1')
    expect(rpc).toHaveBeenCalledWith('book_recorded_console_tour',expect.objectContaining({p_actor_id:'operator',p_property_id:'property-1',p_lead_id:'lead-1'}))
  })

  it('rejects an unversioned legacy update before changing a booking', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi
                  .fn()
                  .mockResolvedValueOnce({
                    data: { property_id: 'property-1' },
                    error: null,
                  })
                  .mockResolvedValueOnce({
                    data: {
                      id: 'lead-1',
                      first_name: 'Jane',
                      last_name: 'Doe',
                      email: 'jane@example.com',
                      property: {
                        id: 'property-1',
                        name: 'The Beacon',
                        address: { street: '123 Main St' },
                      },
                    },
                    error: null,
                  }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        if (table === 'tours') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'booking-1',
                        property_id: 'property-1',
                        lead_id: 'lead-1',
                        scheduled_date: '2099-03-25',
                        scheduled_time: '10:00:00',
                        special_requests: 'updated note',
                        status: 'confirmed',
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { PATCH } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/tours', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tourId: 'booking-1',
        notes: 'updated note',
      }),
    }) as NextRequest

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'lead-1' }),
    })
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('current version')
    expect(updateCalendarEventMock).not.toHaveBeenCalled()
  })

  it('rejects cancellation without request identity and current version', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    const leadsUpdateEq = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { property_id: 'property-1' },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: leadsUpdateEq,
            })),
          }
        }

        if (table === 'tours') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'tour_bookings') {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'booking-1',
                        property_id: 'property-1',
                        lead_id: 'lead-1',
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  data: [],
                  error: null,
                })),
              })),
            })),
          }
        }

        if (table === 'calendar_events') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { DELETE } = await import('./route')
    const request = new Request('http://localhost/api/leads/lead-1/tours?tourId=booking-1', {
      method: 'DELETE',
    }) as NextRequest

    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'lead-1' }),
    })
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('current version')
    expect(cancelCalendarEventMock).not.toHaveBeenCalled()
  })
})
