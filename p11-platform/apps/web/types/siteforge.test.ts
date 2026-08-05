import { describe, expect, it } from 'vitest'
import { navigationItemSchema } from './siteforge'

describe('navigationItemSchema', () => {
  it('accepts safe internal paths and HTTPS destinations', () => {
    expect(
      navigationItemSchema.safeParse({
        id: 'home',
        label: 'Home',
        href: '/home',
      }).success
    ).toBe(true)
    expect(
      navigationItemSchema.safeParse({
        id: 'partner',
        label: 'Partner',
        href: 'https://partner.example/path',
        external: true,
      }).success
    ).toBe(true)
  })

  it('rejects protocol-relative and insecure external destinations', () => {
    for (const href of ['//evil.example/path', 'http://evil.example/path']) {
      expect(
        navigationItemSchema.safeParse({
          id: 'unsafe',
          label: 'Unsafe',
          href,
          external: true,
        }).success
      ).toBe(false)
    }
  })
})
