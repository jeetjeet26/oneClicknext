import { afterEach, expect, it, vi } from 'vitest'
import { isDeliveryPaused, requireDeliveryEnabled } from './delivery-guard'
afterEach(() => vi.unstubAllEnvs())
it.each([undefined, '', 'true', 'typo'])('holds delivery unless explicitly released: %s', value => {
  if (value === undefined) delete process.env.OUTBOUND_DELIVERY_PAUSED
  else vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', value)
  expect(isDeliveryPaused()).toBe(true); expect(requireDeliveryEnabled).toThrow('paused')
})
it('allows an explicitly configured release', () => {
  vi.stubEnv('OUTBOUND_DELIVERY_PAUSED', 'false')
  expect(isDeliveryPaused()).toBe(false); expect(requireDeliveryEnabled).not.toThrow()
})
