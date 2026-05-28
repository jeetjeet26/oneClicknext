import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiNaturalConnector } from './gemini-natural-connector'

const generateContentMock = vi.fn()
const getGenerativeModelMock = vi.fn(() => ({
  generateContent: generateContentMock,
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
    return {
      getGenerativeModel: getGenerativeModelMock,
    }
  }),
}))

function makeGeminiResponse(text: string) {
  return {
    response: {
      text: () => text,
      candidates: [],
      usageMetadata: { totalTokenCount: 12 },
    },
  }
}

describe('GeminiNaturalConnector', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = {
      ...originalEnv,
      GOOGLE_GEMINI_API_KEY: 'gemini-key',
      GEO_GEMINI_THROTTLE_MS: '0',
      GEO_GEMINI_BASE_BACKOFF_MS: '0',
      GEO_GEMINI_MAX_BACKOFF_MS: '0',
      GEO_GEMINI_MAX_RETRIES: '2',
    }
  })

  it('retries Gemini 429 responses before returning the natural response', async () => {
    const rateLimitError = Object.assign(new Error('429 Too Many Requests'), { status: 429 })
    generateContentMock
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(makeGeminiResponse('Gemini answer after retry'))

    const response = await new GeminiNaturalConnector().getNaturalResponse('best apartments in Austin')

    expect(response.text).toBe('Gemini answer after retry')
    expect(response.tokensUsed).toBe(12)
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })

  it('serializes concurrent Gemini provider calls through a throttle queue', async () => {
    let activeCalls = 0
    let maxActiveCalls = 0
    let releaseFirstCall!: () => void
    const firstCallReleased = new Promise<void>(resolve => {
      releaseFirstCall = resolve
    })

    generateContentMock
      .mockImplementationOnce(async () => {
        activeCalls += 1
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
        await firstCallReleased
        activeCalls -= 1
        return makeGeminiResponse('first')
      })
      .mockImplementationOnce(async () => {
        activeCalls += 1
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
        activeCalls -= 1
        return makeGeminiResponse('second')
      })

    const connector = new GeminiNaturalConnector()
    const firstResponse = connector.getNaturalResponse('first prompt')
    const secondResponse = connector.getNaturalResponse('second prompt')

    await vi.waitFor(() => {
      expect(generateContentMock).toHaveBeenCalledTimes(1)
    })

    releaseFirstCall()

    await expect(firstResponse).resolves.toEqual(expect.objectContaining({ text: 'first' }))
    await expect(secondResponse).resolves.toEqual(expect.objectContaining({ text: 'second' }))
    expect(maxActiveCalls).toBe(1)
    expect(generateContentMock).toHaveBeenCalledTimes(2)
  })
})
