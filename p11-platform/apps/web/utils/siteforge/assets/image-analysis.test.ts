import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('ai', () => ({
  generateText: generateTextMock,
  Output: {
    object: vi.fn((input) => input),
  },
}))

import { analyzeImageContent } from './image-analysis'

function pngBytes() {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 1200)
  view.setUint32(20, 800)
  return bytes
}

describe('analyzeImageContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends actual image bytes in an AI SDK image part', async () => {
    generateTextMock.mockResolvedValue({
      output: {
        suggestedRole: 'hero',
        altText: 'Apartment building entrance in daylight',
        focalPoint: { x: 0.5, y: 0.45 },
        cropSuggestion: {
          aspectRatio: '16:9',
          x: 0,
          y: 0.1,
          width: 1,
          height: 0.8,
        },
        qualityScore: 0.88,
        observedElements: ['building entrance'],
        qualityNotes: ['sharp'],
      },
    })
    const bytes = pngBytes()

    const result = await analyzeImageContent({
      bytes,
      mediaType: 'image/png',
      filename: 'https-example.png',
      model: 'anthropic/test-vision',
    })

    expect(result.mode).toBe('visual_ai')
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/test-vision',
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image',
                image: bytes,
                mediaType: 'image/png',
              }),
            ]),
          }),
        ],
      })
    )
    const request = generateTextMock.mock.calls[0]?.[0]
    const imagePart = request.messages[0].content.find(
      (part: { type: string }) => part.type === 'image'
    )
    expect(imagePart.image).toBeInstanceOf(Uint8Array)
    expect(imagePart.image).not.toEqual(expect.any(String))
  })

  it('falls back to deterministic metadata without visual claims', async () => {
    generateTextMock.mockRejectedValue(new Error('provider unavailable'))

    const result = await analyzeImageContent({
      bytes: pngBytes(),
      mediaType: 'image/png',
      filename: 'pool-and-residents.png',
      model: 'anthropic/test-vision',
    })

    expect(result).toMatchObject({
      mode: 'metadata_fallback',
      visualClaims: false,
      altText: null,
      suggestedRole: null,
      qualityScore: null,
      observedElements: [],
      metadata: { width: 1200, height: 800, byteLength: 24 },
    })
    expect(JSON.stringify(result)).not.toContain('pool')
    expect(JSON.stringify(result)).not.toContain('residents')
  })
})
