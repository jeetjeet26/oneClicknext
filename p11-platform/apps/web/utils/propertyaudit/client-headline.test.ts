import { describe, expect, it } from 'vitest'
import {
  buildClientHeadline,
  buildHeadlineRates,
  isDiscoveryQuery,
  isGenericCityCategoryQuery,
} from './client-headline'
import type { HeadlineAnswer } from './client-headline'

function answer(overrides: Partial<HeadlineAnswer> & Pick<HeadlineAnswer, 'presence'>): HeadlineAnswer {
  return {
    llm_rank: null,
    link_rank: null,
    sov: null,
    flags: [],
    ...overrides,
  }
}

describe('client headline helpers', () => {
  it('treats weight <= 0.8 category prompts as generic city queries', () => {
    expect(isGenericCityCategoryQuery({ type: 'category', text: 'Best apartments in San Diego', weight: 0.8 })).toBe(true)
    expect(isDiscoveryQuery({ type: 'category', text: 'Best apartments in San Diego', weight: 0.8 })).toBe(false)
    expect(isDiscoveryQuery({ type: 'category', text: 'Pet-friendly apartments in Kearny Mesa', weight: 1.2 })).toBe(true)
    expect(isDiscoveryQuery({ type: 'local', text: 'Best place to live in Kearny Mesa' })).toBe(true)
    expect(isDiscoveryQuery({ type: 'comparison', text: 'Epoca vs Competitor' })).toBe(false)
  })

  it('splits branded recognition from discovery mention after collapse', () => {
    const rates = buildHeadlineRates([
      answer({
        presence: true,
        presence_rate: 1,
        llm_rank: 1,
        geo_queries: { type: 'branded', text: 'What is Epoca?' },
      }),
      answer({
        presence: false,
        presence_rate: 0.2,
        geo_queries: { type: 'category', text: 'Luxury homes in Otay Ranch', weight: 1.2 },
      }),
      answer({
        presence: false,
        presence_rate: 0,
        geo_queries: { type: 'category', text: 'Best apartments in San Diego', weight: 0.8 },
      }),
    ])

    expect(rates.brandedRecognitionPct).toBe(100)
    expect(rates.discoveryMentionPct).toBe(20)
    expect(rates.genericCityMentionPct).toBe(0)
  })

  it('averages sellable surfaces including Claude', () => {
    const headline = buildClientHeadline([
      {
        surface: 'claude',
        answers: [answer({ presence: true, presence_rate: 1, geo_queries: { type: 'branded', text: 'What is Epoca?' } })],
      },
      {
        surface: 'chatgpt',
        answers: [answer({ presence: true, presence_rate: 1, llm_rank: 1, geo_queries: { type: 'branded', text: 'What is Epoca?' } })],
      },
      {
        surface: 'openai',
        answers: [answer({ presence: false, presence_rate: 0, geo_queries: { type: 'branded', text: 'What is Epoca?' } })],
      },
    ])

    expect(headline.surfaces.map(surface => surface.surface)).toEqual(['claude', 'chatgpt'])
    expect(headline.brandedRecognitionPct).toBe(100)
  })
})
