import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('ai', async importOriginal => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, generateText: generateTextMock }
})

import { runSiteForgeDirectionEditorAgent } from './editor-agent'
import { siteForgeCreativeDirectionSchema } from './contracts'

const direction = siteForgeCreativeDirectionSchema.parse({
  rationale: 'A clear editorial direction.',
  typography: {
    headingFamily: 'Fraunces',
    bodyFamily: 'Inter',
    scale: 'Large',
    weightStrategy: 'Regular and medium',
  },
  palette: {
    primary: '#112233',
    secondary: '#445566',
    accent: '#778899',
    background: '#FFFFFF',
    text: '#111111',
  },
  hero: {
    composition: 'Editorial split',
    headlineStyle: 'Concise',
    mediaTreatment: 'Full bleed',
  },
  layout: { system: 'Grid', density: 'Airy', sectionRhythm: 'Measured' },
  imagery: {
    style: 'Natural',
    subjects: ['Property'],
    treatment: 'Warm',
  },
  cta: { label: 'Schedule a tour', placement: 'Hero', style: 'Filled' },
  voice: {
    traits: ['Clear', 'Human'],
    do: ['Use facts'],
    dont: ['Invent claims'],
  },
  tradeoffs: ['Requires strong photography'],
  provenance: {
    generator: 'siteforge-deterministic-directions-v1',
    briefVersionId: '11111111-1111-4111-8111-111111111111',
    briefContentHash: 'a'.repeat(64),
    onboardingSnapshotId: '22222222-2222-4222-8222-222222222222',
    onboardingSnapshotHash: 'b'.repeat(64),
    brandAssetId: '33333333-3333-4333-8333-333333333333',
    brandContractHash: 'c'.repeat(64),
  },
})

describe('SiteForge direction editor agent', () => {
  beforeEach(() => generateTextMock.mockReset())

  it('uses native structured output and summarizes an editable patch', async () => {
    generateTextMock.mockResolvedValue({
      output: {
        outcome: 'patch',
        summary: 'Made the hero warmer.',
        patch: {
          hero: {
            ...direction.hero,
            mediaTreatment: 'Warm full-bleed photography',
          },
        },
      },
    })
    const result = await runSiteForgeDirectionEditorAgent({
      instruction: 'Make the hero warmer',
      direction,
      approvedPalette: Object.values(direction.palette),
      approvedFonts: ['Fraunces', 'Inter'],
      model: 'test/model',
    })
    expect(result.outcome.outcome).toBe('patch')
    expect(result.toolSummary).toBe('direction.patch:hero')
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test/model',
        output: expect.anything(),
      })
    )
  })

  it('returns clarification without attempting free-form JSON parsing', async () => {
    generateTextMock.mockResolvedValue({
      output: {
        outcome: 'clarification',
        question: 'Should warmer mean photography, color balance, or voice?',
      },
    })
    const result = await runSiteForgeDirectionEditorAgent({
      instruction: 'Make it warmer',
      direction,
      approvedPalette: Object.values(direction.palette),
      approvedFonts: ['Fraunces', 'Inter'],
      model: 'test/model',
    })
    expect(result.outcome).toMatchObject({ outcome: 'clarification' })
    expect(result.toolSummary).toBe('direction.clarification')
  })
})
