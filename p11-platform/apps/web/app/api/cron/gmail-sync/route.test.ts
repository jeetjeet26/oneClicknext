import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const createServiceClientMock = vi.fn()
const syncInboxMock = vi.fn()
const setupWatchMock = vi.fn()
const refreshAccessTokenIfNeededMock = vi.fn()
const startCronJobRunMock = vi.fn()
const finishCronJobRunMock = vi.fn()

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/gmail-service', () => ({
  syncInbox: syncInboxMock,
  setupWatch: setupWatchMock,
  refreshAccessTokenIfNeeded: refreshAccessTokenIfNeededMock,
}))

vi.mock('@/utils/services/cron-job-runs', () => ({
  startCronJobRun: startCronJobRunMock,
  finishCronJobRun: finishCronJobRunMock,
}))

describe('GET /api/cron/gmail-sync', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env = { ...originalEnv }
    startCronJobRunMock.mockResolvedValue({
      id: 'run-1',
      jobName: 'gmail-sync',
      startedAtMs: 0,
    })
    finishCronJobRunMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('returns 401 when cron auth is invalid in production', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      CRON_SECRET: 'expected-secret',
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/gmail-sync', {
      method: 'GET',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    }) as NextRequest

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns sync summary for a valid cron request', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      CRON_SECRET: 'expected-secret',
    })

    const emailConfigUpdateEq = vi.fn().mockResolvedValue({ error: null })

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_configurations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
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
                        history_id: null,
                        last_health_check_at: null,
                        watch_expiration: null,
                        token_status: 'healthy',
                        last_sync_at: null,
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: emailConfigUpdateEq,
            })),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })
    refreshAccessTokenIfNeededMock.mockResolvedValue({
      accessToken: 'fresh-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    setupWatchMock.mockResolvedValue('2099-01-02T00:00:00.000Z')
    syncInboxMock.mockResolvedValue({
      newMessages: 2,
      updatedThreads: 2,
    })

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/gmail-sync', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      processed: 1,
      synced: 1,
      failed: 0,
      totalNewMessages: 2,
      totalUpdatedThreads: 2,
      watchRenewed: 1,
      tokenHealthChecks: 1,
    })
    expect(emailConfigUpdateEq).toHaveBeenCalledWith('id', 'config-1')
  })

  it('stores supported health-check fields when sync detects a revoked token', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      CRON_SECRET: 'expected-secret',
    })

    const updatePayloads: Array<Record<string, unknown>> = []

    createServiceClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'email_configurations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
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
                        history_id: null,
                        last_health_check_at: '2099-01-01T00:00:00.000Z',
                        watch_expiration: '2099-01-03T00:00:00.000Z',
                        token_status: 'healthy',
                        last_sync_at: null,
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              updatePayloads.push(payload)
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              }
            }),
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    })
    syncInboxMock.mockRejectedValue(new Error('401 revoked'))

    const { GET } = await import('./route')
    const request = new Request('http://localhost/api/cron/gmail-sync', {
      method: 'GET',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }) as NextRequest

    const response = await GET(request)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(json).toMatchObject({
      success: true,
      processed: 1,
      synced: 0,
      failed: 1,
    })
    expect(updatePayloads).toContainEqual(
      expect.objectContaining({
        token_status: 'revoked',
        health_check_error: '401 revoked',
      })
    )
    expect(updatePayloads.some((payload) => 'last_sync_error' in payload)).toBe(false)
  })
})
