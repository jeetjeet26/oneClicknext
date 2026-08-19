import { describe, expect, it } from 'vitest'
import { assertOwnerLaunchBinding } from './solo-step-up'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const bindingHash = 'b'.repeat(64)

describe('SiteForge owner one-button launch binding', () => {
  it('accepts the authenticated owner bound to the exact release', () => {
    expect(() =>
      assertOwnerLaunchBinding({
        actorId,
        approvedBy: actorId,
        expectedBindingHash: bindingHash,
        recordedBindingHash: bindingHash,
      })
    ).not.toThrow()
  })

  it('rejects actor substitution without requiring a second reviewer', () => {
    expect(() =>
      assertOwnerLaunchBinding({
        actorId,
        approvedBy: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        expectedBindingHash: bindingHash,
        recordedBindingHash: bindingHash,
      })
    ).toThrow('exact certified release')
  })

  it('rejects stale or tampered release identity', () => {
    expect(() =>
      assertOwnerLaunchBinding({
        actorId,
        approvedBy: actorId,
        expectedBindingHash: bindingHash,
        recordedBindingHash: 'e'.repeat(64),
      })
    ).toThrow('exact certified release')
  })
})
