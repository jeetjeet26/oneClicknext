import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

describe('gmail service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('syncInbox stores inbound messages with the current email schema', async () => {
    const emailThreadsInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'email-thread-1' },
      error: null,
    })
    const emailMessagesInsert = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesInsert = vi.fn().mockResolvedValue({ error: null })
    const emailConfigUpdateEq = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
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
                status: 'awaiting_internal_reply',
                direction: 'inbound',
                message_count: 1,
              })

              return {
                select: vi.fn(() => ({
                  single: emailThreadsInsertSingle,
                })),
              }
            }),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'lead-1' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'email_configurations') {
          return {
            update: vi.fn(() => ({
              eq: emailConfigUpdateEq,
            })),
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

    const bodyText = 'Do you have any 2-bedroom units?'
    const encodedBody = Buffer.from(bodyText, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          messages: [{ id: 'gmail-message-1', threadId: 'gmail-thread-1', snippet: bodyText }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'gmail-message-1',
          threadId: 'gmail-thread-1',
          snippet: bodyText,
          internalDate: '1710000000000',
          labelIds: ['INBOX', 'UNREAD'],
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'Lead Prospect <lead@example.com>' },
              { name: 'To', value: 'Leasing <leasing@example.com>' },
              { name: 'Subject', value: 'Interested in availability' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: encodedBody,
                },
              },
            ],
          },
        }),
      })

    const { syncInbox } = await import('./gmail-service')
    const result = await syncInbox({
      id: 'config-1',
      property_id: 'property-1',
      profile_id: 'profile-1',
      google_email: 'leasing@example.com',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      sync_enabled: true,
      auto_reply_enabled: false,
      signature_template: null,
      token_status: 'healthy',
      last_sync_at: null,
      history_id: null,
      watch_expiration: null,
    })

    expect(result).toEqual({
      newMessages: 1,
      updatedThreads: 1,
    })
    expect(emailMessagesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email_thread_id: 'email-thread-1',
        gmail_message_id: 'gmail-message-1',
        direction: 'inbound',
        from_email: 'lead@example.com',
        from_name: 'Lead Prospect',
        to_emails: ['leasing@example.com'],
        subject: 'Interested in availability',
        snippet: bodyText,
      })
    )
    expect(emailConfigUpdateEq).toHaveBeenCalledWith('id', 'config-1')
    expect(leadActivitiesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-1',
        type: 'email_received',
      })
    )
  })

  it('syncInbox uses webhook history hint for incremental ingestion', async () => {
    const emailThreadsInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'email-thread-2' },
      error: null,
    })
    const emailMessagesInsert = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesInsert = vi.fn().mockResolvedValue({ error: null })
    const emailConfigUpdateEq = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: emailThreadsInsertSingle,
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'lead-2' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'email_configurations') {
          return {
            update: vi.fn(() => ({
              eq: emailConfigUpdateEq,
            })),
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

    const bodyText = 'Can I move my tour to Friday?'
    const encodedBody = Buffer.from(bodyText, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          history: [
            {
              messagesAdded: [
                {
                  message: {
                    id: 'gmail-message-2',
                  },
                },
              ],
            },
          ],
          historyId: 'history-2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'gmail-message-2',
          threadId: 'gmail-thread-2',
          snippet: bodyText,
          internalDate: '1710000001000',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'Lead Prospect <lead2@example.com>' },
              { name: 'To', value: 'Leasing <leasing@example.com>' },
              { name: 'Subject', value: 'Tour reschedule request' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: encodedBody,
                },
              },
            ],
          },
        }),
      })

    const { syncInbox } = await import('./gmail-service')
    const result = await syncInbox(
      {
        id: 'config-2',
        property_id: 'property-1',
        profile_id: 'profile-1',
        google_email: 'leasing@example.com',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        sync_enabled: true,
        auto_reply_enabled: false,
        signature_template: null,
        token_status: 'healthy',
        last_sync_at: null,
        history_id: null,
        watch_expiration: null,
      },
      {
        historyIdHint: 'history-1',
      }
    )

    expect(result).toEqual({
      newMessages: 1,
      updatedThreads: 1,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/history?startHistoryId=history-1&historyTypes=messageAdded'),
      expect.any(Object)
    )
    expect(emailConfigUpdateEq).toHaveBeenCalledWith('id', 'config-2')
  })

  it('syncInbox updates existing thread status to awaiting_internal_reply', async () => {
    const emailThreadsUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const emailMessagesInsert = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesInsert = vi.fn().mockResolvedValue({ error: null })
    const emailConfigUpdateEq = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'email-thread-existing',
                      message_count: 7,
                      direction: 'mixed',
                      lead_id: 'lead-3',
                      subject: 'Original subject',
                    },
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({
                message_count: 8,
                status: 'awaiting_internal_reply',
              })
              return {
                eq: emailThreadsUpdateEq,
              }
            }),
            insert: vi.fn(),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'lead-3' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'email_configurations') {
          return {
            update: vi.fn(() => ({
              eq: emailConfigUpdateEq,
            })),
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

    const bodyText = 'Following up about our last message.'
    const encodedBody = Buffer.from(bodyText, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          history: [
            {
              messagesAdded: [
                {
                  message: {
                    id: 'gmail-message-3',
                  },
                },
              ],
            },
          ],
          historyId: 'history-3',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'gmail-message-3',
          threadId: 'gmail-thread-existing',
          snippet: bodyText,
          internalDate: '1710000002000',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'Lead Prospect <lead3@example.com>' },
              { name: 'To', value: 'Leasing <leasing@example.com>' },
              { name: 'Subject', value: 'Re: Original subject' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: encodedBody,
                },
              },
            ],
          },
        }),
      })

    const { syncInbox } = await import('./gmail-service')
    const result = await syncInbox(
      {
        id: 'config-3',
        property_id: 'property-1',
        profile_id: 'profile-1',
        google_email: 'leasing@example.com',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        sync_enabled: true,
        auto_reply_enabled: false,
        signature_template: null,
        token_status: 'healthy',
        last_sync_at: null,
        history_id: null,
        watch_expiration: null,
      },
      {
        historyIdHint: 'history-2',
      }
    )

    expect(result).toEqual({
      newMessages: 1,
      updatedThreads: 1,
    })
    expect(emailThreadsUpdateEq).toHaveBeenCalledWith('id', 'email-thread-existing')
    expect(emailConfigUpdateEq).toHaveBeenCalledWith('id', 'config-3')
  })

  it('syncInbox reopens resolved threads and logs a reopen activity', async () => {
    const emailThreadsUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const emailMessagesInsert = vi.fn().mockResolvedValue({ error: null })
    const leadActivitiesInsert = vi.fn().mockResolvedValue({ error: null })
    const emailConfigUpdateEq = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_messages') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
            insert: emailMessagesInsert,
          }
        }

        if (table === 'email_threads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: 'email-thread-resolved',
                      message_count: 2,
                      direction: 'mixed',
                      lead_id: 'lead-4',
                      subject: 'Original subject',
                      status: 'resolved',
                    },
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((payload: unknown) => {
              expect(payload).toMatchObject({
                message_count: 3,
                status: 'awaiting_internal_reply',
              })
              return {
                eq: emailThreadsUpdateEq,
              }
            }),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'lead-4' },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'email_configurations') {
          return {
            update: vi.fn(() => ({
              eq: emailConfigUpdateEq,
            })),
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

    const bodyText = 'I replied after the thread was closed.'
    const encodedBody = Buffer.from(bodyText, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          history: [
            {
              messagesAdded: [
                {
                  message: {
                    id: 'gmail-message-4',
                  },
                },
              ],
            },
          ],
          historyId: 'history-4',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'gmail-message-4',
          threadId: 'gmail-thread-resolved',
          snippet: bodyText,
          internalDate: '1710000003000',
          labelIds: ['INBOX'],
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'Lead Prospect <lead4@example.com>' },
              { name: 'To', value: 'Leasing <leasing@example.com>' },
              { name: 'Subject', value: 'Re: Original subject' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: {
                  data: encodedBody,
                },
              },
            ],
          },
        }),
      })

    const { syncInbox } = await import('./gmail-service')
    const result = await syncInbox(
      {
        id: 'config-4',
        property_id: 'property-1',
        profile_id: 'profile-1',
        google_email: 'leasing@example.com',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_expires_at: '2099-01-01T00:00:00.000Z',
        sync_enabled: true,
        auto_reply_enabled: false,
        signature_template: null,
        token_status: 'healthy',
        last_sync_at: null,
        history_id: null,
        watch_expiration: null,
      },
      {
        historyIdHint: 'history-3',
      }
    )

    expect(result).toEqual({
      newMessages: 1,
      updatedThreads: 1,
    })
    expect(emailThreadsUpdateEq).toHaveBeenCalledWith('id', 'email-thread-resolved')
    expect(leadActivitiesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-4',
        type: 'email_received',
      })
    )
    expect(leadActivitiesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-4',
        type: 'email_thread_reopened',
        metadata: expect.objectContaining({
          email_thread_id: 'email-thread-resolved',
          previous_status: 'resolved',
          new_status: 'awaiting_internal_reply',
        }),
      })
    )
    expect(emailConfigUpdateEq).toHaveBeenCalledWith('id', 'config-4')
  })
})
