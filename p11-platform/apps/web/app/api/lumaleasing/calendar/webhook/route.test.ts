import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const ingestExternalCalendarMutationsForPropertyMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/lumaleasing-calendar-mutations', () => ({
  ingestExternalCalendarMutationsForProperty: ingestExternalCalendarMutationsForPropertyMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as NextRequest
}

describe('calendar webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('acknowledges requests with missing Google watch headers', async () => {
    const { POST } = await import('./route')
    const response = await POST(makeNextRequest('http://localhost/api/lumaleasing/calendar/webhook', {
      method: 'POST',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(ingestExternalCalendarMutationsForPropertyMock).not.toHaveBeenCalled()
  })

  it('acknowledges initial sync notifications without ingesting', async () => {
    const calendarUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const calendarUpdateMock = vi.fn().mockReturnValue({ eq: calendarUpdateEqMock })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'agent_calendars') {
          throw new Error(`Unexpected table ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'calendar-1',
                    property_id: 'property-1',
                    sync_enabled: true,
                    token_status: 'healthy',
                    watch_last_message_number: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: calendarUpdateMock,
        }
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/lumaleasing/calendar/webhook', {
        method: 'POST',
        headers: {
          'x-goog-channel-id': 'channel-1',
          'x-goog-resource-id': 'resource-1',
          'x-goog-resource-state': 'sync',
          'x-goog-message-number': '10',
          'x-goog-channel-expiration': 'Wed, 25 Mar 2026 10:00:00 GMT',
        },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(calendarUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        watch_expiration: expect.stringContaining('2026-03-25T10:00:00'),
        watch_last_message_number: 10,
      })
    )
    expect(calendarUpdateEqMock).toHaveBeenCalledWith('id', 'calendar-1')
    expect(ingestExternalCalendarMutationsForPropertyMock).not.toHaveBeenCalled()
  })

  it('runs targeted mutation ingest for change notifications', async () => {
    const calendarUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const calendarUpdateMock = vi.fn().mockReturnValue({ eq: calendarUpdateEqMock })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'agent_calendars') {
          throw new Error(`Unexpected table ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'calendar-1',
                    property_id: 'property-1',
                    sync_enabled: true,
                    token_status: 'healthy',
                    watch_last_message_number: 10,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: calendarUpdateMock,
        }
      }),
    })
    ingestExternalCalendarMutationsForPropertyMock.mockResolvedValue({
      propertyId: 'property-1',
      checked: 2,
      healthy: 1,
      drifted: 1,
      missing: 0,
      cancelled: 0,
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/lumaleasing/calendar/webhook', {
        method: 'POST',
        headers: {
          'x-goog-channel-id': 'channel-1',
          'x-goog-resource-id': 'resource-1',
          'x-goog-resource-state': 'exists',
          'x-goog-message-number': '11',
          'x-goog-channel-expiration': 'Wed, 25 Mar 2026 10:00:00 GMT',
        },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      propertyId: 'property-1',
      checked: 2,
      drifted: 1,
    })
    expect(calendarUpdateEqMock).toHaveBeenCalledWith('id', 'calendar-1')
    expect(ingestExternalCalendarMutationsForPropertyMock).toHaveBeenCalledWith('property-1')
  })

  it('skips stale duplicate message numbers', async () => {
    const calendarUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const calendarUpdateMock = vi.fn().mockReturnValue({ eq: calendarUpdateEqMock })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'agent_calendars') {
          throw new Error(`Unexpected table ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'calendar-1',
                    property_id: 'property-1',
                    sync_enabled: true,
                    token_status: 'healthy',
                    watch_last_message_number: 11,
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: calendarUpdateMock,
        }
      }),
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/lumaleasing/calendar/webhook', {
        method: 'POST',
        headers: {
          'x-goog-channel-id': 'channel-1',
          'x-goog-resource-id': 'resource-1',
          'x-goog-resource-state': 'exists',
          'x-goog-message-number': '11',
        },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(calendarUpdateEqMock).not.toHaveBeenCalled()
    expect(ingestExternalCalendarMutationsForPropertyMock).not.toHaveBeenCalled()
  })
})
