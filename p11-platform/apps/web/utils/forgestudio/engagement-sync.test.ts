import { describe, expect, it } from 'vitest'
import { calculatePublicationKpis } from './engagement-sync'

describe('ForgeStudio engagement outcomes', () => {
  it('calculates normalized engagement, click, and completion rates', () => {
    expect(calculatePublicationKpis({
      impressions: 1000,
      reach: 800,
      clicks: 50,
      reactions: 70,
      comments: 10,
      shares: 15,
      saves: 5,
      video_views: 400,
      video_completions: 100,
    })).toEqual({
      engagement_rate: 0.1,
      click_through_rate: 0.05,
      video_completion_rate: 0.25,
    })
  })

  it('does not invent rates when a denominator is unavailable', () => {
    expect(calculatePublicationKpis({
      impressions: 0,
      reach: 0,
      clicks: 0,
      reactions: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      video_views: 0,
      video_completions: 0,
    })).toEqual({
      engagement_rate: null,
      click_through_rate: null,
      video_completion_rate: null,
    })
  })
})
