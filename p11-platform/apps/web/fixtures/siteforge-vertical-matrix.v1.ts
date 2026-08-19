import type { PropertyType } from '@/utils/property-types'
import type {
  VerticalCompositionRequest,
  VerticalConversionIntent,
  VerticalOfferingKind,
} from '@/utils/siteforge/verticals/contracts'
import { VERTICAL_REGISTRY_VERSION } from '@/utils/siteforge/verticals/registry'

type FixtureInput = Omit<
  VerticalCompositionRequest,
  'registryVersion' | 'confirmedOverride'
>

export type SiteForgeVerticalMatrixFixture = {
  id: string
  label: string
  request: VerticalCompositionRequest
  expectedPackKeys: string[]
  expectedPrimaryIntent: VerticalConversionIntent
  expectedOfferingKind: VerticalOfferingKind
}

function expectedPackKeys(input: FixtureInput): string[] {
  return [
    'siteforge.vertical.core.real_estate',
    `siteforge.vertical.scope.${input.scope}`,
    `siteforge.vertical.sector.${input.sector}`,
    `siteforge.vertical.transaction.${input.transaction}`,
    `siteforge.vertical.archetype.${input.archetype}`,
    ...[...input.modifiers]
      .sort((a, b) => a.localeCompare(b))
      .map(modifier => `siteforge.vertical.modifier.${modifier}`),
    `siteforge.vertical.lifecycle.${input.lifecycle}`,
  ]
}

function fixture(
  id: string,
  label: string,
  input: FixtureInput,
  expectedPrimaryIntent: VerticalConversionIntent,
  expectedOfferingKind: VerticalOfferingKind
): SiteForgeVerticalMatrixFixture {
  return {
    id,
    label,
    request: {
      registryVersion: VERTICAL_REGISTRY_VERSION,
      ...input,
      confirmedOverride: null,
    },
    expectedPackKeys: expectedPackKeys(input),
    expectedPrimaryIntent,
    expectedOfferingKind,
  }
}

export const SITEFORGE_VERTICAL_MATRIX_V1 = [
  fixture(
    'rental.conventional_multifamily',
    'Conventional multifamily',
    {
      scope: 'property',
      sector: 'residential',
      transaction: 'rental',
      archetype: 'rental_multifamily',
      modifiers: [],
      lifecycle: 'operating',
    },
    'tour',
    'rental_unit'
  ),
  fixture(
    'rental.lease_up',
    'Multifamily lease-up',
    {
      scope: 'property',
      sector: 'residential',
      transaction: 'rental',
      archetype: 'rental_multifamily',
      modifiers: ['lease_up'],
      lifecycle: 'lease_up',
    },
    'register_interest',
    'rental_unit'
  ),
  fixture(
    'rental.affordable',
    'Affordable rental housing',
    {
      scope: 'community',
      sector: 'residential',
      transaction: 'rental',
      archetype: 'rental_multifamily',
      modifiers: ['affordable'],
      lifecycle: 'operating',
    },
    'waitlist',
    'rental_unit'
  ),
  fixture(
    'rental.student',
    'Student housing',
    {
      scope: 'community',
      sector: 'residential',
      transaction: 'rental',
      archetype: 'rental_multifamily',
      modifiers: ['student'],
      lifecycle: 'operating',
    },
    'apply',
    'bed_space'
  ),
  fixture(
    'rental.luxury',
    'Luxury rental',
    {
      scope: 'property',
      sector: 'residential',
      transaction: 'rental',
      archetype: 'rental_multifamily',
      modifiers: ['luxury'],
      lifecycle: 'operating',
    },
    'private_appointment',
    'rental_unit'
  ),
  fixture(
    'rental.build_to_rent',
    'Build-to-rent community',
    {
      scope: 'community',
      sector: 'residential',
      transaction: 'rental',
      archetype: 'rental_multifamily',
      modifiers: ['build_to_rent'],
      lifecycle: 'operating',
    },
    'tour',
    'rental_home'
  ),
  fixture(
    'rental.mixed_use',
    'Mixed-use rental development',
    {
      scope: 'development',
      sector: 'cross_sector',
      transaction: 'rental',
      archetype: 'rental_multifamily',
      modifiers: ['mixed_use'],
      lifecycle: 'operating',
    },
    'inquiry',
    'commercial_suite'
  ),
  fixture(
    'for_sale.builder_corporate',
    'Homebuilder corporate',
    {
      scope: 'corporate',
      sector: 'residential',
      transaction: 'for_sale',
      archetype: 'corporate',
      modifiers: ['builder_corporate'],
      lifecycle: 'prelaunch',
    },
    'sales_inquiry',
    'portfolio_property'
  ),
  fixture(
    'for_sale.single_community',
    'Single for-sale community',
    {
      scope: 'community',
      sector: 'residential',
      transaction: 'for_sale',
      archetype: 'for_sale_community',
      modifiers: [],
      lifecycle: 'selling',
    },
    'sales_inquiry',
    'home_plan'
  ),
  fixture(
    'for_sale.master_planned',
    'Master-planned community',
    {
      scope: 'development',
      sector: 'residential',
      transaction: 'for_sale',
      archetype: 'for_sale_community',
      modifiers: ['master_planned'],
      lifecycle: 'selling',
    },
    'visit',
    'homesite'
  ),
  fixture(
    'for_sale.condo_townhome',
    'Condominium and townhome',
    {
      scope: 'community',
      sector: 'residential',
      transaction: 'for_sale',
      archetype: 'for_sale_community',
      modifiers: ['condo_townhome'],
      lifecycle: 'selling',
    },
    'sales_inquiry',
    'quick_move_in_home'
  ),
  fixture(
    'for_sale.custom_home',
    'Custom-home builder',
    {
      scope: 'corporate',
      sector: 'residential',
      transaction: 'for_sale',
      archetype: 'corporate',
      modifiers: ['custom_home'],
      lifecycle: 'selling',
    },
    'private_appointment',
    'home_plan'
  ),
  fixture(
    'for_sale.active_adult_55_plus',
    'Active-adult 55-plus',
    {
      scope: 'community',
      sector: 'residential',
      transaction: 'for_sale',
      archetype: 'for_sale_community',
      modifiers: ['active_adult_55_plus'],
      lifecycle: 'selling',
    },
    'visit',
    'home_plan'
  ),
  fixture(
    'for_sale.branded_residence',
    'Branded residences',
    {
      scope: 'destination',
      sector: 'residential',
      transaction: 'for_sale',
      archetype: 'for_sale_community',
      modifiers: ['branded_residence'],
      lifecycle: 'selling',
    },
    'private_appointment',
    'quick_move_in_home'
  ),
  fixture(
    'senior.independent_living',
    'Independent living',
    {
      scope: 'community',
      sector: 'senior_care',
      transaction: 'care_services',
      archetype: 'senior_community',
      modifiers: ['independent_living'],
      lifecycle: 'operating',
    },
    'private_appointment',
    'care_residence'
  ),
  fixture(
    'senior.assisted_living',
    'Assisted living',
    {
      scope: 'community',
      sector: 'senior_care',
      transaction: 'care_services',
      archetype: 'senior_community',
      modifiers: ['assisted_living'],
      lifecycle: 'operating',
    },
    'private_appointment',
    'care_residence'
  ),
  fixture(
    'senior.memory_care',
    'Memory care',
    {
      scope: 'community',
      sector: 'senior_care',
      transaction: 'care_services',
      archetype: 'senior_community',
      modifiers: ['memory_care'],
      lifecycle: 'operating',
    },
    'professional_referral',
    'care_residence'
  ),
  fixture(
    'senior.life_plan_ccrc',
    'Life-plan and CCRC',
    {
      scope: 'community',
      sector: 'senior_care',
      transaction: 'care_services',
      archetype: 'senior_community',
      modifiers: ['life_plan_ccrc'],
      lifecycle: 'operating',
    },
    'private_appointment',
    'care_residence'
  ),
  fixture(
    'senior.skilled_nursing',
    'Skilled nursing',
    {
      scope: 'property',
      sector: 'senior_care',
      transaction: 'care_services',
      archetype: 'senior_community',
      modifiers: ['skilled_nursing'],
      lifecycle: 'operating',
    },
    'professional_referral',
    'care_residence'
  ),
  fixture(
    'commercial.office',
    'Office property',
    {
      scope: 'property',
      sector: 'commercial',
      transaction: 'commercial_lease',
      archetype: 'commercial_property',
      modifiers: ['office'],
      lifecycle: 'operating',
    },
    'commercial_leasing_inquiry',
    'commercial_suite'
  ),
  fixture(
    'commercial.retail',
    'Retail property',
    {
      scope: 'property',
      sector: 'commercial',
      transaction: 'commercial_lease',
      archetype: 'commercial_property',
      modifiers: ['retail'],
      lifecycle: 'operating',
    },
    'commercial_leasing_inquiry',
    'commercial_suite'
  ),
  fixture(
    'commercial.industrial_logistics',
    'Industrial and logistics',
    {
      scope: 'property',
      sector: 'commercial',
      transaction: 'commercial_lease',
      archetype: 'commercial_property',
      modifiers: ['industrial_logistics'],
      lifecycle: 'operating',
    },
    'commercial_leasing_inquiry',
    'commercial_building'
  ),
  fixture(
    'commercial.life_science',
    'Life-science property',
    {
      scope: 'property',
      sector: 'commercial',
      transaction: 'commercial_lease',
      archetype: 'commercial_property',
      modifiers: ['life_science'],
      lifecycle: 'operating',
    },
    'rfp',
    'commercial_suite'
  ),
  fixture(
    'scope.corporate',
    'Corporate real-estate site',
    {
      scope: 'corporate',
      sector: 'cross_sector',
      transaction: 'informational',
      archetype: 'corporate',
      modifiers: [],
      lifecycle: 'operating',
    },
    'inquiry',
    'portfolio_property'
  ),
  fixture(
    'scope.portfolio',
    'Portfolio site',
    {
      scope: 'portfolio',
      sector: 'cross_sector',
      transaction: 'informational',
      archetype: 'portfolio',
      modifiers: [],
      lifecycle: 'operating',
    },
    'inquiry',
    'portfolio_property'
  ),
  fixture(
    'scope.destination',
    'Destination site',
    {
      scope: 'destination',
      sector: 'destination',
      transaction: 'destination_booking',
      archetype: 'destination',
      modifiers: [],
      lifecycle: 'operating',
    },
    'external_booking',
    'event'
  ),
] as const satisfies readonly SiteForgeVerticalMatrixFixture[]

export type SiteForgeVerticalAmbiguityFixture =
  | {
      id: string
      kind: 'legacy'
      propertyType: PropertyType | null
      expectedQuestionIds: string[]
    }
  | {
      id: string
      kind: 'composition'
      request: VerticalCompositionRequest
      expectedError: string
    }

export const SITEFORGE_VERTICAL_AMBIGUITY_CASES_V1: readonly SiteForgeVerticalAmbiguityFixture[] =
  [
    {
      id: 'legacy.senior_requires_care_model',
      kind: 'legacy',
      propertyType: 'senior',
      expectedQuestionIds: [
        'legacy.question.confirm_senior_transaction',
        'legacy.question.confirm_care_model',
      ],
    },
    {
      id: 'legacy.luxury_requires_transaction',
      kind: 'legacy',
      propertyType: 'luxury',
      expectedQuestionIds: [
        'legacy.question.confirm_transaction',
        'legacy.question.confirm_archetype',
      ],
    },
    {
      id: 'legacy.mixed_use_requires_primary_offering',
      kind: 'legacy',
      propertyType: 'mixed_use',
      expectedQuestionIds: [
        'legacy.question.confirm_primary_transaction',
        'legacy.question.confirm_primary_offering',
      ],
    },
    {
      id: 'legacy.missing_has_no_fallback',
      kind: 'legacy',
      propertyType: null,
      expectedQuestionIds: [
        'legacy.question.confirm_scope',
        'legacy.question.confirm_sector',
        'legacy.question.confirm_transaction',
        'legacy.question.confirm_archetype',
      ],
    },
    {
      id: 'composition.standard_archetype_is_not_a_fallback',
      kind: 'composition',
      request: {
        registryVersion: VERTICAL_REGISTRY_VERSION,
        scope: 'property',
        sector: 'residential',
        transaction: 'rental',
        archetype: 'standard',
        modifiers: [],
        lifecycle: 'operating',
        confirmedOverride: null,
      },
      expectedError: 'PACK_NOT_FOUND',
    },
    {
      id: 'composition.affordable_luxury_conflict',
      kind: 'composition',
      request: {
        registryVersion: VERTICAL_REGISTRY_VERSION,
        scope: 'community',
        sector: 'residential',
        transaction: 'rental',
        archetype: 'rental_multifamily',
        modifiers: ['affordable', 'luxury'],
        lifecycle: 'operating',
        confirmedOverride: null,
      },
      expectedError: 'PACK_CONFLICT',
    },
    {
      id: 'composition.office_modifier_is_not_rental',
      kind: 'composition',
      request: {
        registryVersion: VERTICAL_REGISTRY_VERSION,
        scope: 'property',
        sector: 'residential',
        transaction: 'rental',
        archetype: 'rental_multifamily',
        modifiers: ['office'],
        lifecycle: 'operating',
        confirmedOverride: null,
      },
      expectedError: 'PACK_NOT_APPLICABLE',
    },
  ]
