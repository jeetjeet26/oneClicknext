import { describe, expect, it, vi } from 'vitest'
import {
  P11ConversionAdapter,
  ingestPublicSiteForgeConversion,
  normalizedLeadSubmissionSchema,
  siteForgePublicConversionSchema,
} from './conversions'

const lead = {
  orgId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
  submissionId: 'form-session-1',
  firstName: 'Jordan',
  email: 'jordan@example.com',
  consent: true as const,
  consentText: 'I agree to receive leasing communications.',
  consentedAt: '2026-07-30T18:00:00.000Z',
  attribution: {
    source: 'siteforge',
    medium: 'website',
    campaign: 'summer-leasing',
    consent: { state: 'granted' as const },
  },
}

function insertionClient() {
  let inserted: unknown
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  builder.insert = vi.fn((value) => {
    inserted = value
    return builder
  })
  builder.single = vi.fn().mockResolvedValue({
    data: { id: '33333333-3333-4333-8333-333333333333' },
    error: null,
  })
  return {
    client: { from: vi.fn(() => builder) },
    inserted: () => inserted,
  }
}

describe('provider-neutral conversion adapters', () => {
  it('requires explicit consent before a lead can be submitted', () => {
    expect(
      normalizedLeadSubmissionSchema.safeParse({ ...lead, consent: false }).success
    ).toBe(false)
  })

  it('persists attribution and provider idempotency through the P11 adapter', async () => {
    const fake = insertionClient()
    const result = await new P11ConversionAdapter(
      fake.client as never
    ).submitLead(lead)

    expect(result).toEqual({
      leadId: '33333333-3333-4333-8333-333333333333',
      duplicate: false,
    })
    expect(fake.inserted()).toEqual(
      expect.objectContaining({
        provider: 'p11',
        provider_submission_id: 'form-session-1',
        consent: true,
        attribution: expect.objectContaining({ campaign: 'summer-leasing' }),
      })
    )
  })

  it('normalizes the exact WordPress form payload contract', () => {
    const parsed = siteForgePublicConversionSchema.parse({
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      phone: '555-555-0100',
      form_type: 'contact',
      submission_id: 'siteforge-form-123',
      consent: 'on',
      consent_text: 'I agree to receive leasing communications.',
      timestamp: '2026-07-31T12:00:00.000Z',
      page_url: 'https://property.example.com/contact/',
      message: 'Interested in a one-bedroom home.',
    })

    expect(parsed.consent).toBe(true)
    expect(parsed).not.toHaveProperty('orgId')
    expect(parsed).not.toHaveProperty('propertyId')
  })

  it('rejects public submissions without consent evidence or a contact method', () => {
    const invalidConsent = siteForgePublicConversionSchema.safeParse({
      name: 'Jordan Lee',
      form_type: 'contact',
      submission_id: 'siteforge-form-123',
      consent: false,
    })
    const missingEvidence = siteForgePublicConversionSchema.safeParse({
      name: 'Jordan Lee',
      form_type: 'contact',
      submission_id: 'siteforge-form-123',
      consent: true,
    })

    expect(invalidConsent.success).toBe(false)
    expect(missingEvidence.success).toBe(false)
    if (!missingEvidence.success) {
      expect(
        missingEvidence.error.issues.map((issue) => issue.path[0])
      ).toEqual(expect.arrayContaining(['consent_text', 'email']))
    }
  })

  it('uses server-resolved tenant scope and canonical lead side effects', async () => {
    const fake = insertionClient()
    const syncLead = vi.fn().mockResolvedValue({
      success: true,
      action: 'skipped',
    })
    const startLeadWorkflow = vi.fn().mockResolvedValue({ success: true })

    const result = await ingestPublicSiteForgeConversion(
      {
        websiteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        publicKey: 'sf_public_test',
        artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orgId: '11111111-1111-4111-8111-111111111111',
        propertyId: '22222222-2222-4222-8222-222222222222',
        propertyName: 'Aspen House',
        provider: 'p11',
        toursEnabled: false,
        allowedOrigins: ['https://property.example.com'],
      },
      {
        name: 'Jordan Lee',
        email: 'jordan@example.com',
        form_type: 'contact',
        submission_id: 'siteforge-form-123',
        consent: true,
        consent_text: 'I agree to receive leasing communications.',
        timestamp: '2026-07-31T12:00:00.000Z',
        page_url: 'https://property.example.com/contact/',
      },
      {
        client: fake.client as never,
        syncLead,
        startLeadWorkflow,
        trackEvent: vi.fn().mockResolvedValue(undefined),
        recordTelemetry: vi.fn().mockResolvedValue(undefined),
      }
    )

    expect(result.duplicate).toBe(false)
    expect(fake.inserted()).toEqual(
      expect.objectContaining({
        org_id: '11111111-1111-4111-8111-111111111111',
        property_id: '22222222-2222-4222-8222-222222222222',
        provider_submission_id: 'siteforge-form-123',
        first_name: 'Jordan',
        last_name: 'Lee',
      })
    )
    expect(syncLead).toHaveBeenCalledOnce()
    expect(startLeadWorkflow).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222',
      'lead_created'
    )
  })

  it('routes tour forms through the canonical booking service', async () => {
    const fake = insertionClient()
    const bookTour = vi.fn().mockResolvedValue({
      ok: true,
      duplicate: false,
      booking: {
        id: '55555555-5555-4555-8555-555555555555',
        scheduled_date: '2026-08-15',
        scheduled_time: '10:30',
        status: 'confirmed',
        duration_minutes: 30,
      },
      calendar: {},
      calendarEventId: null,
      message: 'Confirmed',
    })

    const result = await ingestPublicSiteForgeConversion(
      {
        websiteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        publicKey: 'sf_public_test',
        artifactId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orgId: '11111111-1111-4111-8111-111111111111',
        propertyId: '22222222-2222-4222-8222-222222222222',
        propertyName: 'Aspen House',
        provider: 'lumaleasing',
        toursEnabled: true,
        allowedOrigins: ['https://property.example.com'],
      },
      {
        name: 'Jordan Lee',
        email: 'jordan@example.com',
        form_type: 'tour',
        submission_id: 'siteforge-tour-123',
        consent: true,
        consent_text: 'I agree to receive leasing communications.',
        tour_date: '2026-08-15',
        tour_time: '10:30',
      },
      {
        client: fake.client as never,
        syncLead: vi.fn().mockResolvedValue({ success: true, action: 'skipped' }),
        startLeadWorkflow: vi.fn().mockResolvedValue({ success: true }),
        trackEvent: vi.fn().mockResolvedValue(undefined),
        recordTelemetry: vi.fn().mockResolvedValue(undefined),
        bookTour,
      }
    )

    expect(result.tour).toEqual(expect.objectContaining({ ok: true }))
    expect(bookTour).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: '22222222-2222-4222-8222-222222222222',
        bookingDate: '2026-08-15',
        bookingTime: '10:30',
        source: 'lumaleasing',
      })
    )
  })
})
