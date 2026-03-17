import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

function makeNextRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init) as NextRequest
  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
    configurable: true,
  })
  return request
}

describe('brandforge status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
      from: fromMock,
    })
    fromMock.mockReset()
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/brandforge/status?propertyId=property-1'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { id: 'brand-1', property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/brandforge/status?propertyId=property-1'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns exists false when no brand asset exists yet', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const singleMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST116' },
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/brandforge/status?propertyId=property-1'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ exists: false })
  })

  it('returns current progress, draft metadata, and warnings', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })

    const singleMock = vi.fn().mockResolvedValue({
      data: {
        id: 'brand-1',
        property_id: 'property-1',
        generation_status: 'reviewing',
        current_step: 6,
        current_step_name: 'logo',
        draft_section: {
          step: 6,
          name: 'logo',
          version: 2,
          status: 'reviewing',
          generated_at: '2026-03-16T11:00:00.000Z',
        },
        updated_at: '2026-03-16T11:01:00.000Z',
        pdf_generated_at: null,
        brand_book_pdf_url: null,
        section_1_introduction: { content: 'intro' },
        section_2_positioning: { statement: 'positioned' },
        section_3_target_audience: null,
        section_4_personas: null,
        section_5_name_story: { name: 'Aster House' },
        section_6_logo: { primary_url: '/placeholder-logo.png' },
        section_7_typography: null,
        section_8_colors: { primary: [{ hex: '#123456' }] },
        section_9_design_elements: null,
        section_10_photo_yep: null,
        section_11_photo_nope: null,
        section_12_implementation: null,
      },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { GET } = await import('./route')
    const response = await GET(makeNextRequest('http://localhost/api/brandforge/status?propertyId=property-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      exists: true,
      brandAsset: {
        id: 'brand-1',
        currentStep: 6,
        currentStepName: 'logo',
        currentSectionTitle: 'Logo Design',
        generationStatus: 'reviewing',
        phase: 'reviewing',
        phaseLabel: 'Operator Review',
        approvedSections: 5,
        totalSections: 12,
        progress: 51,
        isComplete: false,
        pdfUrl: null,
        exportUrl: null,
        exportFormat: 'pdf',
        pdfGeneratedAt: null,
        brandName: 'Aster House',
        updatedAt: '2026-03-16T11:01:00.000Z',
        draftSection: {
          step: 6,
          name: 'logo',
          status: 'reviewing',
          version: 2,
          generatedAt: '2026-03-16T11:00:00.000Z',
          regeneratedAt: null,
        },
        statusMessage: 'Reviewing Logo Design.',
        nextRecommendedAction:
          'Review the current draft, then edit, regenerate, or approve it to continue.',
        activeSection: {
          step: 6,
          slug: 'logo',
          title: 'Logo Design',
        },
        lastActivityAt: '2026-03-16T11:00:00.000Z',
        isPossiblyStalled: false,
      },
    })
    expect(typeof body.brandAsset.secondsSinceLastActivity).toBe('number')
    expect(body.brandAsset.warnings).toEqual([
      expect.objectContaining({
        code: 'logo_placeholder_fallback',
        severity: 'warning',
      }),
    ])
  })
})
