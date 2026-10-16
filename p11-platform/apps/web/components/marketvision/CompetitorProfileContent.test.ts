import { describe, expect, it } from 'vitest'
import { readableBrandText } from './CompetitorProfileContent'

describe('historical brand presentation', () => {
  it('reads imported personality arrays as human-readable traits', () => {
    expect(readableBrandText('["Welcoming","Relaxed","Community focused"]')).toBe('Welcoming · Relaxed · Community focused')
  })
  it('preserves original prose and unrecognized source formats', () => {
    expect(readableBrandText('Warm and conversational')).toBe('Warm and conversational')
    expect(readableBrandText('{"trait":"Warm"}')).toBe('{"trait":"Warm"}')
    expect(readableBrandText(null)).toBe('')
  })
})
