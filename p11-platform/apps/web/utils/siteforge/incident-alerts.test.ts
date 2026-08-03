import { afterEach, describe, expect, it, vi } from 'vitest'

const { createServiceClientMock, batchSendMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  batchSendMock: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('resend', () => ({
  Resend: class {
    batch = { send: batchSendMock }
  },
}))

import { sendSiteForgeIncidentAlert } from './incident-alerts'

describe('SiteForge incident alerts', () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalFrom = process.env.RESEND_FROM_EMAIL

  afterEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = originalKey
    process.env.RESEND_FROM_EMAIL = originalFrom
  })

  it('emails organization managers with an idempotency key', async () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.RESEND_FROM_EMAIL = 'P11 Alerts <alerts@hellop11.com>'
    const profilesQuery = {
      select: vi.fn(),
      in: vi.fn(),
    }
    profilesQuery.select.mockReturnValue(profilesQuery)
    profilesQuery.in
      .mockReturnValueOnce(profilesQuery)
      .mockResolvedValueOnce({
        data: [{ id: '11111111-1111-4111-8111-111111111111' }],
        error: null,
      })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(() => profilesQuery),
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { email: 'manager@example.com' } },
            error: null,
          }),
        },
      },
    })
    batchSendMock.mockResolvedValue({
      data: { data: [{ id: 'email-1' }] },
      error: null,
    })

    const result = await sendSiteForgeIncidentAlert({
      orgIds: ['22222222-2222-4222-8222-222222222222'],
      runId: '33333333-3333-4333-8333-333333333333',
      summary: {
        processed: 1,
        failed: 0,
        unhealthy: 1,
        degraded: 0,
        staleJobsRecovered: 0,
        restoreDrills: { failed: 0, awaitingOperator: 0 },
      },
    })

    expect(result.recipients).toBe(1)
    expect(batchSendMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          to: 'manager@example.com',
          subject: expect.stringContaining('SiteForge production incident'),
        }),
      ],
      {
        idempotencyKey:
          'siteforge-health/33333333-3333-4333-8333-333333333333',
      }
    )
  })
})
