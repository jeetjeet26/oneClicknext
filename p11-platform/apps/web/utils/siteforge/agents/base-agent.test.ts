import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceClientMock, fromMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  fromMock: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn(),
    }
  },
}))

import { BaseAgent } from './base-agent'

class TestBaseAgent extends BaseAgent {
  async readBrandForgeDataForTest() {
    return this.getBrandForgeData()
  }
}

describe('BaseAgent.getBrandForgeData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockReset()
    createServiceClientMock.mockReturnValue({
      from: fromMock,
      rpc: vi.fn(),
    })
  })

  it('returns null without retries when no brand asset row exists', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const agent = new TestBaseAgent('property-1')
    const result = await agent.readBrandForgeDataForTest()

    expect(result).toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('returns complete brand asset data when available', async () => {
    const row = {
      property_id: 'property-1',
      generation_status: 'complete',
      section_1_introduction: { headline: 'Modern living' },
    }
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: row, error: null })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const agent = new TestBaseAgent('property-1')
    const result = await agent.readBrandForgeDataForTest()

    expect(result).toEqual(row)
  })

  it('retries transient database failures before returning null', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: 'XX000',
        message: 'temporary backend failure',
        details: null,
        hint: null,
      },
    })
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    fromMock.mockReturnValue({ select: selectMock })

    const agent = new TestBaseAgent('property-1')
    const result = await agent.readBrandForgeDataForTest()

    expect(result).toBeNull()
    expect(maybeSingleMock).toHaveBeenCalledTimes(3)
  })
})
