import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const getGmailConfigMock = vi.fn()
const sendEmailMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/gmail-service', () => ({
  getGmailConfig: getGmailConfigMock,
  sendEmail: sendEmailMock,
}))

describe('Gmail send route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthorized', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: null },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 before sending when the lead belongs to a different property', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'lead-1', property_id: 'property-2' },
                  error: null,
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        to: 'lead@example.com',
        subject: 'Follow up',
        bodyText: 'Hello there',
        leadId: 'lead-1',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'Lead does not belong to this property',
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('returns 400 when Gmail is not configured', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn(),
    })
    getGmailConfigMock.mockResolvedValue(null)

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        to: 'lead@example.com',
        subject: 'Follow up',
        bodyText: 'Hello there',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'Gmail not configured for this property',
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('sends email and stores schema-aligned thread/message records', async () => {
    const emailThreadsInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'email-thread-1' },
      error: null,
    })
    const emailMessagesInsert = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesInsert = vi.fn().mockResolvedValue({ error: null })

    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    getGmailConfigMock.mockResolvedValue({
      id: 'config-1',
      google_email: 'leasing@example.com',
      token_status: 'healthy',
    })
    sendEmailMock.mockResolvedValue({
      messageId: 'gmail-message-1',
      threadId: 'gmail-thread-1',
    })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'lead-1', property_id: 'property-1' },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'email-thread-1',
                            gmail_thread_id: 'gmail-thread-1',
                          },
                        ],
                        error: null,
                      }),
                    })),
                  })),
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                })),
              })),
            })),
            insert: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({
                email_configuration_id: 'config-1',
                property_id: 'property-1',
                lead_id: 'lead-1',
                gmail_thread_id: 'gmail-thread-1',
                status: 'awaiting_lead_reply',
                direction: 'outbound',
              })

              return {
                select: vi.fn(() => ({
                  single: emailThreadsInsertSingle,
                })),
              }
            }),
          }
        }

        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      order: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue({
                          data: [],
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: leadActivitiesInsert,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        to: 'lead@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        subject: 'Tour follow-up',
        bodyText: 'Thanks for touring with us.',
        leadId: 'lead-1',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'config-1',
        google_email: 'leasing@example.com',
      }),
      {
        to: ['lead@example.com'],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        subject: 'Tour follow-up',
        bodyText: 'Thanks for touring with us.',
        bodyHtml: undefined,
        replyToMessageId: undefined,
        threadId: undefined,
      }
    )
    expect(emailMessagesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email_thread_id: 'email-thread-1',
        gmail_message_id: 'gmail-message-1',
        from_email: 'leasing@example.com',
        to_emails: ['lead@example.com'],
        cc_emails: ['cc@example.com'],
        bcc_emails: ['bcc@example.com'],
        direction: 'outbound',
        subject: 'Tour follow-up',
      })
    )
    expect(leadActivitiesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-1',
        type: 'email_sent',
      })
    )
    expect(json).toEqual({
      success: true,
      messageId: 'gmail-message-1',
      threadId: 'gmail-thread-1',
    })
  })

  it('returns an existing recent outbound email instead of sending a duplicate retry', async () => {
    const emailMessagesSelectLimit = vi.fn().mockResolvedValue({
      data: [
        {
          gmail_message_id: 'gmail-message-existing',
          email_thread_id: 'email-thread-1',
          subject: 'Tour follow-up',
          body_text: 'Thanks for touring with us.',
          body_html: null,
          to_emails: ['lead@example.com'],
          internal_date: new Date().toISOString(),
        },
      ],
      error: null,
    })
    const emailMessagesInsert = vi.fn()
    const leadActivitiesInsert = vi.fn()

    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    getGmailConfigMock.mockResolvedValue({
      id: 'config-1',
      google_email: 'leasing@example.com',
      token_status: 'healthy',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'lead-1', property_id: 'property-1' },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'email-thread-1',
                            gmail_thread_id: 'gmail-thread-1',
                          },
                        ],
                        error: null,
                      }),
                    })),
                  })),
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'email-thread-1',
                      gmail_thread_id: 'gmail-thread-1',
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      order: vi.fn(() => ({
                        limit: emailMessagesSelectLimit,
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: leadActivitiesInsert,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        to: 'lead@example.com',
        subject: 'Tour follow-up',
        bodyText: 'Thanks for touring with us.',
        leadId: 'lead-1',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      duplicate: true,
      messageId: 'gmail-message-existing',
      threadId: 'gmail-thread-1',
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(emailMessagesInsert).not.toHaveBeenCalled()
    expect(leadActivitiesInsert).not.toHaveBeenCalled()
  })

  it('updates an existing thread to awaiting_lead_reply on outbound follow-up', async () => {
    const threadMaybeSingleMock = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'email-thread-1',
          gmail_thread_id: 'gmail-thread-1',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'email-thread-1',
          message_count: 4,
          direction: 'mixed',
          lead_id: null,
        },
        error: null,
      })
    const threadUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const emailMessagesInsert = vi.fn().mockResolvedValue({ error: null })

    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    getGmailConfigMock.mockResolvedValue({
      id: 'config-1',
      google_email: 'leasing@example.com',
      token_status: 'healthy',
    })
    sendEmailMock.mockResolvedValue({
      messageId: 'gmail-message-2',
      threadId: 'gmail-thread-1',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: threadMaybeSingleMock,
                })),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({
                message_count: 5,
                status: 'awaiting_lead_reply',
              })
              return {
                eq: threadUpdateEq,
              }
            }),
          }
        }

        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      order: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue({
                          data: [],
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn(),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        to: 'lead@example.com',
        subject: 'Following up',
        bodyText: 'Checking in on your availability.',
        threadId: 'gmail-thread-1',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(sendEmailMock).toHaveBeenCalled()
    expect(threadUpdateEq).toHaveBeenCalledWith('id', 'email-thread-1')
    expect(json).toEqual({
      success: true,
      messageId: 'gmail-message-2',
      threadId: 'gmail-thread-1',
    })
  })

  it('supports markThreadResolved to close a thread on outbound follow-up', async () => {
    const threadMaybeSingleMock = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: 'email-thread-1',
          gmail_thread_id: 'gmail-thread-1',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'email-thread-1',
          message_count: 4,
          direction: 'mixed',
          lead_id: null,
        },
        error: null,
      })
    const threadUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const emailMessagesInsert = vi.fn().mockResolvedValue({ error: null })

    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    getGmailConfigMock.mockResolvedValue({
      id: 'config-1',
      google_email: 'leasing@example.com',
      token_status: 'healthy',
    })
    sendEmailMock.mockResolvedValue({
      messageId: 'gmail-message-3',
      threadId: 'gmail-thread-1',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: threadMaybeSingleMock,
                })),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({
                message_count: 5,
                status: 'resolved',
              })
              return {
                eq: threadUpdateEq,
              }
            }),
          }
        }

        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      order: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue({
                          data: [],
                          error: null,
                        }),
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn(),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        to: 'lead@example.com',
        subject: 'Closing the loop',
        bodyText: 'We are all set on our end.',
        threadId: 'gmail-thread-1',
        markThreadResolved: true,
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(sendEmailMock).toHaveBeenCalled()
    expect(threadUpdateEq).toHaveBeenCalledWith('id', 'email-thread-1')
    expect(json).toEqual({
      success: true,
      messageId: 'gmail-message-3',
      threadId: 'gmail-thread-1',
    })
  })

  it('can mark duplicate-send thread as resolved without re-sending', async () => {
    const emailMessagesSelectLimit = vi.fn().mockResolvedValue({
      data: [
        {
          gmail_message_id: 'gmail-message-existing',
          email_thread_id: 'email-thread-1',
          subject: 'Final response',
          body_text: 'All set, thanks!',
          body_html: null,
          to_emails: ['lead@example.com'],
          internal_date: new Date().toISOString(),
        },
      ],
      error: null,
    })
    const updateEqGmailThreadId = vi.fn().mockResolvedValue({ error: null })
    const updateEqEmailConfig = vi.fn().mockReturnValue({
      eq: updateEqGmailThreadId,
    })
    const emailMessagesInsert = vi.fn()

    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    })
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    validatePropertyAccessMock.mockResolvedValue({
      authorized: true,
      orgId: 'org-1',
    })
    getGmailConfigMock.mockResolvedValue({
      id: 'config-1',
      google_email: 'leasing@example.com',
      token_status: 'healthy',
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'email-thread-1',
                      gmail_thread_id: 'gmail-thread-1',
                    },
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toEqual({ status: 'resolved' })
              return {
                eq: updateEqEmailConfig,
              }
            }),
          }
        }

        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      order: vi.fn(() => ({
                        limit: emailMessagesSelectLimit,
                      })),
                    })),
                  })),
                })),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'lead_activities') {
          return {
            insert: vi.fn(),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/email/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        propertyId: 'property-1',
        to: 'lead@example.com',
        subject: 'Final response',
        bodyText: 'All set, thanks!',
        threadId: 'gmail-thread-1',
        markThreadResolved: true,
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      success: true,
      duplicate: true,
      messageId: 'gmail-message-existing',
      threadId: 'gmail-thread-1',
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(emailMessagesInsert).not.toHaveBeenCalled()
    expect(updateEqEmailConfig).toHaveBeenCalledWith('email_configuration_id', 'config-1')
    expect(updateEqGmailThreadId).toHaveBeenCalledWith('gmail_thread_id', 'gmail-thread-1')
  })
})
