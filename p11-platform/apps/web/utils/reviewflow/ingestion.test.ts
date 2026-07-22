import { describe, expect, it } from 'vitest'
import { reviewContentFingerprint } from './ingestion'
import { derivePriority, slaDueAtForPriority } from './taxonomy'

describe('reviewContentFingerprint', () => {
  const base = {
    platform: 'google',
    reviewerName: 'Jane Resident',
    reviewDate: '2026-07-01',
    reviewText: 'Great maintenance team.',
    rating: 5,
  }

  it('is deterministic for identical content', () => {
    expect(reviewContentFingerprint(base)).toBe(reviewContentFingerprint({ ...base }))
  })

  it('changes when any identity-bearing field changes', () => {
    const original = reviewContentFingerprint(base)
    expect(reviewContentFingerprint({ ...base, reviewText: 'Different text.' })).not.toBe(original)
    expect(reviewContentFingerprint({ ...base, reviewerName: 'John' })).not.toBe(original)
    expect(reviewContentFingerprint({ ...base, rating: 1 })).not.toBe(original)
    expect(reviewContentFingerprint({ ...base, platform: 'yelp' })).not.toBe(original)
  })

  it('handles null fields without throwing', () => {
    const fp = reviewContentFingerprint({
      platform: 'other',
      reviewerName: null,
      reviewDate: null,
      reviewText: 'text only',
      rating: null,
    })
    expect(typeof fp).toBe('string')
    expect(fp.length).toBeGreaterThan(0)
  })
})

describe('taxonomy priority + SLA', () => {
  it('derives urgent priority for urgent critical reviews', () => {
    const priority = derivePriority({ severity: 'critical', isUrgent: true, sentiment: 'negative' })
    expect(priority).toBe('urgent')
  })

  it('derives low priority for positive routine reviews', () => {
    const priority = derivePriority({ severity: 'low', isUrgent: false, sentiment: 'positive' })
    expect(['low', 'medium']).toContain(priority)
  })

  it('produces a future SLA deadline for each priority', () => {
    for (const priority of ['urgent', 'high', 'medium', 'low'] as const) {
      const dueAt = slaDueAtForPriority(priority)
      expect(new Date(dueAt).getTime()).toBeGreaterThan(Date.now())
    }
  })
})
