import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const authGetUserMock = vi.fn()
const createClientMock = vi.fn()
const createAdminClientMock = vi.fn()
const validatePropertyAccessMock = vi.fn()
const fromMock = vi.fn()
const uploadMock = vi.fn()
const getPublicUrlMock = vi.fn()

vi.mock('@/utils/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/utils/services/auth-guard', () => ({
  validatePropertyAccess: validatePropertyAccessMock,
}))

describe('brandforge generate-pdf route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    uploadMock.mockReset()
    getPublicUrlMock.mockReset()
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    })
    createAdminClientMock.mockReturnValue({
      from: fromMock,
      storage: {
        from: vi.fn(() => ({
          upload: uploadMock,
          getPublicUrl: getPublicUrlMock,
        })),
      },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-pdf', {
        method: 'POST',
        body: JSON.stringify({ brandAssetId: 'brand-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when property access is denied', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: false })

    const singleMock = vi.fn().mockResolvedValue({
      data: { property_id: 'property-1' },
      error: null,
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-pdf', {
        method: 'POST',
        body: JSON.stringify({ brandAssetId: 'brand-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('uploads a real PDF export artifact', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    validatePropertyAccessMock.mockResolvedValue({ authorized: true })
    uploadMock.mockResolvedValue({ error: null })
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: 'https://cdn.test/brand-book.pdf' } })

    const brandRow = {
      id: 'brand-1',
      property_id: 'property-1',
      section_1_introduction: { title: 'Intro', tagline: 'Tag', story: 'Story', brandEssence: 'Essence' },
      section_2_positioning: { statement: 'Positioning', rationale: 'Because' },
      section_3_target_audience: { primary: 'Renters', demographics: { age: '25-35' }, psychographics: ['value'] },
      section_4_personas: { personas: [{ name: 'Alex', description: 'Professional', needs: 'Transit' }] },
      section_5_name_story: { name: 'Brand', tagline: 'Tagline', story: 'Origin' },
      section_6_logo: { primary_url: 'https://logo.test/logo.png' },
      section_7_typography: { headline: { font: 'Inter' } },
      section_8_colors: { primary: [{ hex: '#112233' }] },
      section_9_design_elements: { patterns: 'Pattern' },
      section_10_photo_yep: { description: 'Use bright photos', criteria: ['natural light'] },
      section_11_photo_nope: { description: 'Avoid dark photos' },
      section_12_implementation: { rollout: 'Website first' },
    }

    const selectMock = vi.fn((query: string) => {
      if (query === '*') {
        return {
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: brandRow, error: null }),
          }),
        }
      }
      return {
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    })
    const updateMock = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }))
    fromMock.mockImplementation((table: string) => {
      if (table === 'property_brand_assets') {
        return {
          select: selectMock,
          update: updateMock,
        }
      }
      return {
        select: vi.fn(),
      }
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch

    const { POST } = await import('./route')
    const response = await POST(
      new Request('http://localhost/api/brandforge/generate-pdf', {
        method: 'POST',
        body: JSON.stringify({ brandAssetId: 'brand-1' }),
      }) as NextRequest
    )

    expect(response.status).toBe(200)
    expect(uploadMock).toHaveBeenCalledTimes(1)
    const [uploadedPath, uploadedPayload, uploadOptions] = uploadMock.mock.calls[0]
    expect(uploadedPath).toContain('.pdf')
    expect(uploadedPayload).toBeInstanceOf(Uint8Array)
    expect(uploadOptions).toMatchObject({ contentType: 'application/pdf', upsert: true })
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: true,
        pdfUrl: 'https://cdn.test/brand-book.pdf',
        exportFormat: 'pdf',
      })
    )
  })
})
