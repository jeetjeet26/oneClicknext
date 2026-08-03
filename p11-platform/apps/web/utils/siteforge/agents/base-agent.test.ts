import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createServiceClientMock, fromMock, messageCreateMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  fromMock: vi.fn(),
  messageCreateMock: vi.fn(),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: createServiceClientMock,
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: messageCreateMock,
    }
  },
}))

import { BaseAgent } from './base-agent'

class TestBaseAgent extends BaseAgent {
  async readBrandForgeDataForTest() {
    return this.getBrandForgeData()
  }

  async callClaudeForTest() {
    return this.callClaude('Create a website plan', {
      systemPrompt: 'Return JSON.',
      maxTokens: 100,
      jsonMode: true,
    })
  }

  parseJSONForTest<T>(response: string) {
    return this.parseJSON<T>(response, 'TestAgent')
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

    expect(result).toEqual(expect.objectContaining({
      property_id: row.property_id,
      generation_status: row.generation_status,
      contract: expect.objectContaining({ contractVersion: '1.0' }),
      section_1_introduction: expect.objectContaining({
        headline: 'Modern living',
      }),
    }))
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

describe('BaseAgent.callClaude', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createServiceClientMock.mockReturnValue({
      from: fromMock,
      rpc: vi.fn(),
    })
  })

  it('avoids deprecated sampling and assistant prefill parameters', async () => {
    messageCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"ok":true}' }],
    })

    const agent = new TestBaseAgent('property-1')
    await expect(agent.callClaudeForTest()).resolves.toBe('{"ok":true}')

    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ temperature: expect.anything() })
    )
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Create a website plan' }],
      })
    )
  })

  it('repairs literal control characters inside Fable JSON strings', () => {
    const agent = new TestBaseAgent('property-1')
    const response = '{"css":"line one\nline two\tindented","url":"https://example.com/image"}'

    expect(agent.parseJSONForTest<{ css: string; url: string }>(response)).toEqual({
      css: 'line one\nline two\tindented',
      url: 'https://example.com/image',
    })
  })
})
