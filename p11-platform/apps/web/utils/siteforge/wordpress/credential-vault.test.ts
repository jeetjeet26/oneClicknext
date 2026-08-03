import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}))
vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(() => ({ rpc: rpcMock, from: fromMock })),
}))

describe('WordPress credential references', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores encrypted credentials and exposes only an opaque reference', async () => {
    rpcMock.mockResolvedValue({
      data: '11111111-1111-4111-8111-111111111111',
      error: null,
    })
    const builder: Record<string, unknown> = {}
    builder.update = vi.fn(() => builder)
    builder.eq = vi.fn().mockResolvedValue({ error: null })
    fromMock.mockReturnValue(builder)

    const { storeWordPressCredentialReference } = await import(
      './credential-vault'
    )
    const reference = await storeWordPressCredentialReference({
      websiteId: '22222222-2222-4222-8222-222222222222',
      credentials: {
        provider: 'wordpress',
        url: 'https://preview.example.com',
        username: 'admin',
        password: 'app-password',
      },
    })

    expect(reference).toBe(
      'supabase-vault:11111111-1111-4111-8111-111111111111'
    )
    expect(reference).not.toContain('app-password')
    expect(rpcMock).toHaveBeenCalledWith(
      'store_siteforge_credential_secret',
      expect.objectContaining({
        p_secret: expect.stringContaining('app-password'),
      })
    )
  })
})
