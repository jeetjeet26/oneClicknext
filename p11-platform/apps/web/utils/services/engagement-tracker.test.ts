import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

describe('engagement tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not attempt rescoring when event insert fails', async () => {
    const rpcMock = vi.fn()
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({
          error: { message: 'insert failed' },
        }),
      })),
      rpc: rpcMock,
    })

    const { trackEngagementEvent } = await import('./engagement-tracker')
    await trackEngagementEvent({
      leadId: 'lead-1',
      propertyId: 'property-1',
      eventType: 'tour_scheduled',
    })

    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rescales the lead after a successful event insert', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => ({
        insert: insertMock,
      })),
      rpc: rpcMock,
    })

    const { trackEngagementEvent } = await import('./engagement-tracker')
    await trackEngagementEvent({
      leadId: 'lead-1',
      propertyId: 'property-1',
      eventType: 'tour_scheduled',
      metadata: { source: 'widget' },
    })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-1',
        property_id: 'property-1',
        event_type: 'tour_scheduled',
      })
    )
    expect(rpcMock).toHaveBeenCalledWith('score_lead', {
      p_lead_id: 'lead-1',
    })
  })
})
