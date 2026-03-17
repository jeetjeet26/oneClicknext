import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resendSendMock = vi.fn()
const resendCtorMock = vi.fn(function MockResend() {
  return {
    emails: {
      send: resendSendMock,
    },
  }
})
const fetchMock = vi.fn()

vi.mock('resend', () => ({
  Resend: resendCtorMock,
}))

describe('messaging service', () => {
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

  it('returns a clear error when sms provider env is missing', async () => {
    vi.stubEnv('TELNYX_API_KEY', '')
    vi.stubEnv('TELNYX_PHONE_NUMBER', '')
    const { sendSMS } = await import('./messaging')
    const result = await sendSMS('+15551112222', 'hello')

    expect(result).toEqual({
      success: false,
      error: 'SMS provider not configured (missing TELNYX_API_KEY or TELNYX_PHONE_NUMBER)',
      channel: 'sms',
    })
  })

  it('surfaces telnyx api errors from a json response body', async () => {
    vi.stubEnv('TELNYX_API_KEY', 'telnyx-key')
    vi.stubEnv('TELNYX_PHONE_NUMBER', '+15550000000')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          errors: [{ detail: 'Invalid destination number' }],
        })
      ),
    })

    const { sendSMS } = await import('./messaging')
    const result = await sendSMS('+15551112222', 'hello')

    expect(result).toEqual({
      success: false,
      error: 'Invalid destination number',
      channel: 'sms',
    })
  })

  it('returns a clear error when email provider env is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const { sendEmail } = await import('./messaging')
    const result = await sendEmail('lead@example.com', 'Hello', 'Body text')

    expect(result).toEqual({
      success: false,
      error: 'Email provider not configured (missing RESEND_API_KEY)',
      channel: 'email',
    })
  })

  it('sends email with html and attachments via resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'leasing@example.com')
    resendSendMock.mockResolvedValue({
      data: { id: 'email-1' },
      error: null,
    })

    const { sendEmail } = await import('./messaging')
    const result = await sendEmail(
      'lead@example.com',
      'Tour confirmed',
      'Plain body',
      undefined,
      '<p>Plain body</p>',
      [
        {
          filename: 'tour.ics',
          content: Buffer.from('BEGIN:VCALENDAR').toString('base64'),
          contentType: 'text/calendar',
        },
      ]
    )

    expect(result).toEqual({
      success: true,
      messageId: 'email-1',
      channel: 'email',
    })
    expect(resendCtorMock).toHaveBeenCalledWith('resend-key')
    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'leasing@example.com',
        to: 'lead@example.com',
        subject: 'Tour confirmed',
        text: 'Plain body',
        html: '<p>Plain body</p>',
        attachments: [
          expect.objectContaining({
            filename: 'tour.ics',
            content_type: 'text/calendar',
          }),
        ],
      })
    )
  })

  it('requires a subject when sending via the email channel', async () => {
    const { sendMessage } = await import('./messaging')
    const result = await sendMessage({
      to: 'lead@example.com',
      channel: 'email',
      body: 'Hello there',
    })

    expect(result).toEqual({
      success: false,
      error: 'Subject is required for email',
      channel: 'email',
    })
  })
})
