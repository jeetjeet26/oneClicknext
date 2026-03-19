import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const executeExistingSharedJobMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/shared-executor', () => ({
  executeExistingSharedJob: executeExistingSharedJobMock,
}))

describe('shared dispatcher', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'expected-secret'
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'action-1',
              job_id: 'job-1',
              property_id: 'property-1',
              action_type: 'publish_social_content',
              proposal_decision_status: 'approved',
              lifecycle_status: 'queued',
              execution_status: 'approved_pending_execution',
              execution_payload: {
                draftId: 'draft-1',
                connectionIds: ['conn-1'],
              },
              shared_jobs: {
                id: 'job-1',
                domain: 'forgestudio.publish',
              },
            },
            error: null,
          }),
        })),
      })),
    })
    createServiceClientMock.mockReturnValue({ from: fromMock })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as Response)
    executeExistingSharedJobMock.mockImplementation(async ({ execute }) => execute())
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resumes approved ForgeStudio actions through the internal publish route', async () => {
    const { resumeSharedActionAttempt } = await import('./shared-dispatcher')
    const result = await resumeSharedActionAttempt('action-1', 'resume')

    expect(executeExistingSharedJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedJobId: 'job-1',
        sharedActionAttemptId: 'action-1',
        incrementAttemptCount: false,
      })
    )
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/forgestudio/social/publish',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(result).toEqual({ success: true })
  })

  it('marks replays as incrementing attempt counts', async () => {
    const { resumeSharedActionAttempt } = await import('./shared-dispatcher')
    await resumeSharedActionAttempt('action-1', 'replay')

    expect(executeExistingSharedJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        incrementAttemptCount: true,
        statusReason: 'replaying',
      })
    )
  })
})
