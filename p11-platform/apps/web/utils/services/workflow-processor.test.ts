import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const sendMessageMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('./messaging', () => ({
  sendMessage: sendMessageMock,
  replaceTemplateVariables: (template: string) => template,
}))

function buildWorkflowRow(overrides?: Partial<{
  leadStatus: string
  currentStep: number
  steps: Array<{ id: number; delay_hours: number; action: 'sms' | 'email' | 'wait'; template_slug: string }>
}>) {
  return {
    id: 'lead-workflow-1',
    lead_id: 'lead-1',
    workflow_id: 'workflow-1',
    current_step: overrides?.currentStep ?? 0,
    status: 'active',
    last_action_at: '2026-03-01T00:00:00.000Z',
    next_action_at: '2026-03-01T00:00:00.000Z',
    workflow_definitions: {
      id: 'workflow-1',
      name: 'New Lead Nurture',
      steps:
        overrides?.steps ??
        [{ id: 0, delay_hours: 0, action: 'email', template_slug: 'welcome-email' }],
      exit_conditions: ['leased', 'lost'],
      property_id: 'property-1',
    },
    leads: {
      id: 'lead-1',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: '5551112222',
      status: overrides?.leadStatus ?? 'new',
    },
  }
}

function buildSupabaseMock(options?: {
  workflows?: unknown[]
  existingAction?: { id: string; status: string } | null
  sendVisibilityFailure?: boolean
  existingConversation?: { id: string } | null
  claimSucceeds?: boolean
}) {
  const workflowRows = options?.workflows ?? [buildWorkflowRow()]
  const existingAction = options?.existingAction ?? null
  const existingConversation = options?.existingConversation ?? { id: 'conversation-1' }
  const claimSucceeds = options?.claimSucceeds ?? true

  const leadWorkflowUpdates: unknown[] = []
  const workflowActionsInserts: unknown[] = []
  const messageInserts: unknown[] = []
  const leadUpdates: unknown[] = []

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'lead_workflows') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              lte: vi.fn(() => ({
                or: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: workflowRows,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          update: vi.fn((payload: unknown) => {
            leadWorkflowUpdates.push(payload)

            if (
              payload &&
              typeof payload === 'object' &&
              'processing_started_at' in payload &&
              'processing_expires_at' in payload &&
              !('current_step' in payload) &&
              !('status' in payload) &&
              Boolean((payload as { processing_started_at?: string | null }).processing_started_at)
            ) {
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      or: vi.fn(() => ({
                        select: vi.fn(() => ({
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: claimSucceeds ? { id: 'lead-workflow-1' } : null,
                            error: null,
                          }),
                        })),
                      })),
                    })),
                  })),
                })),
              }
            }

            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            }
          }),
        }
      }

      if (table === 'workflow_actions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: existingAction,
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: unknown) => {
            workflowActionsInserts.push(payload)
            return Promise.resolve({ error: null })
          }),
        }
      }

      if (table === 'follow_up_templates') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'template-1',
                    body: 'Hello {{first_name}}',
                    subject: 'Welcome',
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      if (table === 'properties') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  name: 'The Beacon',
                  settings: null,
                },
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
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: existingConversation,
                  error: null,
                }),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'conversation-new' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'messages') {
        return {
          insert: vi.fn((payload: unknown) => {
            messageInserts.push(payload)
            if (options?.sendVisibilityFailure) {
              return Promise.reject(new Error('messages insert failed'))
            }
            return Promise.resolve({ error: null })
          }),
        }
      }

      if (table === 'leads') {
        return {
          update: vi.fn((payload: unknown) => {
            leadUpdates.push(payload)
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            }
          }),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    }),
  }

  return {
    supabase,
    leadWorkflowUpdates,
    workflowActionsInserts,
    messageInserts,
    leadUpdates,
  }
}

describe('workflow processor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('advances a workflow without re-sending when the step already succeeded', async () => {
    const mock = buildSupabaseMock({
      existingAction: { id: 'action-1', status: 'sent' },
    })
    createServiceClientMock.mockReturnValue(mock.supabase)

    const { processWorkflows } = await import('./workflow-processor')
    const result = await processWorkflows()

    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(mock.leadWorkflowUpdates).toContainEqual(
      expect.objectContaining({
        current_step: 1,
        status: 'completed',
      })
    )
  })

  it('records a failed action and does not advance the workflow when sending fails', async () => {
    const mock = buildSupabaseMock()
    createServiceClientMock.mockReturnValue(mock.supabase)
    sendMessageMock.mockResolvedValue({
      success: false,
      error: 'provider unavailable',
      channel: 'email',
    })

    const { processWorkflows } = await import('./workflow-processor')
    const result = await processWorkflows()

    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toContain('Lead lead-1: provider unavailable')
    expect(mock.workflowActionsInserts).toContainEqual(
      expect.objectContaining({
        status: 'failed',
        error_message: 'provider unavailable',
      })
    )
    expect(
      mock.leadWorkflowUpdates.some((payload) =>
        typeof payload === 'object' &&
        payload !== null &&
        ('current_step' in payload || 'status' in payload)
      )
    ).toBe(false)
  })

  it('does not retry a successful send when visibility writes fail afterwards', async () => {
    const mock = buildSupabaseMock({
      sendVisibilityFailure: true,
    })
    createServiceClientMock.mockReturnValue(mock.supabase)
    sendMessageMock.mockResolvedValue({
      success: true,
      messageId: 'message-1',
      channel: 'email',
    })

    const { processWorkflows } = await import('./workflow-processor')
    const result = await processWorkflows()

    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    })
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    expect(mock.workflowActionsInserts).toContainEqual(
      expect.objectContaining({
        status: 'sent',
        external_id: 'message-1',
      })
    )
    expect(mock.leadWorkflowUpdates).toContainEqual(
      expect.objectContaining({
        current_step: 1,
        status: 'completed',
      })
    )
  })

  it('skips sending when another processor already claimed the workflow step', async () => {
    const mock = buildSupabaseMock({
      claimSucceeds: false,
    })
    createServiceClientMock.mockReturnValue(mock.supabase)

    const { processWorkflows } = await import('./workflow-processor')
    const result = await processWorkflows()

    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(mock.workflowActionsInserts).toHaveLength(0)
  })

  it('stops a workflow immediately when the lead meets an exit condition', async () => {
    const mock = buildSupabaseMock({
      workflows: [buildWorkflowRow({ leadStatus: 'leased' })],
    })
    createServiceClientMock.mockReturnValue(mock.supabase)

    const { processWorkflows } = await import('./workflow-processor')
    const result = await processWorkflows()

    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(mock.leadWorkflowUpdates).toContainEqual(
      expect.objectContaining({
        status: 'converted',
      })
    )
  })

  it('recovers from transient provider errors via retry and still advances workflow', async () => {
    const mock = buildSupabaseMock()
    createServiceClientMock.mockReturnValue(mock.supabase)
    sendMessageMock
      .mockRejectedValueOnce(new Error('temporary SMTP timeout'))
      .mockResolvedValueOnce({
        success: true,
        messageId: 'message-after-retry',
        channel: 'email',
      })

    const { processWorkflows } = await import('./workflow-processor')
    const result = await processWorkflows()

    expect(result).toEqual({
      processed: 1,
      succeeded: 1,
      failed: 0,
      errors: [],
    })
    expect(sendMessageMock).toHaveBeenCalledTimes(2)
    expect(mock.workflowActionsInserts).toContainEqual(
      expect.objectContaining({
        status: 'sent',
        external_id: 'message-after-retry',
      })
    )
    expect(mock.leadWorkflowUpdates).toContainEqual(
      expect.objectContaining({
        current_step: 1,
        status: 'completed',
      })
    )
  })

  it('clears processing lease when message delivery throws after retries', async () => {
    const mock = buildSupabaseMock()
    createServiceClientMock.mockReturnValue(mock.supabase)
    sendMessageMock.mockRejectedValue(new Error('provider transport failed'))

    const { processWorkflows } = await import('./workflow-processor')
    const result = await processWorkflows()

    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors).toContain('Lead lead-1: provider transport failed')
    expect(sendMessageMock).toHaveBeenCalledTimes(3)
    expect(mock.workflowActionsInserts).toHaveLength(0)
    expect(mock.leadWorkflowUpdates).toContainEqual(
      expect.objectContaining({
        processing_started_at: null,
        processing_expires_at: null,
      })
    )
  })

  it('reuses an existing active workflow instead of creating a duplicate', async () => {
    const leadWorkflowInsert = vi.fn()

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'workflow_definitions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'workflow-1',
                        steps: [{ id: 0, delay_hours: 1, action: 'email', template_slug: 'welcome-email' }],
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        if (table === 'lead_workflows') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: 'existing-workflow-1' },
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
            insert: leadWorkflowInsert,
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { startWorkflow } = await import('./workflow-processor')
    const result = await startWorkflow('lead-1', 'property-1', 'lead_created')

    expect(result).toEqual({
      success: true,
      workflowId: 'existing-workflow-1',
    })
    expect(leadWorkflowInsert).not.toHaveBeenCalled()
  })

  it('auto-seeds defaults when no workflow exists and then creates the lead workflow', async () => {
    let workflowDefinitionSelectCalls = 0
    const leadWorkflowInsertSingle = vi.fn().mockResolvedValue({
      data: { id: 'new-lead-workflow-1' },
      error: null,
    })
    const workflowDefinitionInsert = vi.fn().mockResolvedValue({ error: null })
    const templateUpsert = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'workflow_definitions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn().mockImplementation(() => {
                      workflowDefinitionSelectCalls += 1

                      if (workflowDefinitionSelectCalls === 1) {
                        return Promise.resolve({
                          data: null,
                          error: null,
                        })
                      }

                      if (workflowDefinitionSelectCalls >= 2 && workflowDefinitionSelectCalls <= 4) {
                        return Promise.resolve({
                          data: null,
                          error: null,
                        })
                      }

                      return Promise.resolve({
                        data: {
                          id: 'workflow-1',
                          steps: [{ id: 0, delay_hours: 1, action: 'email', template_slug: 'welcome-email' }],
                        },
                        error: null,
                      })
                    }),
                  })),
                  maybeSingle: vi.fn().mockImplementation(() => {
                    workflowDefinitionSelectCalls += 1

                    if (workflowDefinitionSelectCalls >= 2 && workflowDefinitionSelectCalls <= 4) {
                      return Promise.resolve({
                        data: null,
                        error: null,
                      })
                    }

                    return Promise.resolve({
                      data: {
                        id: 'workflow-1',
                        steps: [{ id: 0, delay_hours: 1, action: 'email', template_slug: 'welcome-email' }],
                      },
                      error: null,
                    })
                  }),
                })),
              })),
            })),
            insert: workflowDefinitionInsert,
          }
        }

        if (table === 'follow_up_templates') {
          return {
            upsert: templateUpsert,
          }
        }

        if (table === 'lead_workflows') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null,
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: leadWorkflowInsertSingle,
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { startWorkflow } = await import('./workflow-processor')
    const result = await startWorkflow('lead-1', 'property-1', 'lead_created')

    expect(result).toEqual({
      success: true,
      workflowId: 'new-lead-workflow-1',
    })
    expect(templateUpsert).toHaveBeenCalled()
    expect(workflowDefinitionInsert).toHaveBeenCalled()
  })

  it('reuses the existing workflow when a concurrent insert hits the active-workflow unique constraint', async () => {
    let leadWorkflowSelectCalls = 0

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'workflow_definitions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'workflow-1',
                        steps: [{ id: 0, delay_hours: 1, action: 'email', template_slug: 'welcome-email' }],
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        if (table === 'lead_workflows') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle: vi.fn().mockImplementation(() => {
                        leadWorkflowSelectCalls += 1

                        if (leadWorkflowSelectCalls === 1) {
                          return Promise.resolve({
                            data: null,
                            error: null,
                          })
                        }

                        return Promise.resolve({
                          data: { id: 'existing-after-race' },
                          error: null,
                        })
                      }),
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'duplicate key value violates unique constraint' },
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { startWorkflow } = await import('./workflow-processor')
    const result = await startWorkflow('lead-1', 'property-1', 'lead_created')

    expect(result).toEqual({
      success: true,
      workflowId: 'existing-after-race',
    })
  })

  it('returns a clear error when a workflow definition has no executable steps', async () => {
    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'workflow_definitions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'workflow-1',
                        steps: [],
                      },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })

    const { startWorkflow } = await import('./workflow-processor')
    const result = await startWorkflow('lead-1', 'property-1', 'lead_created')

    expect(result).toEqual({
      success: false,
      error: 'Workflow has no executable steps',
    })
  })
})
