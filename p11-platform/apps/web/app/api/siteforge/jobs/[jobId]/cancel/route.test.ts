import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  expectJsonError,
  makeJsonRequest,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const {
  authGetUserMock,
  createClientMock,
  createServiceClientMock,
  validatePropertyAccessMock,
  serviceFromMock,
  cancelRunMock,
} = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  validatePropertyAccessMock: vi.fn(),
  serviceFromMock: vi.fn(),
  cancelRunMock: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))
vi.mock('workflow/api', () => ({
  getRun: vi.fn(() => ({ cancel: cancelRunMock })),
}))

const jobId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'

function chainedSingle(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.in = vi.fn(() => builder)
  builder.or = vi.fn(() => builder)
  builder.single = vi.fn().mockResolvedValue(result)
  return builder
}

describe('SiteForge job cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createServiceClientMock.mockReturnValue({ from: serviceFromMock })
  })

  it('requires authentication', async () => {
    mockUnauthenticatedUser(authGetUserMock)
    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/cancel`),
      { params: Promise.resolve({ jobId }) }
    )
    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('rejects cancellation for inaccessible properties', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    serviceFromMock.mockReturnValue(
      chainedSingle({
        data: {
          id: jobId,
          property_id: propertyId,
          subject_id: null,
          lifecycle_status: 'running',
          workflow_run_id: 'run-1',
        },
        error: null,
      })
    )

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/cancel`),
      { params: Promise.resolve({ jobId }) }
    )
    await expectJsonError(response, 403, 'Forbidden')
  })

  it('cancels both shared state and the Workflow DevKit run', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    cancelRunMock.mockResolvedValue(undefined)

    const jobQuery = chainedSingle({
      data: {
        id: jobId,
        property_id: propertyId,
        subject_id: null,
        lifecycle_status: 'running',
        workflow_run_id: 'run-1',
      },
      error: null,
    })
    const updateBuilder: Record<string, unknown> = {}
    updateBuilder.eq = vi.fn(() => updateBuilder)
    updateBuilder.in = vi.fn(() => updateBuilder)
    updateBuilder.filter = vi.fn(() => updateBuilder)
    updateBuilder.select = vi.fn(() => updateBuilder)
    updateBuilder.maybeSingle = vi.fn().mockResolvedValue({
      data: { id: jobId },
      error: null,
    })

    let callCount = 0
    serviceFromMock.mockImplementation((table: string) => {
      if (table !== 'shared_jobs') {
        throw new Error(`Unexpected table: ${table}`)
      }
      callCount += 1
      return callCount === 1
        ? jobQuery
        : { update: vi.fn(() => updateBuilder) }
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest(`http://localhost/api/siteforge/jobs/${jobId}/cancel`),
      { params: Promise.resolve({ jobId }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      jobId,
      status: 'cancelled',
    })
    expect(cancelRunMock).toHaveBeenCalledTimes(1)
  })
})
