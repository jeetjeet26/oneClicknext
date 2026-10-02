import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  property: { currentProperty: { id: 'example', name: 'Example Community' }, loading: false, hasLoadedProperties: true },
}))
vi.mock('@/components/layout/PropertyContext', () => ({ usePropertyContext: () => state.property }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import SiteForgePage from './page'

describe('SiteForge entry flow', () => {
  it('prepares a client handoff and retains access to earlier console records', () => {
    state.property.loading = false
    const html = renderToStaticMarkup(React.createElement(SiteForgePage))
    expect(html).toContain('Copy brief for Codex')
    expect(html).toContain('Example Community')
    expect(html).toContain('Earlier console projects')
    expect(html).not.toContain('Start New Website')
    expect(html).not.toContain('just 3 minutes')
  })

  it('does not export the shared context’s demo fallback when real properties are unavailable', () => {
    state.property.hasLoadedProperties = false
    const html = renderToStaticMarkup(React.createElement(SiteForgePage))
    expect(html).toContain('Your property records are unavailable')
    expect(html).not.toContain('Copy brief for Codex')
    state.property.hasLoadedProperties = true
  })

  it('does not offer a brief for a property still being loaded' , () => {
    state.property.loading = true
    const html = renderToStaticMarkup(React.createElement(SiteForgePage))
    expect(html).toContain('Loading your property')
    expect(html).not.toContain('Copy brief for Codex')
    state.property.loading = false
  })
})
