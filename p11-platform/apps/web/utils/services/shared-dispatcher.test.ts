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
              org_id: 'org-1',
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

  it('recognizes only explicitly registered dispatcher keys', async () => {
    const { isSharedActionDispatchRegistered } = await import(
      './shared-dispatcher'
    )

    expect(
      isSharedActionDispatchRegistered(
        'forgestudio.publish',
        'publish_social_content'
      )
    ).toBe(true)
    expect(
      isSharedActionDispatchRegistered(
        'siteforge.launch',
        'siteforge.launch:promote_production'
      )
    ).toBe(false)
  })

  it('rejects unregistered SiteForge actions before claiming the job', async () => {
    fromMock.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'siteforge-action-1',
              job_id: 'siteforge-job-1',
              org_id: 'org-1',
              property_id: 'property-1',
              action_type: 'siteforge.launch:promote_production',
              proposal_decision_status: 'approved',
              lifecycle_status: 'queued',
              execution_status: 'approved_pending_execution',
              execution_payload: { releaseId: 'release-1' },
              request_payload: {},
              shared_jobs: {
                id: 'siteforge-job-1',
                domain: 'siteforge.launch',
              },
            },
            error: null,
          }),
        })),
      })),
    })

    const { resumeSharedActionAttempt } = await import('./shared-dispatcher')

    await expect(
      resumeSharedActionAttempt('siteforge-action-1', 'resume')
    ).rejects.toMatchObject({
      statusCode: 501,
      message:
        'No shared dispatcher is registered for siteforge.launch:siteforge.launch:promote_production',
    })
    expect(executeExistingSharedJobMock).not.toHaveBeenCalled()
  })

  it('checks action registration within the requested property scope', async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'action-1',
        action_type: 'publish_social_content',
        property_id: 'property-1',
        shared_jobs: { domain: 'forgestudio.publish' },
      },
      error: null,
    })
    const secondEqMock = vi.fn(() => ({ single: singleMock }))
    const firstEqMock = vi.fn(() => ({ eq: secondEqMock }))
    fromMock.mockReturnValue({
      select: vi.fn(() => ({ eq: firstEqMock })),
    })

    const { assertSharedActionAttemptDispatchRegistered } = await import(
      './shared-dispatcher'
    )
    await expect(
      assertSharedActionAttemptDispatchRegistered('action-1', 'property-1')
    ).resolves.toBeUndefined()

    expect(firstEqMock).toHaveBeenCalledWith('id', 'action-1')
    expect(secondEqMock).toHaveBeenCalledWith('property_id', 'property-1')
  })
})
