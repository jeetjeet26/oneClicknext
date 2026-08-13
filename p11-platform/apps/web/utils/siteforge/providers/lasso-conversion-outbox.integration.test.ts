import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEvent } from '@/utils/siteforge/operations/outbox'
import type { EnqueueSiteForgeEvent } from '@/utils/siteforge/operations/outbox'

const { syncLeadToCRMMock } = vi.hoisted(() => ({
  syncLeadToCRMMock: vi.fn(),
}))

vi.mock('@/utils/services/crm-sync', () => ({
  syncLeadToCRM: syncLeadToCRMMock,
}))

import { createSiteForgeHandlerRegistry } from '@/utils/siteforge/operations/handlers'
import { ingestPublicSiteForgeConversion } from './conversions'

function conversionClient() {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.ilike = vi.fn(() => builder)
  builder.limit = vi.fn().mockResolvedValue({ data: [], error: null })
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  builder.insert = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue({
    data: { id: '33333333-3333-4333-8333-333333333333' },
    error: null,
  })
  return { from: vi.fn(() => builder) }
}

describe('SiteForge conversion to existing Lasso outbox path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncLeadToCRMMock.mockResolvedValue({
      success: true,
      action: 'created',
      externalId: 'lasso-registrant-123',
    })
  })

  it('deterministically carries normalized conversion data into CRM sync', async () => {
    const enqueued: EnqueueSiteForgeEvent[] = []
    const client = conversionClient()
    await ingestPublicSiteForgeConversion(
      {
        websiteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        publicKey: 'sf_public_test',
        artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orgId: '11111111-1111-4111-8111-111111111111',
        propertyId: '22222222-2222-4222-8222-222222222222',
        propertyName: 'Acacia',
        provider: 'p11',
        toursEnabled: false,
        allowedOrigins: ['https://aurora.siteforge.example'],
      },
      {
        name: 'Jordan Lee',
        email: 'jordan@example.com',
        phone: '555-555-0100',
        form_type: 'contact',
        submission_id: 'acacia-lasso-form-123',
        consent: true,
        consent_text: 'I agree to receive leasing communications.',
        page_url: 'https://aurora.siteforge.example/contact',
      },
      {
        client: client as never,
        enqueueOutbox: vi.fn(async (_client, event) => {
          enqueued.push(event)
          return { id: `event-${enqueued.length}` } as OutboxEvent
        }),
        recordTelemetry: vi.fn().mockResolvedValue(undefined),
      }
    )

    const crmEvent = enqueued.find(event => event.eventType === 'crm.lead_sync')
    expect(crmEvent).toEqual(
      expect.objectContaining({
        idempotencyKey: 'acacia-lasso-form-123:crm',
        payload: expect.objectContaining({
          propertyId: '22222222-2222-4222-8222-222222222222',
          leadId: '33333333-3333-4333-8333-333333333333',
          lead: expect.objectContaining({
            first_name: 'Jordan',
            last_name: 'Lee',
            email: 'jordan@example.com',
            source: 'SiteForge Website',
          }),
        }),
      })
    )

    const event = {
      id: 'event-1',
      event_type: crmEvent!.eventType,
      handler_version: 'v1',
      idempotency_key: crmEvent!.idempotencyKey,
      payload: crmEvent!.payload,
    } as OutboxEvent
    const handler = createSiteForgeHandlerRegistry().resolve(event)
    await handler!(event, {
      idempotencyKey: event.idempotency_key,
      attempt: 1,
    })

    expect(syncLeadToCRMMock).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({
        email: 'jordan@example.com',
        phone: '555-555-0100',
        source: 'SiteForge Website',
      })
    )
  })
})
