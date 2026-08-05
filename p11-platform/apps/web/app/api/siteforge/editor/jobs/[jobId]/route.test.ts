import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  createClient,
  createServiceClient,
  getUser,
  serviceFrom,
  validateAccess,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getUser: vi.fn(),
  serviceFrom: vi.fn(),
  validateAccess: vi.fn(),
}))

vi.mock('@/utils/supabase/server', () => ({ createClient }))
vi.mock('@/utils/supabase/admin', () => ({ createServiceClient }))
vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validateAccess,
}))

const jobId = '11111111-1111-4111-8111-111111111111'
const propertyId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const job = {
  id: jobId,
  property_id: propertyId,
  subject_id: '44444444-4444-4444-8444-444444444444',
  lifecycle_status: 'running',
  progress: 50,
}
const message = {
  id: '55555555-5555-4555-8555-555555555555',
  status: 'processing',
}

function query(result: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn(async () => result)
  builder.maybeSingle = vi.fn(async () => result)
  return builder
}

function request(): NextRequest {
  return new Request(`http://localhost/api/siteforge/editor/jobs/${jobId}`) as NextRequest
}

function context(id = jobId) {
  return { params: Promise.resolve({ jobId: id }) }
}

describe('SiteForge semantic editor job route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SITEFORGE_SEMANTIC_EDITOR_ENABLED', 'true')
    createClient.mockResolvedValue({ auth: { getUser } })
    createServiceClient.mockReturnValue({ from: serviceFrom })
    getUser.mockResolvedValue({ data: { user: { id: userId } } })
    validateAccess.mockResolvedValue({ authorized: true })
    serviceFrom.mockImplementation((table: string) =>
      table === 'shared_jobs'
        ? query({ data: job, error: null })
        : query({ data: message, error: null })
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('validates the job identifier before authentication', async () => {
    const { GET } = await import('./route')
    const response = await GET(request(), context('not-a-uuid'))

    expect(response.status).toBe(400)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('requires authentication before loading an editor job', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import('./route')
    const response = await GET(request(), context())

    expect(response.status).toBe(401)
    expect(createServiceClient).not.toHaveBeenCalled()
  })

  it('does not return a job outside the user property access', async () => {
    validateAccess.mockResolvedValue({ authorized: false })
    const { GET } = await import('./route')
    const response = await GET(request(), context())

    expect(response.status).toBe(403)
    expect(validateAccess).toHaveBeenCalledWith(userId, propertyId)
  })

  it('returns the authorized job and related editor message without caching', async () => {
    const { GET } = await import('./route')
    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ job, message })
  })
})
