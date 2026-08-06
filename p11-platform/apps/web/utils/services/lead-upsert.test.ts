import { describe, expect, it, vi } from 'vitest'
import { upsertLeadByContact } from './lead-upsert'

describe('upsertLeadByContact', () => {
  it('updates repeat intent, appends notes, and records one activity', async () => {
    const updatePayload = vi.fn()
    const activityInsert = vi.fn().mockResolvedValue({ error: null })
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                ilike: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: 'lead-existing', notes: 'Original inquiry' }],
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              updatePayload(payload)
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    select: vi.fn(() => ({
                      single: vi.fn().mockResolvedValue({
                        data: {
                          id: 'lead-existing',
                          property_id: 'property-1',
                          status: 'contacted',
                          notes: payload.notes,
                        },
                        error: null,
                      }),
                    })),
                  })),
                })),
              }
            }),
          }
        }

        if (table === 'lead_activities') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null,
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
            insert: activityInsert,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await upsertLeadByContact({
      client: client as never,
      propertyId: 'property-1',
      email: 'JANE@example.com',
      create: {
        email: 'JANE@example.com',
        source: 'SiteForge Website',
        status: 'new',
      },
      update: {
        move_in_date: '2026-10-01',
        bedrooms: '2',
        notes: 'Ready to book another tour',
      },
      repeatActivity: {
        description: 'Returned via SiteForge Website: Ready to book another tour',
        metadata: { submissionId: 'submission-2' },
      },
    })

    expect(result).toMatchObject({
      leadId: 'lead-existing',
      isExisting: true,
      matchedBy: 'email',
    })
    expect(updatePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        move_in_date: '2026-10-01',
        bedrooms: '2',
        notes: 'Original inquiry\n\nReady to book another tour',
        updated_at: expect.any(String),
      })
    )
    expect(activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-existing',
        description: 'Returned via SiteForge Website: Ready to book another tour',
      })
    )
  })

  it('creates a new lead without logging repeat activity', async () => {
    const activityInsert = vi.fn()
    const leadInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'lead-new',
            property_id: 'property-1',
            email: null,
            phone: '5551112222',
            status: 'new',
          },
          error: null,
        }),
      })),
    }))
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                })),
              })),
            })),
            insert: leadInsert,
          }
        }
        if (table === 'lead_activities') {
          return { insert: activityInsert }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    }

    const result = await upsertLeadByContact({
      client: client as never,
      propertyId: 'property-1',
      phone: '5551112222',
      create: {
        phone: '5551112222',
        source: 'manual',
        status: 'new',
      },
      update: { phone: '5551112222' },
      repeatActivity: {
        description: 'Returned via manual',
      },
    })

    expect(result).toMatchObject({
      leadId: 'lead-new',
      isExisting: false,
      matchedBy: null,
    })
    expect(leadInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: 'property-1',
        phone: '5551112222',
      })
    )
    expect(activityInsert).not.toHaveBeenCalled()
  })
})
