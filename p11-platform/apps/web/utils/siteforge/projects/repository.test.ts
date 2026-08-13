import { describe, expect, it, vi } from 'vitest'
import { createOrReuseSiteForgeProject } from './repository'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '33333333-3333-3333-3333-333333333333'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'

function query(result: unknown, onInsert?: (value: unknown) => void) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.insert = vi.fn((value: unknown) => {
    onInsert?.(value)
    return chain
  })
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

const shellRow = {
  id: WEBSITE_ID,
  org_id: ORG_ID,
  property_id: PROPERTY_ID,
  generation_status: 'queued',
  generation_progress: 0,
  current_step: 'Planning project',
  version: 1,
  created_at: '2026-08-10T00:00:00.000Z',
}

describe('SiteForge project shell repository', () => {
  it('reuses a property-owned pre-artifact planning shell', async () => {
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({
            data: { id: PROPERTY_ID, org_id: ORG_ID },
            error: null,
          })
        )
        .mockReturnValueOnce(query({ data: shellRow, error: null })),
    }

    await expect(
      createOrReuseSiteForgeProject(
        { orgId: ORG_ID, propertyId: PROPERTY_ID },
        client as never
      )
    ).resolves.toEqual({
      reused: true,
      project: {
        websiteId: WEBSITE_ID,
        orgId: ORG_ID,
        propertyId: PROPERTY_ID,
        status: 'planning',
        generationStatus: 'queued',
        generationProgress: 0,
        currentStep: 'Planning project',
        version: 1,
        createdAt: '2026-08-10T00:00:00.000Z',
      },
    })
  })

  it('creates the next minimal shell when no reusable project exists', async () => {
    const inserted = vi.fn()
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(
          query({
            data: { id: PROPERTY_ID, org_id: ORG_ID },
            error: null,
          })
        )
        .mockReturnValueOnce(query({ data: null, error: null }))
        .mockReturnValueOnce(query({ data: { version: 4 }, error: null }))
        .mockReturnValueOnce(query({ data: shellRow, error: null }, inserted)),
    }

    const result = await createOrReuseSiteForgeProject(
      { orgId: ORG_ID, propertyId: PROPERTY_ID },
      client as never
    )

    expect(result.reused).toBe(false)
    expect(result.project.websiteId).toBe(WEBSITE_ID)
    expect(inserted).toHaveBeenCalledWith({
      org_id: ORG_ID,
      property_id: PROPERTY_ID,
      version: 5,
      generation_status: 'queued',
      generation_progress: 0,
      current_step: 'Planning project',
    })
  })
})
