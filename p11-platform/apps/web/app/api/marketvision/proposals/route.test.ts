import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const createProposalMock = vi.fn()
const listProposalsMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

vi.mock('@/utils/services/marketvision-proposals', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/utils/services/marketvision-proposals')
  >()
  return {
    ...actual,
    createMarketVisionProposal: createProposalMock,
    listMarketVisionProposals: listProposalsMock,
  }
})

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

const validBody = {
  propertyId: 'property-1',
  proposalType: 'forgestudio_messaging_brief',
  recommendation: {
    id: 'rec-1',
    recommendationType: 'forgestudio_messaging_brief',
    title: 'Respond to concession push',
    rationale: 'Competitors added one month free.',
    impact: 0.7,
    confidence: 0.8,
    freshness: 0.9,
    reversibility: 1,
    citations: [],
  },
}

describe('marketvision proposals route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
  })

  it('POST returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/proposals', {
        method: 'POST',
        body: JSON.stringify(validBody),
      }),
    )
    expect(response.status).toBe(401)
  })

  it('POST returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })
    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/proposals', {
        method: 'POST',
        body: JSON.stringify(validBody),
      }),
    )
    expect(response.status).toBe(403)
    expect(createProposalMock).not.toHaveBeenCalled()
  })

  it('POST rejects unknown proposal types', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/proposals', {
        method: 'POST',
        body: JSON.stringify({ ...validBody, proposalType: 'auto_price_change' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(createProposalMock).not.toHaveBeenCalled()
  })

  it('POST creates a proposal frozen to the property org', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
        }),
      }),
    })
    createProposalMock.mockResolvedValue({
      sharedJobId: 'job-1',
      actionAttemptId: 'attempt-1',
      proposalType: 'forgestudio_messaging_brief',
    })

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/proposals', {
        method: 'POST',
        body: JSON.stringify(validBody),
      }),
    )

    expect(response.status).toBe(201)
    expect(createProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        propertyId: 'property-1',
        requestedBy: 'user-1',
        proposalType: 'forgestudio_messaging_brief',
      }),
    )
    const json = await response.json()
    expect(json.proposal.actionAttemptId).toBe('attempt-1')
  })

  it('POST surfaces duplicate proposals as 409', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
        }),
      }),
    })
    const { MarketVisionProposalError } = await import(
      '@/utils/services/marketvision-proposals'
    )
    createProposalMock.mockRejectedValue(
      new MarketVisionProposalError('A proposal for this recommendation already exists', 409),
    )

    const { POST } = await import('./route')
    const response = await POST(
      makeNextRequest('http://localhost/api/marketvision/proposals', {
        method: 'POST',
        body: JSON.stringify(validBody),
      }),
    )
    expect(response.status).toBe(409)
  })

  it('GET lists proposals for an authorized property', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    listProposalsMock.mockResolvedValue([
      { id: 'attempt-1', proposalDecisionStatus: 'proposed', outcomes: [] },
    ])

    const { GET } = await import('./route')
    const response = await GET(
      makeNextRequest('http://localhost/api/marketvision/proposals?propertyId=property-1'),
    )
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.proposals).toHaveLength(1)
    expect(listProposalsMock).toHaveBeenCalledWith('property-1', 20)
  })
})
