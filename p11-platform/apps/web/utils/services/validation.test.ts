import { describe, expect, it } from 'vitest'
import {
  chatRequestSchema,
  leadCaptureSchema,
  tourBookingSchema,
  validateBody,
} from './validation'

describe('tourBookingSchema', () => {
  const baseBooking = {
    slotId: null,
    tourDate: '2026-08-01',
    tourTime: '10:00',
    leadInfo: {
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
    },
    sessionId: null,
    conversationId: null,
  }

  it('accepts an empty phone string from the widget booking form', () => {
    const result = validateBody(
      { ...baseBooking, leadInfo: { ...baseBooking.leadInfo, phone: '' } },
      tourBookingSchema
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.leadInfo.phone).toBe('')
    }
  })

  it.each([
    '555-123-4567',
    '555.123.4567',
    '(555) 123-4567',
    '5551234567',
    '+1 555 123 4567',
  ])('accepts common phone format %s', (phone) => {
    const result = validateBody(
      { ...baseBooking, leadInfo: { ...baseBooking.leadInfo, phone } },
      tourBookingSchema
    )

    expect(result.success).toBe(true)
  })

  it('rejects a malformed phone number', () => {
    const result = validateBody(
      { ...baseBooking, leadInfo: { ...baseBooking.leadInfo, phone: 'not-a-phone' } },
      tourBookingSchema
    )

    expect(result.success).toBe(false)
  })
})

describe('leadCaptureSchema', () => {
  it('accepts an empty phone string when an email is provided', () => {
    const result = validateBody(
      {
        leadInfo: {
          first_name: 'Jane',
          email: 'jane@example.com',
          phone: '',
        },
      },
      leadCaptureSchema
    )

    expect(result.success).toBe(true)
  })

  it('still requires email or phone', () => {
    const result = validateBody(
      { leadInfo: { first_name: 'Jane', phone: '' } },
      leadCaptureSchema
    )

    expect(result.success).toBe(false)
  })
})

describe('chatRequestSchema', () => {
  it('accepts captured lead info with an empty phone string', () => {
    const result = validateBody(
      {
        messages: [{ role: 'user', content: 'Hi' }],
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone: '',
        },
      },
      chatRequestSchema
    )

    expect(result.success).toBe(true)
  })

  it('drops an invalid extracted email instead of failing the chat request', () => {
    const result = validateBody(
      {
        messages: [{ role: 'user', content: 'my email is billy@bob' }],
        leadInfo: {
          first_name: 'Billy',
          email: 'billy@bob',
        },
      },
      chatRequestSchema
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.leadInfo?.email).toBeNull()
      expect(result.data.leadInfo?.first_name).toBe('Billy')
    }
  })

  it('drops an invalid extracted phone instead of failing the chat request', () => {
    const result = validateBody(
      {
        messages: [{ role: 'user', content: 'call me' }],
        leadInfo: {
          email: 'jane@example.com',
          phone: 'not-a-phone!!!',
        },
      },
      chatRequestSchema
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.leadInfo?.phone).toBeNull()
      expect(result.data.leadInfo?.email).toBe('jane@example.com')
    }
  })

  it('drops a malformed leadInfo payload entirely instead of failing the chat request', () => {
    const result = validateBody(
      {
        messages: [{ role: 'user', content: 'Hi' }],
        leadInfo: 'garbage',
      },
      chatRequestSchema
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.leadInfo).toBeNull()
    }
  })
})
