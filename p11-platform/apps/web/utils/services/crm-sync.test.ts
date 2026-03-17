import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

function buildSupabaseMock(options?: {
  integration?: Record<string, unknown> | null
  updateError?: unknown
  queuedLeads?: Array<Record<string, unknown>>
  claimLeaseFailures?: Record<string, string>
}) {
  const leadUpdatePayloads: Array<Record<string, unknown>> = []

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'integration_credentials') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: options?.integration ?? null,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
        }
      }

      if (table === 'leads') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              or: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: options?.queuedLeads ?? [],
                  error: null,
                }),
              })),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => {
            leadUpdatePayloads.push(payload)
            const chain = {
              eq: vi.fn(() => chain),
              or: vi.fn(() => chain),
              select: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: options?.claimLeaseFailures
                    ? null
                    : { id: 'claimed' },
                  error: options?.updateError ?? null,
                }),
              })),
            }
            return chain
          }),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    }),
  }

  return { supabase, leadUpdatePayloads }
}

describe('crm sync service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('marks the lead as skipped when no CRM integration is configured', async () => {
    const mock = buildSupabaseMock({ integration: null })
    createServiceClientMock.mockReturnValue(mock.supabase)

    const { syncLeadToCRM } = await import('./crm-sync')
    const result = await syncLeadToCRM('property-1', 'lead-1', {
      email: 'jane@example.com',
    })

    expect(result).toEqual({
      success: true,
      action: 'skipped',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mock.leadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        external_crm_id: null,
        crm_sync_status: 'skipped',
        crm_sync_error: null,
      })
    )
  })

  it('schedules a retry when CRM search fails with a retryable provider error', async () => {
    const mock = buildSupabaseMock({
      integration: {
        platform: 'hubspot',
        credentials: { token: 'secret' },
        field_mapping: { email: 'email' },
        mapping_validated: true,
      },
    })
    createServiceClientMock.mockReturnValue(mock.supabase)
    vi.stubEnv('DATA_ENGINE_API_KEY', 'engine-key')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: vi.fn().mockResolvedValue('crm search unavailable'),
    })

    const { syncLeadToCRM } = await import('./crm-sync')
    const result = await syncLeadToCRM('property-1', 'lead-1', {
      email: 'jane@example.com',
    })

    expect(result).toEqual({
      success: false,
      action: 'retry_scheduled',
      error: 'crm search unavailable',
      retryAt: expect.any(String),
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mock.leadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        crm_sync_status: 'retrying',
        crm_sync_error: 'crm search unavailable',
        crm_sync_retry_count: 1,
        crm_sync_next_retry_at: expect.any(String),
      })
    )
  })

  it('links a lead when CRM search finds an existing record', async () => {
    const mock = buildSupabaseMock({
      integration: {
        platform: 'hubspot',
        credentials: { token: 'secret' },
        field_mapping: { email: 'email' },
        mapping_validated: true,
      },
    })
    createServiceClientMock.mockReturnValue(mock.supabase)
    vi.stubEnv('DATA_ENGINE_API_KEY', 'engine-key')
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        found: true,
        external_id: 'crm-123',
        match_type: 'email',
      }),
    })

    const { syncLeadToCRM } = await import('./crm-sync')
    const result = await syncLeadToCRM('property-1', 'lead-1', {
      email: 'jane@example.com',
    })

    expect(result).toEqual({
      success: true,
      action: 'linked',
      externalId: 'crm-123',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mock.leadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        external_crm_id: 'crm-123',
        crm_sync_status: 'linked',
      })
    )
  })

  it('creates a new CRM lead when search does not find one', async () => {
    const mock = buildSupabaseMock({
      integration: {
        platform: 'hubspot',
        credentials: { token: 'secret' },
        field_mapping: { email: 'email' },
        mapping_validated: true,
      },
    })
    createServiceClientMock.mockReturnValue(mock.supabase)
    vi.stubEnv('DATA_ENGINE_API_KEY', 'engine-key')
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          found: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          action: 'created',
          external_id: 'crm-456',
        }),
      })

    const { syncLeadToCRM } = await import('./crm-sync')
    const result = await syncLeadToCRM('property-1', 'lead-1', {
      email: 'jane@example.com',
      first_name: 'Jane',
    })

    expect(result).toEqual({
      success: true,
      action: 'created',
      externalId: 'crm-456',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mock.leadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        external_crm_id: 'crm-456',
        crm_sync_status: 'created',
      })
    )
  })

  it('dead-letters the lead when CRM push fails with a non-retryable provider error', async () => {
    const mock = buildSupabaseMock({
      integration: {
        platform: 'hubspot',
        credentials: { token: 'secret' },
        field_mapping: { email: 'email' },
        mapping_validated: true,
      },
    })
    createServiceClientMock.mockReturnValue(mock.supabase)
    vi.stubEnv('DATA_ENGINE_API_KEY', 'engine-key')
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          found: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue('invalid CRM mapping'),
      })

    const { syncLeadToCRM } = await import('./crm-sync')
    const result = await syncLeadToCRM('property-1', 'lead-1', {
      email: 'jane@example.com',
    })

    expect(result).toEqual({
      success: false,
      action: 'dead_lettered',
      error: 'invalid CRM mapping',
    })
    expect(mock.leadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        crm_sync_status: 'dead_lettered',
        crm_sync_error: 'invalid CRM mapping',
        crm_sync_retry_count: 1,
        crm_sync_next_retry_at: null,
        crm_dead_lettered_at: expect.any(String),
      })
    )
  })

  it('processes due CRM retry rows and summarizes scheduled retries', async () => {
    const mock = buildSupabaseMock({
      integration: {
        platform: 'hubspot',
        credentials: { token: 'secret' },
        field_mapping: { email: 'email' },
        mapping_validated: true,
      },
      queuedLeads: [
        {
          id: 'lead-1',
          property_id: 'property-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: null,
          source: 'manual',
          status: 'new',
          move_in_date: null,
          bedrooms: 2,
          notes: null,
          crm_sync_status: 'retrying',
          crm_sync_retry_count: 1,
        },
      ],
    })
    createServiceClientMock.mockReturnValue(mock.supabase)
    vi.stubEnv('DATA_ENGINE_API_KEY', 'engine-key')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('crm provider temporarily unavailable'),
    })

    const { processPendingCRMSyncs } = await import('./crm-sync')
    const result = await processPendingCRMSyncs()

    expect(result).toEqual({
      processed: 1,
      succeeded: 0,
      scheduledRetries: 1,
      deadLettered: 0,
      skipped: 0,
      failed: 0,
      errors: ['Lead lead-1: crm provider temporarily unavailable'],
    })
    expect(mock.leadUpdatePayloads).toContainEqual(
      expect.objectContaining({
        crm_sync_status: 'retrying',
        crm_sync_retry_count: 2,
        crm_sync_next_retry_at: expect.any(String),
      })
    )
  })

  it('skips rows not claimed by this worker to prevent duplicate retry processing', async () => {
    const mock = buildSupabaseMock({
      integration: {
        platform: 'hubspot',
        credentials: { token: 'secret' },
        field_mapping: { email: 'email' },
        mapping_validated: true,
      },
      claimLeaseFailures: { 'lead-1': 'already claimed' },
      queuedLeads: [
        {
          id: 'lead-1',
          property_id: 'property-1',
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: null,
          source: 'manual',
          status: 'new',
          move_in_date: null,
          bedrooms: 2,
          notes: null,
          crm_sync_status: 'retrying',
          crm_sync_retry_count: 1,
          crm_sync_next_retry_at: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    })
    createServiceClientMock.mockReturnValue(mock.supabase)
    vi.stubEnv('DATA_ENGINE_API_KEY', 'engine-key')

    const { processPendingCRMSyncs } = await import('./crm-sync')
    const result = await processPendingCRMSyncs()

    expect(result).toEqual({
      processed: 0,
      succeeded: 0,
      scheduledRetries: 0,
      deadLettered: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
