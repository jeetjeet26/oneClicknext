import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const {
  authorizeMock,
  bindEvidenceMock,
  createCritiqueMock,
  fromMock,
  updateMock,
  insertMock,
  upsertMock,
  rpcMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(),
  bindEvidenceMock: vi.fn(),
  createCritiqueMock: vi.fn(),
  fromMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  upsertMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/utils/siteforge/operations-auth', () => ({
  authorizeSiteForgeWebsite: authorizeMock,
}))

vi.mock('@/utils/siteforge/critique/evidence', async () => {
  const actual = await vi.importActual<
    typeof import('@/utils/siteforge/critique/evidence')
  >('@/utils/siteforge/critique/evidence')
  return {
    ...actual,
    bindRenderedCritiqueEvidence: bindEvidenceMock,
  }
})

vi.mock('@/utils/siteforge/critique/service', () => ({
  createRenderedAestheticCritique: createCritiqueMock,
}))

vi.mock('@/utils/services/request-context', () => ({
  createRequestContext: () => ({
    requestId: 'request-1',
    responseHeaders: { 'X-Request-Id': 'request-1' },
    logStart: vi.fn(),
    logSuccess: vi.fn(),
    logError: vi.fn(),
  }),
}))

const WEBSITE_ID = '11111111-1111-4111-8111-111111111111'
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222'
const EVIDENCE_ID = '33333333-3333-4333-8333-333333333333'
const CONTENT_HASH = 'a'.repeat(64)

function query(data: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
    update: updateMock,
    insert: insertMock,
    upsert: upsertMock,
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

function request(): NextRequest {
  return new Request(
    `http://localhost/api/siteforge/critique/${WEBSITE_ID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artifactId: ARTIFACT_ID,
        contentHash: CONTENT_HASH,
        certificationEvidenceId: EVIDENCE_ID,
      }),
    }
  ) as NextRequest
}

describe('POST /api/siteforge/critique/[websiteId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const service = {
      from: fromMock,
      rpc: rpcMock,
      storage: {
        from: vi.fn(() => ({
          download: vi.fn(),
        })),
      },
    }
    authorizeMock.mockResolvedValue({
      user: { id: 'user-1' },
      website: {
        id: WEBSITE_ID,
        org_id: 'org-1',
        property_id: 'property-1',
      },
      service,
    })
    fromMock.mockImplementation((table: string) => {
      if (table === 'property_websites') {
        return query({ current_artifact_version_id: ARTIFACT_ID })
      }
      if (table === 'siteforge_blueprint_versions') {
        return query({
          id: ARTIFACT_ID,
          content_hash: CONTENT_HASH,
          created_at: '2026-08-10T19:00:00.000Z',
          blueprint: {},
        })
      }
      if (table === 'siteforge_certification_evidence') {
        return query({
          id: EVIDENCE_ID,
          artifact_id: ARTIFACT_ID,
          evidence_hash: 'b'.repeat(64),
          binding_hash: 'c'.repeat(64),
          report_hash: 'd'.repeat(64),
          report: {},
          created_at: '2026-08-10T19:30:00.000Z',
        })
      }
      throw new Error(`Unexpected table ${table}`)
    })
    bindEvidenceMock.mockResolvedValue({ bound: true })
    createCritiqueMock.mockResolvedValue({
      binding: { artifactId: ARTIFACT_ID },
      findings: [],
      proposals: [],
      provider: { status: 'succeeded' },
    })
  })

  it('returns a no-store report without any direct mutation', async () => {
    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: WEBSITE_ID }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(bindEvidenceMock).toHaveBeenCalledOnce()
    expect(createCritiqueMock).toHaveBeenCalledOnce()
    expect(updateMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rejects stale client artifact identity before critique', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'property_websites') {
        return query({
          current_artifact_version_id:
            '44444444-4444-4444-8444-444444444444',
        })
      }
      if (table === 'siteforge_blueprint_versions') {
        return query({
          id: ARTIFACT_ID,
          content_hash: CONTENT_HASH,
          created_at: '2026-08-10T19:00:00.000Z',
          blueprint: {},
        })
      }
      return query({
        id: EVIDENCE_ID,
        artifact_id: ARTIFACT_ID,
        evidence_hash: 'b'.repeat(64),
        binding_hash: 'c'.repeat(64),
        report_hash: 'd'.repeat(64),
        report: {},
        created_at: '2026-08-10T19:30:00.000Z',
      })
    })

    const { POST } = await import('./route')
    const response = await POST(request(), {
      params: Promise.resolve({ websiteId: WEBSITE_ID }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'artifact_mismatch',
    })
    expect(bindEvidenceMock).not.toHaveBeenCalled()
    expect(createCritiqueMock).not.toHaveBeenCalled()
  })
})
