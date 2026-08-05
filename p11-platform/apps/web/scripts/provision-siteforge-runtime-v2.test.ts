import { describe, expect, it, vi } from 'vitest'
import { selectLatestPublishedRuntimeV2Package } from './provision-siteforge-runtime-v2'

describe('SiteForge runtime v2 package selection', () => {
  it('selects only published, non-revoked contract v2 packages', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { version: '2.0.1', package_sha256: 'a'.repeat(64) },
        error: null,
      }),
    }
    for (const method of ['select', 'eq', 'is', 'order', 'limit'] as const) {
      query[method].mockReturnValue(query)
    }
    const client = {
      from: vi.fn().mockReturnValue(query),
    }

    await selectLatestPublishedRuntimeV2Package(client as never)

    expect(client.from).toHaveBeenCalledWith('siteforge_runtime_packages')
    expect(query.eq).toHaveBeenCalledWith('package_type', 'runtime_plugin')
    expect(query.eq).toHaveBeenCalledWith('runtime_contract_version', 2)
    expect(query.eq).toHaveBeenCalledWith('publication_status', 'published')
    expect(query.is).toHaveBeenCalledWith('revoked_at', null)
    expect(query.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    })
  })
})
