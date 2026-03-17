import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockServerClient,
  expectJsonError,
  makeJsonRequest,
  mockAuthenticatedUser,
  mockForbiddenPropertyAccess,
  mockUnauthenticatedUser,
} from '@/test/route-test-helpers'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()
const serviceFromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/siteforge/agents', () => ({
  SiteForgeOrchestrator: class MockSiteForgeOrchestrator {},
}))

describe('siteforge generate route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    serviceFromMock.mockReset()
    createClientMock.mockResolvedValue(
      createMockServerClient(authGetUserMock, { from: fromMock })
    )
    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    mockUnauthenticatedUser(authGetUserMock)

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate', {
        body: { propertyId: 'property-1' },
      }),
    )

    await expectJsonError(response, 401, 'Unauthorized')
  })

  it('POST returns 403 when property access is denied', async () => {
    mockAuthenticatedUser(authGetUserMock)
    mockForbiddenPropertyAccess(validatePropertyAccessMock)

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'property-1', name: 'P', org_id: 'org-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    serviceFromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate', {
        body: { propertyId: 'property-1' },
      }),
    )

    await expectJsonError(response, 403, 'Forbidden')
  })
})

describe('siteforge generate route local simulation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    serviceFromMock.mockReset()
    createClientMock.mockResolvedValue(
      createMockServerClient(authGetUserMock, { from: fromMock })
    )
    createServiceClientMock.mockReturnValue({
      from: serviceFromMock,
    })
  })

  it('POST supports deterministic local simulation mode', async () => {
    mockAuthenticatedUser(authGetUserMock)
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const propertySingleMock = vi.fn().mockResolvedValue({
      data: { id: 'property-1', name: 'P11 Demo', org_id: 'org-1' },
      error: null,
    })
    const propertyEqMock = vi.fn().mockReturnValue({ single: propertySingleMock })
    const propertySelectMock = vi.fn().mockReturnValue({ eq: propertyEqMock })

    const versionsLimitMock = vi.fn().mockResolvedValue({ data: [], error: null })
    const versionsOrderMock = vi.fn().mockReturnValue({ limit: versionsLimitMock })
    const versionsEqMock = vi.fn().mockReturnValue({ order: versionsOrderMock })
    const versionsSelectMock = vi.fn().mockReturnValue({ eq: versionsEqMock })

    const websiteInsertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'website-1' },
      error: null,
    })
    const websiteInsertSelectMock = vi.fn().mockReturnValue({ single: websiteInsertSingleMock })
    const websiteInsertMock = vi.fn().mockReturnValue({ select: websiteInsertSelectMock })

    const jobInsertSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'job-1' },
      error: null,
    })
    const jobInsertSelectMock = vi.fn().mockReturnValue({ single: jobInsertSingleMock })
    const jobInsertMock = vi.fn().mockReturnValue({ select: jobInsertSelectMock })

    serviceFromMock.mockImplementation((table: string) => {
      if (table === 'properties') {
        return { select: propertySelectMock }
      }
      if (table === 'property_websites') {
        return {
          select: versionsSelectMock,
          insert: websiteInsertMock,
        }
      }
      if (table === 'siteforge_jobs') {
        return {
          insert: jobInsertMock,
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeJsonRequest('http://localhost/api/siteforge/generate?simulate=1', {
        body: { propertyId: 'property-1', prompt: 'simulate this generation' },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        websiteId: 'website-1',
        status: 'queued',
        localSimulation: true,
      })
    )

    expect(websiteInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generation_status: 'ready_for_preview',
        generation_progress: 100,
        current_step: 'Generation complete (local simulation).',
        pages_generated: expect.arrayContaining([
          expect.objectContaining({
            slug: 'home',
          }),
        ]),
      })
    )

    expect(jobInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'complete',
        input_params: expect.objectContaining({ localSimulation: true }),
      })
    )
  })
})
