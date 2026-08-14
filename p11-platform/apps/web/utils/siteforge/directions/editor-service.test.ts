import { describe, expect, it, vi } from 'vitest'
import { normalizeBrandForgeContract, hashBrandForgeContract } from '@/utils/brandforge/normalize'
import { brandContractToStorageSections } from '@/utils/brandforge/normalize'

const getDirectionSetMock = vi.hoisted(() => vi.fn())

vi.mock('./repository', async importOriginal => {
  const actual = await importOriginal<typeof import('./repository')>()
  return { ...actual, getSiteForgeDirectionSet: getDirectionSetMock }
})

import {
  editSiteForgeCreativeDirection,
  selectSiteForgeCreativeDirectionAlternative,
} from './editor-service'
import {
  deriveSiteForgeDirectionPreview,
  hashSiteForgeDirection,
  hashSiteForgeDirectionSet,
  siteForgeCreativeDirectionSchema,
} from './contracts'

const contract = normalizeBrandForgeContract(
  {
    typography: {
      roles: [
        { role: 'headline', family: 'Fraunces', weights: [600], usage: 'Headings' },
        { role: 'body', family: 'Inter', weights: [400], usage: 'Body' },
      ],
    },
    colors: {
      roles: [
        { role: 'primary', name: 'Ink', hex: '#112233', usage: 'Primary' },
        { role: 'secondary', name: 'Slate', hex: '#445566', usage: 'Secondary' },
        { role: 'accent', name: 'Mist', hex: '#778899', usage: 'Accent' },
        { role: 'background', name: 'White', hex: '#FFFFFF', usage: 'Background' },
        { role: 'text', name: 'Black', hex: '#111111', usage: 'Text' },
      ],
    },
  },
  { origin: 'generated', approvalStatus: 'approved' }
)

function candidate(id: string, ordinal: number, name: string) {
  const direction = siteForgeCreativeDirectionSchema.parse({
    rationale: `${name} rationale`,
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
      composition: ordinal === 1 ? 'Editorial split' : 'Modular panel',
      headlineStyle: 'Concise',
      mediaTreatment: 'Natural photography',
    },
    layout: {
      system: ordinal === 1 ? 'Offset grid' : 'Modular cards',
      density: 'Airy',
      sectionRhythm: 'Measured',
    },
    imagery: { style: 'Natural', subjects: ['Property'], treatment: 'Warm' },
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
      brandContractHash: hashBrandForgeContract(contract),
    },
  })
  const previewManifest = deriveSiteForgeDirectionPreview(direction)
  return {
    id,
    ordinal,
    name,
    direction,
    previewManifest,
    contentHash: hashSiteForgeDirection({
      ordinal,
      name,
      direction,
      previewManifest,
    }),
  }
}

describe('SiteForge direction editor service', () => {
  it('preserves alternatives and provenance while applying one atomic revision', async () => {
    const selected = candidate('direction-1', 1, 'Editorial Confidence')
    const alternative = candidate('direction-2', 2, 'Conversion Clarity')
    const current = {
      id: 'set-1',
      orgId: 'org-1',
      propertyId: 'property-1',
      websiteId: 'website-1',
      briefVersionId: selected.direction.provenance.briefVersionId,
      version: 1,
      status: 'ready_for_review',
      selectionNotes: 'Recommended for balance.',
      selectedDirectionId: selected.id,
      contentHash: hashSiteForgeDirectionSet({
        briefVersionId: selected.direction.provenance.briefVersionId,
        briefContentHash: selected.direction.provenance.briefContentHash,
        directionHashes: [selected.contentHash, alternative.contentHash],
        selectedDirectionHash: selected.contentHash,
        selectionNotes: 'Recommended for balance.',
      }),
      directions: [selected, alternative],
    }
    const rpc = vi.fn(async (_name, args) => ({
      data: [{ id: 'set-2', version: 2, ...args }],
      error: null,
    }))
    const brandRow = {
      id: selected.direction.provenance.brandAssetId,
      property_id: current.propertyId,
      approval_status: 'approved',
      brand_origin: 'generated',
      ...brandContractToStorageSections(contract),
    }
    const client = {
      from: vi.fn((table: string) => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          single: vi.fn(async () => ({ data: brandRow, error: null })),
          maybeSingle: vi.fn(async () => ({
            data: table === 'shared_jobs' ? null : brandRow,
            error: null,
          })),
        }
        return chain
      }),
      rpc,
    }
    const revised = {
      ...current,
      id: 'set-2',
      version: 2,
      directions: current.directions,
    }
    getDirectionSetMock
      .mockReset()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(revised)

    const result = await editSiteForgeCreativeDirection(
      {
        directionSetId: current.id,
        propertyId: current.propertyId,
        selectedDirectionId: selected.id,
        expectedSetContentHash: current.contentHash,
        expectedDirectionContentHash: selected.contentHash,
        clientRequestId: 'edit-request-1',
        instruction: 'Make the hero warmer',
        actorId: 'actor-1',
      },
      client as never,
      vi.fn(async () => ({
        outcome: {
          outcome: 'patch' as const,
          summary: 'Made the hero warmer.',
          patch: {
            hero: {
              ...selected.direction.hero,
              mediaTreatment: 'Warm natural photography',
            },
          },
        },
        model: 'test/model',
        toolSummary: 'direction.patch:hero',
      }))
    )

    expect(result.outcome).toMatchObject({ outcome: 'patch' })
    const rpcArgs = rpc.mock.calls[0]![1] as {
      p_candidates: Array<Record<string, unknown>>
    }
    expect(rpcArgs.p_candidates[1]).toMatchObject({
      contentHash: alternative.contentHash,
      direction: alternative.direction,
    })
    expect(
      (rpcArgs.p_candidates[0]!.direction as typeof selected.direction).provenance
    ).toEqual(selected.direction.provenance)
  })

  it('rejects stale selected hashes before invoking the model', async () => {
    const selected = candidate('direction-1', 1, 'Editorial Confidence')
    getDirectionSetMock.mockReset().mockResolvedValue({
      id: 'set-1',
      propertyId: 'property-1',
      selectedDirectionId: selected.id,
      contentHash: 'a'.repeat(64),
      directions: [selected],
    })
    const runAgent = vi.fn()
    await expect(
      editSiteForgeCreativeDirection(
        {
          directionSetId: 'set-1',
          propertyId: 'property-1',
          selectedDirectionId: selected.id,
          expectedSetContentHash: 'a'.repeat(64),
          expectedDirectionContentHash: 'b'.repeat(64),
          clientRequestId: 'edit-request-2',
          instruction: 'Change it',
          actorId: 'actor-1',
        },
        {} as never,
        runAgent
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(runAgent).not.toHaveBeenCalled()
  })

  it('creates an immutable selection revision for an existing alternative', async () => {
    const selected = candidate('direction-1', 1, 'Editorial Confidence')
    const alternative = candidate('direction-2', 2, 'Conversion Clarity')
    const current = {
      id: 'set-1',
      orgId: 'org-1',
      propertyId: 'property-1',
      websiteId: 'website-1',
      briefVersionId: selected.direction.provenance.briefVersionId,
      version: 1,
      status: 'ready_for_review',
      selectionNotes: 'Recommended for balance.',
      selectedDirectionId: selected.id,
      contentHash: hashSiteForgeDirectionSet({
        briefVersionId: selected.direction.provenance.briefVersionId,
        briefContentHash: selected.direction.provenance.briefContentHash,
        directionHashes: [selected.contentHash, alternative.contentHash],
        selectedDirectionHash: selected.contentHash,
        selectionNotes: 'Recommended for balance.',
      }),
      directions: [selected, alternative],
    }
    const rpc = vi.fn(async () => ({
      data: [{ id: 'set-2', version: 2 }],
      error: null,
    }))
    getDirectionSetMock
      .mockReset()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({
        ...current,
        id: 'set-2',
        version: 2,
        selectedDirectionId: alternative.id,
      })

    const result = await selectSiteForgeCreativeDirectionAlternative(
      {
        directionSetId: current.id,
        propertyId: current.propertyId,
        selectedDirectionId: selected.id,
        alternativeDirectionId: alternative.id,
        expectedSetContentHash: current.contentHash,
        expectedDirectionContentHash: selected.contentHash,
        clientRequestId: 'alternative-request-1',
        actorId: 'actor-1',
      },
      { rpc } as never,
    )

    expect(result.outcome.summary).toBe('Selected Conversion Clarity.')
    expect(rpc).toHaveBeenCalledWith(
      'apply_siteforge_direction_edit',
      expect.objectContaining({
        p_selected_ordinal: 2,
        p_model: 'deterministic-alternative-selection-v1',
      }),
    )
  })
})
