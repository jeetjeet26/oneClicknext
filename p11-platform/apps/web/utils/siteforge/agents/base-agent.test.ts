import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const {
  createServiceClientMock,
  fromMock,
  generateTextMock,
  messageCreateMock,
} = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  fromMock: vi.fn(),
  generateTextMock: vi.fn(),
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

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: generateTextMock,
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

  async callClaudeStructuredForTest() {
    return this.callClaudeStructured(
      'Create a website plan',
      z.object({
        ok: z.literal(true),
        sections: z.array(z.string()),
      }),
      {
        systemPrompt: 'Return the typed plan.',
        maxTokens: 100,
        name: 'siteforge_plan',
      }
    )
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

  it('uses AI SDK typed structured output for new generation callers', async () => {
    generateTextMock.mockResolvedValue({
      output: { ok: true, sections: ['hero'] },
    })

    const agent = new TestBaseAgent('property-1')

    await expect(agent.callClaudeStructuredForTest()).resolves.toEqual({
      ok: true,
      sections: ['hero'],
    })
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.stringContaining('anthropic/'),
        instructions: 'Return the typed plan.',
        prompt: 'Create a website plan',
        maxOutputTokens: 100,
        output: expect.objectContaining({ name: 'object' }),
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

  it('does not extract arbitrary JSON from prose for legacy callers', () => {
    const agent = new TestBaseAgent('property-1')

    expect(() =>
      agent.parseJSONForTest('Here is your result: {"ok":true}')
    ).toThrow('invalid legacy JSON')
  })
})
