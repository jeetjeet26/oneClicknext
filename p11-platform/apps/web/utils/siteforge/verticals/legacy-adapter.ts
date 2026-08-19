import type { PropertyType } from '@/utils/property-types'
import type { PropertySubjectKind } from '@/utils/real-estate/contracts'
import type { VerticalCompositionRequest } from './contracts'
import { VERTICAL_REGISTRY_VERSION } from './registry'

export type LegacyVerticalPackResolution =
  | {
      status: 'resolved'
      reason: string
      request: VerticalCompositionRequest
    }
  | {
      status: 'needs_review'
      reason: string
      questionIds: string[]
    }

const scopeBySubjectKind = {
  real_estate_property: 'property',
  real_estate_development: 'development',
  real_estate_portfolio: 'portfolio',
  business_location: 'property',
  other: 'corporate',
} as const

function request(
  values: Omit<
    VerticalCompositionRequest,
    'registryVersion' | 'confirmedOverride'
  >
): VerticalCompositionRequest {
  return {
    registryVersion: VERTICAL_REGISTRY_VERSION,
    ...values,
    confirmedOverride: null,
  }
}

export function legacyPropertyTypeToPackSelection(
  propertyType: PropertyType | null,
  subjectKind: PropertySubjectKind = 'real_estate_property'
): LegacyVerticalPackResolution {
  const scope = scopeBySubjectKind[subjectKind]
  if (
    subjectKind === 'real_estate_portfolio' ||
    subjectKind === 'other'
  ) {
    return {
      status: 'needs_review',
      reason:
        'Legacy property type cannot determine a portfolio or corporate subject composition.',
      questionIds: [
        'legacy.question.confirm_scope',
        'legacy.question.confirm_sector',
        'legacy.question.confirm_transaction',
      ],
    }
  }

  switch (propertyType) {
    case 'multifamily':
      return {
        status: 'resolved',
        reason: 'Legacy multifamily deterministically maps to rental multifamily.',
        request: request({
          scope,
          sector: 'residential',
          transaction: 'rental',
          archetype: 'rental_multifamily',
          modifiers: [],
          lifecycle: 'operating',
        }),
      }
    case 'affordable':
      return {
        status: 'resolved',
        reason:
          'Legacy affordable deterministically maps to rental multifamily with the affordable modifier.',
        request: request({
          scope,
          sector: 'residential',
          transaction: 'rental',
          archetype: 'rental_multifamily',
          modifiers: ['affordable'],
          lifecycle: 'operating',
        }),
      }
    case 'student':
      return {
        status: 'resolved',
        reason:
          'Legacy student deterministically maps to rental multifamily with the student modifier.',
        request: request({
          scope,
          sector: 'residential',
          transaction: 'rental',
          archetype: 'rental_multifamily',
          modifiers: ['student'],
          lifecycle: 'operating',
        }),
      }
    case 'townhome':
    case 'condo':
      return {
        status: 'resolved',
        reason:
          'Legacy ownership community maps to the for-sale community archetype.',
        request: request({
          scope:
            subjectKind === 'real_estate_development' ? 'development' : 'community',
          sector: 'residential',
          transaction: 'for_sale',
          archetype: 'for_sale_community',
          modifiers: ['condo_townhome'],
          lifecycle: 'selling',
        }),
      }
    case 'single_family':
      return {
        status: 'resolved',
        reason:
          'Legacy single-family deterministically maps to a for-sale community.',
        request: request({
          scope:
            subjectKind === 'real_estate_development' ? 'development' : 'community',
          sector: 'residential',
          transaction: 'for_sale',
          archetype: 'for_sale_community',
          modifiers: [],
          lifecycle: 'selling',
        }),
      }
    case 'master_planned':
      return {
        status: 'resolved',
        reason:
          'Legacy master-planned deterministically maps to a for-sale development.',
        request: request({
          scope: 'development',
          sector: 'residential',
          transaction: 'for_sale',
          archetype: 'for_sale_community',
          modifiers: ['master_planned'],
          lifecycle: 'selling',
        }),
      }
    case 'senior':
      return {
        status: 'needs_review',
        reason:
          'Legacy senior is ambiguous between active-adult housing and licensed care models.',
        questionIds: [
          'legacy.question.confirm_senior_transaction',
          'legacy.question.confirm_care_model',
        ],
      }
    case 'mixed_use':
      return {
        status: 'needs_review',
        reason:
          'Legacy mixed_use does not identify the primary transaction or offering.',
        questionIds: [
          'legacy.question.confirm_primary_transaction',
          'legacy.question.confirm_primary_offering',
        ],
      }
    case 'luxury':
      return {
        status: 'needs_review',
        reason:
          'Legacy luxury is positioning and does not identify rental versus for-sale.',
        questionIds: [
          'legacy.question.confirm_transaction',
          'legacy.question.confirm_archetype',
        ],
      }
    case null:
      return {
        status: 'needs_review',
        reason:
          'Legacy property type is missing; SiteForge cannot select a standard or multifamily fallback.',
        questionIds: [
          'legacy.question.confirm_scope',
          'legacy.question.confirm_sector',
          'legacy.question.confirm_transaction',
          'legacy.question.confirm_archetype',
        ],
      }
  }
}
