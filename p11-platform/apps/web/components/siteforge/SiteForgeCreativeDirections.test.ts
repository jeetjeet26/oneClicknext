import { describe, expect, it } from 'vitest'
import { selectedDirectionHash } from './SiteForgeCreativeDirections'

describe('SiteForgeCreativeDirections selection contract', () => {
  it('exposes only the exact selected direction hash', () => {
    const directionSet = {
      selectedDirectionId: 'direction-2',
      directions: [
        { id: 'direction-1', contentHash: 'a'.repeat(64) },
        { id: 'direction-2', contentHash: 'b'.repeat(64) },
      ],
    }
    expect(selectedDirectionHash(directionSet as never)).toBe('b'.repeat(64))
    expect(
      selectedDirectionHash({
        ...directionSet,
        selectedDirectionId: null,
      } as never)
    ).toBeNull()
  })
})
