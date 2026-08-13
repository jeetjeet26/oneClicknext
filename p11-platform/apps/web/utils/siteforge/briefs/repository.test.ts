import { describe, expect, it, vi } from 'vitest'
import {
  hashBrandForgeContract,
  normalizeBrandAssetRow,
} from '@/utils/brandforge/normalize'
import { loadCurrentBriefSources } from './repository'

function query(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333'
const BRAND_ID = '44444444-4444-4444-8444-444444444444'

const brand = {
  id: BRAND_ID,
  property_id: PROPERTY_ID,
  contract_version: '1.0',
  brand_origin: 'generated',
  approval_status: 'approved',
  approved_by: null,
  approved_at: null,
  section_1_introduction: {},
  section_2_positioning: {},
  section_3_target_audience: {},
  section_4_personas: {},
  section_5_name_story: {},
  section_6_logo: {},
  section_7_typography: {},
  section_8_colors: {},
  section_9_design_elements: {},
  section_10_photo_yep: {},
  section_11_photo_nope: {},
  section_12_implementation: {},
}

const canonicalBrandHash = hashBrandForgeContract(
  normalizeBrandAssetRow(brand)
)

describe('SiteForge brief source pinning service', () => {
  it('returns exact approved onboarding and canonical BrandForge identities', async () => {
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'property_onboarding_snapshots') {
          return query({
            data: {
              id: SNAPSHOT_ID,
              org_id: ORG_ID,
              property_id: PROPERTY_ID,
              content_hash: 'a'.repeat(64),
              brand_asset_id: BRAND_ID,
              brand_contract_hash: canonicalBrandHash,
              unresolved_conflicts: [],
            },
            error: null,
          })
        }
        if (table === 'property_brand_assets') {
          return query({
            data: { ...brand, contract_hash: canonicalBrandHash },
            error: null,
          })
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    await expect(
      loadCurrentBriefSources(
        { orgId: ORG_ID, propertyId: PROPERTY_ID },
        client as never
      )
    ).resolves.toEqual({
      onboardingSnapshotId: SNAPSHOT_ID,
      onboardingSnapshotHash: 'a'.repeat(64),
      brandAssetId: BRAND_ID,
      brandContractHash: canonicalBrandHash,
    })
  })

  it('fails closed when stored BrandForge content no longer matches its hash', async () => {
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'property_onboarding_snapshots') {
          return query({
            data: {
              id: SNAPSHOT_ID,
              org_id: ORG_ID,
              property_id: PROPERTY_ID,
              content_hash: 'a'.repeat(64),
              brand_asset_id: BRAND_ID,
              brand_contract_hash: canonicalBrandHash,
              unresolved_conflicts: [],
            },
            error: null,
          })
        }
        return query({
          data: {
            ...brand,
            section_2_positioning: { statement: 'Changed without rehashing' },
            contract_hash: canonicalBrandHash,
          },
          error: null,
        })
      }),
    }
    await expect(
      loadCurrentBriefSources(
        { orgId: ORG_ID, propertyId: PROPERTY_ID },
        client as never
      )
    ).rejects.toThrow('content no longer matches its approved hash')
  })
})
