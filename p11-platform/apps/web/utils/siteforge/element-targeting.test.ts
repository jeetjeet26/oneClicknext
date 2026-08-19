import { describe, expect, it } from 'vitest'
import {
  parseSiteForgeEditorPostMessage,
  siteForgeTargetId,
  siteForgeTargetSelector,
} from './element-targeting'

const box = {
  x: 10,
  y: 20,
  top: 20,
  right: 210,
  bottom: 70,
  left: 10,
  width: 200,
  height: 50,
}

describe('SiteForge element targeting', () => {
  it('builds stable nested identities without positional indexes', () => {
    const targetId = siteForgeTargetId([
      { kind: 'page', id: 'page:home' },
      { kind: 'section', id: 'section:home:hero' },
      { kind: 'repeater_item', id: 'slide:opening' },
      { kind: 'headline', id: 'headline' },
    ])

    expect(targetId).toBe(
      'page:page:home/section:section:home:hero/repeater_item:slide:opening/headline:headline'
    )
    expect(targetId).not.toMatch(/(?:^|[/:-])(?:0|1|2)(?:$|[/:-])/)
  })

  it('accepts exact target and pseudo-element postMessage payloads', () => {
    const path = [
      { kind: 'page' as const, id: 'page:home' },
      { kind: 'section' as const, id: 'section:home:hero' },
      { kind: 'cta' as const, id: 'primary' },
    ]
    const targetId = siteForgeTargetId(path)
    const parsed = parseSiteForgeEditorPostMessage({
      type: 'siteforge-editor:target-selected',
      pageSlug: 'home',
      target: {
        targetId,
        kind: 'cta',
        resourcePath: path,
        selector: siteForgeTargetSelector(targetId),
        displayValue: 'Schedule a tour',
        boundingBox: box,
        pseudo: null,
      },
      virtualTargets: [
        {
          targetId: `${targetId}::before`,
          kind: 'pseudo',
          resourcePath: path,
          selector: siteForgeTargetSelector(targetId, 'before'),
          displayValue: 'decorative before pseudo-element',
          boundingBox: box,
          pseudo: 'before',
        },
      ],
    })

    expect(parsed.type).toBe('siteforge-editor:target-selected')
    if (parsed.type !== 'siteforge-editor:target-selected') {
      throw new Error('Expected target-selected payload')
    }
    expect(parsed.virtualTargets[0]?.selector.endsWith('::before')).toBe(true)
  })

  it('fails closed for guessed selectors and incomplete resource paths', () => {
    expect(() => siteForgeTargetId([])).toThrow()
    expect(() =>
      parseSiteForgeEditorPostMessage({
        type: 'siteforge-editor:target-selected',
        pageSlug: 'home',
        target: {
          targetId: 'section:hero',
          kind: 'section',
          resourcePath: [{ kind: 'section', id: 'section:hero' }],
          selector: '.hero:nth-child(1)',
          displayValue: 'Hero',
          boundingBox: box,
          pseudo: null,
        },
        virtualTargets: [],
      })
    ).toThrow()
  })
})
