import { describe, expect, it } from 'vitest'
import { canSiteForgeActAutomatically } from '@/utils/siteforge/autonomy-policy'
import { assertOwnerLaunchBinding } from '@/utils/siteforge/launch/solo-step-up'
import { FOR_SALE_CONVERSION_LANES } from '@/utils/siteforge/providers/conversion-intents'

describe('Autonomous SiteForge two-lane acceptance contract', () => {
  it('allows machine policy for internal production work but never auto-clicks Launch', () => {
    expect(
      canSiteForgeActAutomatically(
        'siteforge.internal.creative_commissioning',
        'bounded_auto'
      )
    ).toBe(true)
    expect(
      canSiteForgeActAutomatically(
        'siteforge.production.launch',
        'bounded_auto'
      )
    ).toBe(false)
  })

  it('binds the one owner action to the exact certified release', () => {
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const bindingHash = 'b'.repeat(64)
    expect(() =>
      assertOwnerLaunchBinding({
        actorId: owner,
        approvedBy: owner,
        expectedBindingHash: bindingHash,
        recordedBindingHash: bindingHash,
      })
    ).not.toThrow()
  })

  it('exposes complete for-sale conversion handoffs', () => {
    expect(Object.keys(FOR_SALE_CONVERSION_LANES)).toEqual(
      expect.arrayContaining([
        'registration',
        'sales_inquiry',
        'appointment',
        'brochure_download',
        'home_save',
        'plan_save',
        'broker_handoff',
      ])
    )
  })
})
