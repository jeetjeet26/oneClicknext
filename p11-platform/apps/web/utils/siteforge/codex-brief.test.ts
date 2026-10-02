import { describe, expect, it } from 'vitest'
import { buildSiteForgeCodexBrief, siteForgeBriefFilename, type SiteForgeBriefInput } from './codex-brief'

const input: SiteForgeBriefInput = {
  property: { id: 'property-1', name: 'Example Community', city: 'Torrance' },
  request: 'Revise only the gallery and preserve the homepage.',
  references: 'Use the supplied design.pdf and current WordPress content.',
  target: 'wordpress',
}

describe('SiteForge client handoff', () => {
  it('carries the exact selected property and requested scope into portable context', () => {
    const brief = buildSiteForgeCodexBrief(input)
    const context = JSON.parse(brief.match(/```json\n([\s\S]*?)\n```/)![1])
    expect(context.consoleProperty).toEqual(input.property)
    expect(context.requestedWork).toBe(input.request)
    expect(context.referencesAndSourceNotes).toBe(input.references)
    expect(brief).toContain('native WordPress site')
    expect(brief).toContain('gallery thumbnails and ordering')
    expect(brief).toContain('unsaved previews')
  })

  it('preserves delivery context without converting unknowns or a named destination into permission', () => {
    const delivery = { projectLocation: 'Review target and source folder: ```notes```', contentOwnership: 'Client edits existing ACF fields; owner confirms inventory.', inquiryDestination: 'Inbox to confirm before testing' }
    const brief = buildSiteForgeCodexBrief({ ...input, delivery })
    const context = JSON.parse(brief.match(/````json\n([\s\S]*?)\n````/)![1])
    expect(context.deliveryNotes).toEqual(delivery)
    const unknown = buildSiteForgeCodexBrief(input)
    expect(JSON.parse(unknown.match(/```json\n([\s\S]*?)\n```/)![1]).deliveryNotes).toEqual({ projectLocation: null, contentOwnership: null, inquiryDestination: null })
    expect(brief).toContain('Naming a website or recipient does not authorize')
  })

  it('carries revision boundaries and parent references without inventing a saved backup', () => {
    const revision = { keepUnchanged: '  Keep the pricing and inquiry flow.  ', parentVersion: 'Approved review dated September 8' }
    const brief = buildSiteForgeCodexBrief({ ...input, revision })
    const context = JSON.parse(brief.match(/```json\n([\s\S]*?)\n```/)![1])
    expect(context.revisionNotes).toEqual({ keepUnchanged: revision.keepUnchanged.trim(), parentVersion: revision.parentVersion })
    expect(brief).toContain('not an already-created backup')
    const blank = buildSiteForgeCodexBrief(input)
    expect(JSON.parse(blank.match(/```json\n([\s\S]*?)\n```/)![1]).revisionNotes).toEqual({ keepUnchanged: null, parentVersion: null })
  })

  it('preserves nested fences in supplied notes without closing the context block', () => {
    const references = 'Review this example:\n````md\n# Notes\n````'
    const brief = buildSiteForgeCodexBrief({ ...input, references })
    const context = JSON.parse(brief.match(/`````json\n([\s\S]*?)\n`````/)![1])
    expect(context.referencesAndSourceNotes).toBe(references)
  })

  it('does not invent missing facts or an inquiry destination', () => {
    const brief = buildSiteForgeCodexBrief({ ...input, property: { id: 'property-2', name: 'New project' }, references: '' })
    const context = JSON.parse(brief.match(/```json\n([\s\S]*?)\n```/)![1])
    expect(context.consoleProperty.city).toBeNull()
    expect(context.referencesAndSourceNotes).toBeNull()
    expect(brief).toContain('when delivery is unconfigured, show an honest preview state')
    expect(brief).toContain('does not authorize deployment')
    expect(brief).not.toMatch(/https?:\/\//)
  })

  it('keeps standalone and existing-stack instructions appropriate to the target', () => {
    expect(buildSiteForgeCodexBrief({ ...input, target: 'standalone' })).toContain('Do not assume edits in a separate WordPress site will update this site')
    expect(buildSiteForgeCodexBrief({ ...input, target: 'existing' })).toContain('Preserve the client project’s existing stack and content model')
  })

  it('requires a request and property before creating a handoff', () => {
    expect(() => buildSiteForgeCodexBrief({ ...input, request: '  ' })).toThrow('Describe the website work')
    expect(() => buildSiteForgeCodexBrief({ ...input, property: { id: '', name: '' } })).toThrow('Select a property')
  })

  it('produces bounded download names without path traversal', () => {
    expect(siteForgeBriefFilename('../../Élan / Residences')).toBe('elan-residences-siteforge-brief.md')
    expect(siteForgeBriefFilename('🏡')).toBe('client-siteforge-brief.md')
    expect(siteForgeBriefFilename('A'.repeat(200))).toHaveLength(99)
  })
})
