import { describe, expect, it } from 'vitest'
import {
  resolveSiteForgeSemanticEditorModel,
  resolveSiteForgeSemanticEditorTier,
  siteForgeSemanticEditorEscalationTier,
} from './models'

describe('SiteForge semantic editor model policy', () => {
  it('uses Sonnet 5 for targeted copy edits', () => {
    expect(
      resolveSiteForgeSemanticEditorTier({
        scope: 'section',
        userIntent: 'Change this headline to Welcome home',
      })
    ).toBe('targeted')
    expect(resolveSiteForgeSemanticEditorModel('targeted')).toBe(
      'claude-sonnet-5'
    )
  })

  it('uses the structural tier for layout and page edits', () => {
    expect(
      resolveSiteForgeSemanticEditorTier({
        scope: 'page',
        userIntent: 'Move this section below the amenities section',
      })
    ).toBe('structural')
    expect(resolveSiteForgeSemanticEditorModel('structural')).toBe(
      'claude-sonnet-5'
    )
  })

  it('reserves Fable for creative whole-site work', () => {
    expect(
      resolveSiteForgeSemanticEditorTier({
        scope: 'site',
        userIntent: 'Redesign the whole site with a new creative direction',
      })
    ).toBe('creative')
    expect(resolveSiteForgeSemanticEditorModel('creative')).toBe(
      'claude-fable-5'
    )
  })

  it('escalates at most one tier per failed attempt', () => {
    expect(siteForgeSemanticEditorEscalationTier('targeted')).toBe('structural')
    expect(siteForgeSemanticEditorEscalationTier('structural')).toBe('creative')
    expect(siteForgeSemanticEditorEscalationTier('creative')).toBeNull()
  })
})
