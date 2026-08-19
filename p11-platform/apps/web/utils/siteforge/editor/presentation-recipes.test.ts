import { describe, expect, it } from 'vitest'
import {
  applyPresentationRecipeToOperations,
  resolveSiteForgePresentationRecipe,
} from './presentation-recipes'

describe('SiteForge deterministic presentation recipes', () => {
  it('resolves "left align the container" to the complete canonical field set', () => {
    const resolved = resolveSiteForgePresentationRecipe(
      'i want the container for the text left aligned'
    )
    expect(resolved).not.toBeNull()
    expect(resolved!.recipeIds).toContain('container-align-left')
    // The full set — alignment alone would bleed text to the viewport edge.
    expect(resolved!.presentation).toEqual({
      alignment: 'left',
      containerMode: 'contained',
      widthPreset: 'content',
    })
  })

  it('resolves the same request to the same field set every time', () => {
    const first = resolveSiteForgePresentationRecipe('left-align the hero text')
    const second = resolveSiteForgePresentationRecipe('left-align the hero text')
    expect(first).toEqual(second)
  })

  it('merges combined intents deterministically with the first match winning each field', () => {
    const resolved = resolveSiteForgePresentationRecipe(
      'left align the text and give it more breathing room'
    )
    expect(resolved!.presentation).toMatchObject({
      alignment: 'left',
      containerMode: 'contained',
      spacingPreset: 'spacious',
    })
  })

  it('resolves width, spacing, and motion intents', () => {
    expect(
      resolveSiteForgePresentationRecipe('make this section full width')!
        .presentation
    ).toEqual({
      containerMode: 'full-width',
      widthPreset: 'full',
      alignment: 'stretch',
    })
    expect(
      resolveSiteForgePresentationRecipe('remove the animations here')!
        .presentation
    ).toEqual({ motionPreset: 'none' })
    expect(
      resolveSiteForgePresentationRecipe('tighten the spacing a bit')!
        .presentation
    ).toEqual({ spacingPreset: 'compact' })
  })

  it('returns null for non-visual requests', () => {
    expect(
      resolveSiteForgePresentationRecipe('make the headline quippier')
    ).toBeNull()
    expect(
      resolveSiteForgePresentationRecipe('update the pet policy copy')
    ).toBeNull()
  })

  it('enforces the canonical fields onto proposed section.update operations', () => {
    const recipe = resolveSiteForgePresentationRecipe(
      'left align the hero container'
    )!
    const operations = applyPresentationRecipeToOperations(
      [
        {
          op: 'section.update',
          sectionId: 'home-hero',
          value: { presentation: { alignment: 'left' } },
        },
        {
          op: 'section.update',
          sectionId: 'home-story',
          value: { content: { headline: 'Untouched' } },
        },
      ],
      recipe
    )
    // The partial field choice is completed to the canonical set.
    expect(operations[0].value).toEqual({
      presentation: {
        alignment: 'left',
        containerMode: 'contained',
        widthPreset: 'content',
      },
    })
    // Non-presentation operations are untouched.
    expect(operations[1].value).toEqual({ content: { headline: 'Untouched' } })
  })

  it('injects the recipe into the operator-selected section when the agent omitted presentation', () => {
    const recipe = resolveSiteForgePresentationRecipe(
      'move the text over to the left'
    )!
    const operations = applyPresentationRecipeToOperations(
      [
        {
          op: 'section.update',
          sectionId: 'home-hero',
          value: { content: { headline: 'Short one' } },
        },
      ],
      recipe,
      { sectionId: 'home-hero' }
    )
    expect(operations[0].value).toMatchObject({
      content: { headline: 'Short one' },
      presentation: {
        alignment: 'left',
        containerMode: 'contained',
        widthPreset: 'content',
      },
    })
  })
})
