import { describe, expect, it } from 'vitest'
import { currentSection } from './navigation'

describe('console navigation', () => {
  it('keeps campaign performance under Overview for direct links', () => {
    expect(currentSection('/dashboard/intelligence', 'campaigns').href).toBe('/dashboard')
  })
  it.each([undefined, 'insights', 'decisions', 'sources', 'experiments'])('keeps the other intelligence sections together (%s)', section => {
    expect(currentSection('/dashboard/intelligence', section).href).toBe('/dashboard/intelligence')
  })
})
