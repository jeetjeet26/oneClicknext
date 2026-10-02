import {beforeEach,describe,expect,it,vi} from 'vitest'
const createServiceClientMock=vi.fn()
vi.mock('@/utils/supabase/admin',()=>({createServiceClient:createServiceClientMock}))
describe('Workflow enrollment',()=>{
 beforeEach(()=>vi.clearAllMocks())
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
