import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const validateBodyMock = vi.fn()
const getRateLimitKeyMock = vi.fn()
const rateLimitHeadersMock = vi.fn()
const chatLimiterCheckMock = vi.fn()
const auditLogMock = vi.fn()
const getRequestIpMock = vi.fn()
const openAiChatCreateMock = vi.fn()
const openAiEmbeddingsCreateMock = vi.fn()
const syncLeadToCRMMock = vi.fn()
const getCalendarConfigMock = vi.fn()
const createCalendarEventMock = vi.fn()
const startWorkflowMock = vi.fn()
const trackEngagementEventMock = vi.fn()
const sendEmailMock = vi.fn()
const loadPropertyChatbotContextMock = vi.fn()
const openAiCtorMock = vi.fn(function MockOpenAI() {
  return {
    chat: { completions: { create: openAiChatCreateMock } },
    embeddings: { create: openAiEmbeddingsCreateMock },
  }
})

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/validation', () => ({
  validateBody: validateBodyMock,
  chatRequestSchema: {},
}))

vi.mock('@/utils/services/rate-limiter', () => ({
  chatLimiter: {
    check: chatLimiterCheckMock,
  },
  getRateLimitKey: getRateLimitKeyMock,
  rateLimitHeaders: rateLimitHeadersMock,
}))

vi.mock('@/utils/services/audit-logger', () => ({
  auditLog: auditLogMock,
  getRequestIp: getRequestIpMock,
}))

vi.mock('@/utils/services/crm-sync', () => ({
  syncLeadToCRM: syncLeadToCRMMock,
}))

vi.mock('@/utils/services/google-calendar', () => ({
  getCalendarConfig: getCalendarConfigMock,
  createCalendarEvent: createCalendarEventMock,
}))

vi.mock('@/utils/services/workflow-processor', () => ({
  startWorkflow: startWorkflowMock,
}))

vi.mock('@/utils/services/engagement-tracker', () => ({
  trackEngagementEvent: trackEngagementEventMock,
}))

vi.mock('@/utils/services/messaging', () => ({
  sendEmail: sendEmailMock,
}))

vi.mock('@/utils/services/chatbot-context-editor', () => ({
  loadPropertyChatbotContext: loadPropertyChatbotContextMock,
}))

vi.mock('openai', () => ({
  default: openAiCtorMock,
}))

describe('LumaLeasing chat route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServiceClientMock.mockReset()
    openAiChatCreateMock.mockReset()
    openAiEmbeddingsCreateMock.mockReset()
    openAiCtorMock.mockClear()
    syncLeadToCRMMock.mockReset()
    getCalendarConfigMock.mockReset()
    createCalendarEventMock.mockReset()
    startWorkflowMock.mockReset()
    trackEngagementEventMock.mockReset()
    sendEmailMock.mockReset()
    loadPropertyChatbotContextMock.mockReset()
    loadPropertyChatbotContextMock.mockResolvedValue({
      contextMarkdown: 'CLIENT PROPERTY CONTEXT\nAcacia includes rooftop decks, solar, and verified floorplan facts.',
      contextJson: {},
      status: 'current',
      requiresReview: false,
    })
    getRateLimitKeyMock.mockReturnValue('chat-key')
    chatLimiterCheckMock.mockReturnValue({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 60_000,
    })
    rateLimitHeadersMock.mockReturnValue({})
    auditLogMock.mockImplementation(() => {})
    getRequestIpMock.mockReturnValue('127.0.0.1')
    syncLeadToCRMMock.mockResolvedValue({ action: 'skipped' })
    getCalendarConfigMock.mockResolvedValue(null)
    createCalendarEventMock.mockResolvedValue({ eventId: 'event-1' })
    startWorkflowMock.mockResolvedValue(undefined)
    trackEngagementEventMock.mockResolvedValue(undefined)
    sendEmailMock.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when the API key is missing', async () => {
    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'API key required' })
  })

  it('returns waitingForHuman when an existing conversation is in human mode', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        messages: [{ role: 'user', content: 'hello there' }],
        sessionId: 'session-1',
        leadInfo: null,
      },
    })

    const widgetSessionSelectSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'session-1', lead_id: null, message_count: 2 } })

    const conversationsSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'conv-1', is_human_mode: true } })

    const widgetSessionUpdateSingle = vi
      .fn()
      .mockResolvedValue({ data: { message_count: 3 }, error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      widget_name: 'Luma',
                      collect_email: true,
                      lead_capture_prompt: 'share your email',
                      properties: { name: 'Acacia', property_type: 'master_planned' },
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'widget_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: widgetSessionSelectSingle,
                eq: vi.fn(() => ({
                  maybeSingle: widgetSessionSelectSingle,
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: widgetSessionUpdateSingle,
                  })),
                })),
                select: vi.fn(() => ({
                  single: widgetSessionUpdateSingle,
                })),
              })),
            })),
          }
        }

        if (table === 'conversations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: conversationsSingle,
                  })),
                })),
              })),
            })),
          }
        }

        if (table === 'messages') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    // Override widget_sessions behavior after initial session lookup:
    let widgetSessionSelectCalls = 0
    widgetSessionSelectSingle.mockImplementation(() => {
      widgetSessionSelectCalls += 1
      if (widgetSessionSelectCalls === 1) {
        return Promise.resolve({
          data: { id: 'session-1', lead_id: null, message_count: 2 },
        })
      }

      return Promise.resolve({
        data: { message_count: 2 },
      })
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello there' }],
        sessionId: 'session-1',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toEqual({
      content: null,
      sessionId: 'session-1',
      conversationId: 'conv-1',
      isHumanMode: true,
      waitingForHuman: true,
    })
    expect(openAiCtorMock).toHaveBeenCalledTimes(1)
    expect(openAiChatCreateMock).not.toHaveBeenCalled()
    expect(openAiEmbeddingsCreateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the supplied session id does not belong to the property', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        messages: [{ role: 'user', content: 'hello there' }],
        sessionId: 'foreign-session',
        leadInfo: null,
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      widget_name: 'Luma',
                      collect_email: true,
                      lead_capture_prompt: 'share your email',
                      properties: { name: 'Acacia', property_type: 'master_planned' },
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'widget_sessions') {
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
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello there' }],
        sessionId: 'foreign-session',
      }),
    }) as NextRequest

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid sessionId for this property',
    })
    expect(openAiChatCreateMock).not.toHaveBeenCalled()
    expect(openAiEmbeddingsCreateMock).not.toHaveBeenCalled()
  })

  it('returns recent assistant reply and suppresses duplicate retry side effects', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        messages: [{ role: 'user', content: 'Do you allow pets?' }],
        sessionId: 'session-1',
        leadInfo: null,
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      widget_name: 'Luma',
                      collect_email: true,
                      lead_capture_prompt: 'share your email',
                      properties: { name: 'Acacia', property_type: 'master_planned' },
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'widget_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'session-1', lead_id: null, message_count: 3 },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'conversations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'conv-1', is_human_mode: false },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        if (table === 'messages') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        role: 'assistant',
                        content: 'Yes, we are pet friendly with breed restrictions.',
                        created_at: new Date().toISOString(),
                      },
                      {
                        role: 'user',
                        content: 'Do you allow pets?',
                        created_at: new Date().toISOString(),
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
            insert: vi.fn(),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: vi.fn(),
    })

    const { POST } = await import('./route')

    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Do you allow pets?' }],
        sessionId: 'session-1',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      content: 'Yes, we are pet friendly with breed restrictions.',
      sessionId: 'session-1',
      conversationId: 'conv-1',
      duplicate: true,
      shouldPromptLeadCapture: true,
    })
    expect(openAiChatCreateMock).not.toHaveBeenCalled()
    expect(openAiEmbeddingsCreateMock).not.toHaveBeenCalled()
  })

  it('reuses an existing phone-only direct lead instead of creating duplicate side effects', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        messages: [{ role: 'user', content: 'My phone is 5551112222' }],
        sessionId: null,
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          phone: '5551112222',
        },
      },
    })
    openAiEmbeddingsCreateMock.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    })
    openAiChatCreateMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Thanks, I can help with that.' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"lead":null,"tour":{"requested":false,"date":null,"time":null,"notes":null}}' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Prospect asked for more information.' } }],
      })

    const leadsUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const leadsInsertMock = vi.fn()
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      widget_name: 'Luma',
                      collect_email: true,
                      lead_capture_prompt: 'share your email',
                      properties: { name: 'Acacia', property_type: 'master_planned' },
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn((columns?: string) => {
              if (columns === 'id') {
                return {
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({ data: [{ id: 'lead-existing' }], error: null }),
                    })),
                  })),
                }
              }

              return {
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: { notes: null }, error: null }),
                })),
              }
            }),
            update: vi.fn(() => ({
              eq: leadsUpdateEqMock,
            })),
            insert: leadsInsertMock,
          }
        }

        if (table === 'conversations' || table === 'messages' || table === 'tour_bookings' || table === 'calendar_events' || table === 'lead_scores' || table === 'lead_activities' || table === 'widget_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({ data: null, error: null }),
                  })),
                })),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ error: null }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'My phone is 5551112222' }],
        leadInfo: {
          first_name: 'Jane',
          last_name: 'Doe',
          phone: '5551112222',
        },
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      content: 'Thanks, I can help with that.',
    })
    const firstCompletionArgs = openAiChatCreateMock.mock.calls[0][0]
    const systemPrompt = firstCompletionArgs.messages[0].content
    expect(systemPrompt).toContain('Property name: Acacia')
    expect(systemPrompt).toContain('Property type: Master-Planned Community')
    expect(systemPrompt).not.toContain('$2,915')
    expect(systemPrompt).not.toContain('$3,060')
    expect(systemPrompt).not.toContain('$4,208')
    expect(leadsInsertMock).not.toHaveBeenCalled()
    expect(leadsUpdateEqMock).toHaveBeenCalledWith('id', 'lead-existing')
    expect(syncLeadToCRMMock).not.toHaveBeenCalled()
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })

  it('adds generated client context for feature questions without vector retrieval', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        messages: [{ role: 'user', content: 'features' }],
        sessionId: null,
        leadInfo: null,
      },
    })
    openAiChatCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'Acacia includes solar and rooftop decks.' } }],
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      widget_name: 'Luma',
                      collect_email: true,
                      lead_capture_prompt: 'share your email',
                      properties: { name: 'Acacia', property_type: 'master_planned' },
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'features' }],
      }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(200)
    const firstCompletionArgs = openAiChatCreateMock.mock.calls[0][0]
    const systemPrompt = firstCompletionArgs.messages[0].content
    expect(systemPrompt).toContain('CLIENT PROPERTY CONTEXT')
    expect(systemPrompt).toContain('Acacia includes rooftop decks, solar, and verified floorplan facts.')
    expect(systemPrompt).toContain('CONCIERGE RESPONSE STYLE')
    expect(systemPrompt).toContain('do NOT list every floor plan/unit')
    expect(openAiEmbeddingsCreateMock).not.toHaveBeenCalled()
  })

  it('returns a property-only reply for off-topic questions without calling the LLM', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        messages: [{ role: 'user', content: 'teach me math' }],
        sessionId: null,
        leadInfo: null,
      },
    })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      widget_name: 'Luma',
                      collect_email: true,
                      lead_capture_prompt: 'share your email',
                      properties: { name: 'Acacia', property_type: 'master_planned' },
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'teach me math' }],
      }),
    }) as NextRequest

    const response = await POST(request)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      content: expect.stringContaining('I can only help with questions about Acacia'),
      wantsTour: false,
    })
    expect(openAiEmbeddingsCreateMock).not.toHaveBeenCalled()
    expect(openAiChatCreateMock).not.toHaveBeenCalled()
  })

  it('reuses extracted phone-only leads and avoids duplicating summary notes', async () => {
    validateBodyMock.mockReturnValue({
      success: true,
      data: {
        messages: [{ role: 'user', content: 'You can call me at 5551112222' }],
        sessionId: 'session-1',
        leadInfo: null,
      },
    })
    openAiEmbeddingsCreateMock.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    })
    openAiChatCreateMock
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Thanks for sharing that.' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"lead":{"first_name":null,"last_name":null,"email":null,"phone":"5551112222"},"tour":{"requested":false,"date":null,"time":null,"notes":null}}' } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Prospect asked for pricing details.' } }],
      })

    const leadNotesUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
    const leadsInsertMock = vi.fn()
    const messagesInsertMock = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'lumaleasing_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      property_id: 'property-1',
                      widget_name: 'Luma',
                      collect_email: true,
                      lead_capture_prompt: 'share your email',
                      properties: { name: 'The Beacon' },
                    },
                    error: null,
                  }),
                })),
              })),
            })),
          }
        }

        if (table === 'widget_sessions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'session-1', lead_id: null, message_count: 2 },
                    error: null,
                  }),
                })),
                single: vi.fn().mockResolvedValue({
                  data: { message_count: 2 },
                  error: null,
                }),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: { message_count: 3 },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'session-1', lead_id: null, message_count: 2 },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'conversations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'conv-1', is_human_mode: false },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ error: null }),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'conv-1' },
                  error: null,
                }),
              })),
            })),
          }
        }

        if (table === 'messages') {
          return {
            insert: messagesInsertMock,
          }
        }

        if (table === 'leads') {
          return {
            select: vi.fn((columns?: string) => {
              if (columns === 'id') {
                return {
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      limit: vi.fn().mockResolvedValue({ data: [{ id: 'lead-existing' }], error: null }),
                    })),
                  })),
                }
              }

              return {
                eq: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { notes: '[Mar 12, 9:00 AM] Prospect asked for pricing details.' },
                    error: null,
                  }),
                })),
              }
            }),
            update: vi.fn((payload: Record<string, unknown>) => {
              expect(payload).not.toHaveProperty('notes')
              return {
                eq: leadNotesUpdateEqMock,
              }
            }),
            insert: leadsInsertMock,
          }
        }

        if (table === 'tour_bookings' || table === 'calendar_events' || table === 'lead_scores' || table === 'lead_activities') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    const { POST } = await import('./route')
    const request = new Request('http://localhost/api/lumaleasing/chat', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'You can call me at 5551112222' }],
        sessionId: 'session-1',
      }),
    }) as NextRequest

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      content: 'Thanks for sharing that.',
      sessionId: 'session-1',
      conversationId: 'conv-1',
    })
    expect(leadsInsertMock).not.toHaveBeenCalled()
    expect(leadNotesUpdateEqMock).toHaveBeenCalledWith('id', 'lead-existing')
    expect(syncLeadToCRMMock).not.toHaveBeenCalled()
    expect(startWorkflowMock).not.toHaveBeenCalled()
  })
})
