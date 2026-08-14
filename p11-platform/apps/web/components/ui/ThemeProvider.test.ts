import { describe, expect, it } from 'vitest'
import { themeBootstrapScript } from './ThemeProvider'

function runBootstrap(stored: string | null, prefersDark: boolean) {
  const classes = new Set<string>()
  const root = {
    classList: {
      add: (...values: string[]) => values.forEach(value => classes.add(value)),
      remove: (...values: string[]) =>
        values.forEach(value => classes.delete(value)),
    },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  }
  const execute = new Function(
    'document',
    'localStorage',
    'window',
    themeBootstrapScript
  )
  execute(
    { documentElement: root },
    { getItem: () => stored },
    { matchMedia: () => ({ matches: prefersDark }) }
  )
  return { classes, root }
}

describe('ThemeProvider bootstrap', () => {
  it('applies a stored theme deterministically', () => {
    const { classes, root } = runBootstrap('dark', false)

    expect([...classes]).toEqual(['dark'])
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('resolves invalid or absent preferences from the system', () => {
    const { classes, root } = runBootstrap('invalid', true)

    expect([...classes]).toEqual(['dark'])
    expect(root.dataset.theme).toBe('system')
    expect(root.style.colorScheme).toBe('dark')
  })
})
