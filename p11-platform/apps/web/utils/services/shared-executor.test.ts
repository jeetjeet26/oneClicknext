import { beforeEach, describe, expect, it, vi } from 'vitest'

const createServiceClientMock = vi.fn()
const fromMock = vi.fn()
const sharedJobsInsertMock = vi.fn()
const sharedJobsUpdateMock = vi.fn()
const sharedActionInsertMock = vi.fn()
const sharedActionUpdateMock = vi.fn()
const sharedContextInsertMock = vi.fn()
const eqMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/substrate/business-context-bridge', () => ({
  buildBusinessContextBridge: vi.fn().mockResolvedValue({
    propertyId: 'property-1',
    readOnly: true,
    citations: [],
  }),
}))

describe('runSharedExecutorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eqMock.mockResolvedValue({ error: null })
    sharedJobsUpdateMock.mockReturnValue({ eq: eqMock })
    sharedActionUpdateMock.mockReturnValue({ eq: eqMock })
    sharedJobsInsertMock.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'shared-job-1' }, error: null }),
      })),
    })
    sharedActionInsertMock.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'action-1' }, error: null }),
      })),
    })
    sharedContextInsertMock.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'snapshot-1' }, error: null }),
      })),
    })
    fromMock.mockImplementation((table: string) => {
      if (table === 'shared_jobs') {
        return {
          insert: sharedJobsInsertMock,
          update: sharedJobsUpdateMock,
        }
      }
      if (table === 'shared_action_attempts') {
        return {
          insert: sharedActionInsertMock,
          update: sharedActionUpdateMock,
        }
      }
      if (table === 'shared_context_snapshots') {
        return {
          insert: sharedContextInsertMock,
        }
      }
      return {
        insert: sharedJobsInsertMock,
        update: sharedJobsUpdateMock,
      }
    })
    createServiceClientMock.mockReturnValue({ from: fromMock })
  })

  it('records succeeded lifecycle on successful execution', async () => {
    const { runSharedExecutorJob } = await import('./shared-executor')
    const result = await runSharedExecutorJob({
      orgId: 'org-1',
      propertyId: 'property-1',
      domain: 'cron.sync-ads',
      subjectType: 'ad_account_connection',
      subjectId: 'conn-1',
      execute: async () => ({ synced: 4 }),
    })

    expect(result).toEqual({ synced: 4 })
    expect(sharedJobsInsertMock).toHaveBeenCalledTimes(1)
    expect(sharedContextInsertMock).toHaveBeenCalledTimes(1)
    expect(sharedJobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'succeeded',
        status_reason: 'completed',
      })
    )
  })

  it('records failed lifecycle and rethrows on execution failure', async () => {
    const { runSharedExecutorJob } = await import('./shared-executor')
    await expect(
      runSharedExecutorJob({
        orgId: 'org-1',
        propertyId: 'property-1',
        domain: 'cron.sync-ads',
        subjectType: 'ad_account_connection',
        subjectId: 'conn-1',
        execute: async () => {
          throw new Error('boom')
        },
      })
    ).rejects.toThrow('boom')

    expect(sharedJobsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'failed',
        status_reason: 'execution_failed',
        error_message: 'boom',
      })
    )
    expect(sharedActionUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        execution_status: 'executing',
      })
    )
  })

  it('records shared action attempt when action ledger input is provided', async () => {
    const { runSharedExecutorJob } = await import('./shared-executor')
    const result = await runSharedExecutorJob({
      orgId: 'org-1',
      propertyId: 'property-1',
      domain: 'cron.sync-ads',
      subjectType: 'ad_account_connection',
      subjectId: 'conn-1',
      payload: { accountId: '123' },
      action: {
        actionType: 'sync_ad_account',
        proposalDecisionStatus: 'approved',
        requestPayload: { platform: 'google_ads' },
        executionPayload: { triggerSource: 'cron' },
        policyReason: 'scheduled_recurring_sync',
      },
      execute: async () => ({ synced: 5, retryable: false }),
    })

    expect(result).toEqual({ synced: 5, retryable: false })
    expect(sharedActionInsertMock).toHaveBeenCalledTimes(1)
    expect(sharedActionInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'sync_ad_account',
        proposal_decision_status: 'approved',
        execution_status: 'executing',
      })
    )
    expect(sharedActionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'succeeded',
        execution_status: 'executed',
      })
    )
  })

  it('marks action ledger execution as failed when execution throws', async () => {
    const { runSharedExecutorJob } = await import('./shared-executor')

    await expect(
      runSharedExecutorJob({
        orgId: 'org-1',
        propertyId: 'property-1',
        domain: 'cron.sync-ads',
        subjectType: 'ad_account_connection',
        subjectId: 'conn-1',
        action: {
          actionType: 'sync_ad_account',
          proposalDecisionStatus: 'approved',
        },
        execute: async () => {
          throw new Error('boom')
        },
      })
    ).rejects.toThrow('boom')

    expect(sharedActionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'failed',
        execution_status: 'failed',
        error_message: 'boom',
      })
    )
  })

  it('persists approval-required actions without executing them', async () => {
    const { runSharedExecutorJob, SharedExecutorApprovalRequiredError } = await import('./shared-executor')

    await expect(
      runSharedExecutorJob({
        orgId: 'org-1',
        propertyId: 'property-1',
        domain: 'autonomy.publish',
        subjectType: 'draft',
        subjectId: 'draft-1',
        action: {
          actionType: 'publish_post',
          proposalDecisionStatus: 'proposed',
          requestPayload: { draftId: 'draft-1' },
        },
        execute: async () => ({ published: true }),
      })
    ).rejects.toBeInstanceOf(SharedExecutorApprovalRequiredError)

    expect(sharedJobsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'queued',
        status_reason: 'approval_required',
        started_at: null,
      })
    )
    expect(sharedActionInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: 'queued',
        proposal_decision_status: 'proposed',
        execution_status: 'pending_approval',
      })
    )
  })
})

