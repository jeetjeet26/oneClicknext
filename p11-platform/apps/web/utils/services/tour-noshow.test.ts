import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const sendMessageMock = vi.fn()
const startWorkflowMock = vi.fn()
const trackEngagementEventMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('./messaging', () => ({
  sendMessage: sendMessageMock,
}))

vi.mock('./workflow-processor', () => ({
  startWorkflow: startWorkflowMock,
}))

vi.mock('./engagement-tracker', () => ({
  trackEngagementEvent: trackEngagementEventMock,
}))

describe('tour no-show service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    sendMessageMock.mockResolvedValue({
      success: true,
      messageId: 'provider-message-1',
      channel: 'sms',
    })
    startWorkflowMock.mockResolvedValue({
      success: true,
      workflowId: 'workflow-1',
    })
    trackEngagementEventMock.mockReturnValue(Promise.resolve())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks past scheduled tours as no-show and sends follow-up once', async () => {
    const toursUpdatePayloads: Array<Record<string, unknown>> = []
    const leadsUpdatePayloads: Array<Record<string, unknown>> = []

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'tours') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'tour-1',
                      lead_id: 'lead-1',
                      property_id: 'property-1',
                      tour_date: '2020-01-01',
                      tour_time: '10:00:00',
                      tour_type: 'in_person',
                      status: 'scheduled',
                      noshow_followup_sent_at: null,
                      leads: {
                        id: 'lead-1',
                        first_name: 'Jane',
                        last_name: 'Doe',
                        email: 'jane@example.com',
                        phone: '5551112222',
                        status: 'contacted',
                      },
                      properties: {
                        id: 'property-1',
                        name: 'The Beacon',
                        address: { street: '123 Main St' },
                      },
                    },
                  ],
                  error: null,
                }),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              toursUpdatePayloads.push(payload)
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }

        if (table === 'leads') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => {
              leadsUpdatePayloads.push(payload)
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { processTourNoShows } = await import('./tour-noshow')
    const result = await processTourNoShows()

    expect(result.processed).toBe(1)
    expect(result.markedNoShow).toBe(1)
    expect(result.followupsSent).toBe(1)
    expect(result.failed).toBe(0)
    expect(sendMessageMock).toHaveBeenCalledTimes(2)
    expect(startWorkflowMock).toHaveBeenCalledWith('lead-1', 'property-1', 'tour_no_show')
    expect(trackEngagementEventMock).toHaveBeenCalledWith({
      leadId: 'lead-1',
      propertyId: 'property-1',
      eventType: 'tour_no_show',
      metadata: { tour_id: 'tour-1' },
    })
    expect(toursUpdatePayloads).toContainEqual(
      expect.objectContaining({
        status: 'no_show',
      })
    )
    expect(toursUpdatePayloads).toContainEqual(
      expect.objectContaining({
        noshow_followup_sent_at: expect.any(String),
      })
    )
    expect(leadsUpdatePayloads).toContainEqual(
      expect.objectContaining({
        status: 'contacted',
      })
    )
  })
})
